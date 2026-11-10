# Fase 0b — Lecturas de costo del admin por RPC (expand) y cierre de columnas (contract)

Estado: migración A, front y archivo de contrato B preparados y probados en el harness local. **Nada aplicado a Supabase remoto.**
Evidencia de producción: SELECT de solo lectura del 2026-10-16 (proyecto `qcwnlbpultscerwdnzbm`).

## 1. Propuesta

Cerrar la fuga de costos y márgenes hacia clientes y visitantes con despliegue expand/contract:

| Paso | Qué | Requiere "dale" del dueño |
|---|---|---|
| 0a (hecho, PR previo) | El front público lee listas explícitas de columnas | — |
| **A** | Migración aditiva `20261016160000_phase0b_admin_cost_read_rpcs.sql`: 5 RPC de lectura de solo admin | Sí, aplicar a remoto |
| **Front** | Admin/vendor leen costo por RPC (`src/lib/adminCostService.js`) | Sí, merge + deploy Vercel |
| Observación | ≥ 48 h sin 42501 en `query_logs` y sin lecturas directas de columnas ocultas | — |
| **B** | `supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql` (REVOKE de tabla + GRANT SELECT por columnas) | Sí, aplicar a remoto, **separado** de A |

Por qué RPC: admin y cliente comparten el rol de base de datos `authenticated`; un privilegio de columna no los distingue. La lectura de costo solo es posible vía función `SECURITY DEFINER` que re-verifica `is_admin_user()` dentro del cuerpo. Un `REVOKE SELECT (columna)` es no-op mientras exista `GRANT SELECT` de tabla (verificado en el harness: sin el REVOKE de tabla, 8 tests de B fallan).

## 2. Qué contiene costo hoy (verificado contra producción y el código)

### 2.1 Tablas y columnas (producción)

| Tabla (filas) | Columnas con costo/margen | Grants hoy (anon / authenticated) |
|---|---|---|
| `products` (53) | `base_price`, `cost_price` (NULL en las 53 filas, nadie lo lee ni escribe), `profit_margin`. `final_price` = `base_price * (1 + profit_margin/100)` (generada STORED, pública) | SELECT / SELECT,INSERT,UPDATE,DELETE |
| `combo_products` (16) | `base_total_price`, `profit_margin`. `final_price` generada, pública | idem |
| `product_categories` (11) | `profit_margin` | idem |
| `inventory` (53) | `cost_per_unit`, `supplier_reference` | idem |
| `shipping_zones` (26) | `transport_cost` (`shipping_cost` es público) | idem |
| `remittance_services` (0) | `profit_margin`, comisiones | solo authenticated SELECT (policy `USING true`) |
| vista `order_analytics` | `transport_cost` (join a `shipping_zones`) + email; `security_invoker=true`, así que el cliente solo ve sus pedidos | solo authenticated SELECT; 0 llamadores en `src/` ni `supabase/functions` |
| `_bak_inventory_20261014` | copia de inventario | sin grants para anon/authenticated/PUBLIC (ok) |
| `operational_costs` | costos operativos | policy `ALL` solo `is_admin_user()` (ok) |

Sin costo sensible hacia clientes: `orders.shipping_cost` y `remittances.delivery_cost` son del dueño de la fila. **Residual:** `remittances.delivery_cost` no se verificó semánticamente (¿costo interno?); `orders`/`remittances` están en `supabase_realtime` (única publicación de tablas públicas). Se trata en F4b, no bloquea esta fase.

Realtime: ninguna tabla protegida está publicada (solo `orders`, `remittances`). RLS de SELECT: `products/combo_products/product_categories` ocultan filas inactivas a no-admin; `inventory`, `shipping_zones`, `combo_items`, `remittance_services` son `USING true`.

Roles reales en `user_profiles`: `user`, `admin`, `super_admin` (el CHECK admite `manager`, 0 filas, `is_admin_user()` no lo acepta). **No existe "vendor sin admin"**: las pantallas vendor son pantallas de admin. Decisión: solo `admin` y `super_admin`.

Funciones/triggers/policies que leen columnas ocultas como el llamador: **ninguna** (búsqueda por texto en `pg_proc.prosrc`, `pg_policies`, vistas, triggers). Las 4 funciones `SECURITY INVOKER` que tocan tablas protegidas (`_order_stock_needs`, `calculate_order_total`, `get_shipping_cost_for_location`, `_migrate_image_row`) solo leen columnas públicas.

### 2.2 Consumidores del front (rg sobre `src/`, no de memoria)

Llamadores de las variantes admin verificados con rg: `getProducts(true)`/`getCombos(true)`/`getCategories({includeMargin})` solo los invoca `ProductContext` (`refreshProducts(true)`, `refreshCombos(true)` vía `adminCatalogLoader` y `VendorInventoryTab`/`VendorCombosTab`, que cuelgan de `VendorPage` ← `AdminPage` ← `withProtectedRoute(..., 'admin')`); `canSeeMargins` es `userRole` admin/super_admin; `getAllShippingZones`/`getShippingZonesForProvince` solo `SettingsPageShipping` (← `SettingsPage`, ruta admin); Dashboard va por `withProtectedRoute(DashboardPage, 'admin')`. Ningún camino de cliente llama a las RPC. No hay `.upsert(` sobre las tablas protegidas (los 8 upserts de `src`/`supabase/functions` son de otras tablas).

Lecturas directas que existían y ahora van por RPC:

| Consumidor | Antes | Ahora |
|---|---|---|
| `productService.getProductRows(true)` (→ `ProductContext`, `VendorPage`, tablas de inventario) | `ADMIN_PRODUCT_COLUMNS` (`base_price, cost_price, profit_margin`) | columnas públicas + `admin_list_product_costs` |
| `productService.getCategories({includeMargin})` | `profit_margin` directo | columnas públicas + `admin_list_category_margins` |
| `comboService.getCombos(true)` | `base_total_price, profit_margin` + embed `products(base_price)` | columnas públicas + `admin_list_combo_costs` + `admin_list_product_costs(p_ids)` |
| `comboService.createCombo/updateCombo` | `from('products').select('id, base_price')` (si fallaba, guardaba `base_total_price = 0` en silencio) | `admin_list_product_costs(p_ids)`; si falla, **aborta** |
| `shippingService.getAllShippingZones`, `getShippingZonesForProvince` | `select('*')` | lista explícita no sensible + `admin_list_shipping_zone_costs` |
| `DashboardPage.fetchStats` | `products.select('id, profit_margin')`, `combo_products.select(...)` | `listProductCosts` / `listComboCosts` |
| inventario (`cost_per_unit`, `supplier_reference`) | **ningún query del front los lee ni escribe** (`InventoryManagement` lee `product.inventory`, que ningún query puebla) | RPC `admin_list_inventory_costs` creada (único camino admin tras B), sin consumidor hoy |

Consumen datos ya cargados (sin query propia): `VendorInventoryTab`, `VendorCombosTab`, `VendorCategoriesTab`, `ProductTableConfig`, `InventoryTableConfig`, `InventoryManagement`, `SettingsPageShipping` (formularios), `comboUtils`, `dashboardMetrics`. Siguen en el ratchet `publicCatalogStatic.test.js` con esa justificación.

`src/lib/adminCatalogColumns.js` **se conserva**: sigue exportando `hasAdminProductFields`/`hasAdminComboFields` (lo usan `VendorInventoryTab`, `VendorCombosTab` y `adminRowGuards.test.js`) y ahora `ADMIN_SHIPPING_COLUMNS`. Se eliminaron los `ADMIN_*_COLUMNS` con costo (nadie los usa).

Escrituras admin (insert/update de `base_price`, `profit_margin`, `transport_cost`...): siguen directas bajo RLS; el privilegio de UPDATE/INSERT de tabla no cambia. Su `RETURNING` ya usa listas públicas explícitas (0a).

## 3. Especificación (escenarios)

**RPC (migración A)**
- E1. Admin y super_admin: reciben `id` + solo las columnas de costo de esa tabla; `cost_price` nunca se devuelve.
- E2. Cliente, anon, admin deshabilitado, usuario degradado después de iniciar sesión y sesión sin `auth.uid()`: 42501 genérico, sin valores en el mensaje, aunque pasen ids reales. anon además falla por falta de EXECUTE.
- E3. Paginación: `p_limit` 1..1000 (más se recorta a 1000), `p_offset ≥ 0` (si no, 22023); orden por `id` (estable aun con `created_at` idéntico); `p_ids` NULL = todo, `[]` = nada, > 1000 ids = 22023.
- E4. Higiene: `SECURITY DEFINER`, `STABLE`, `search_path = public, pg_temp`, EXECUTE solo para `authenticated` (sin PUBLIC, anon, service_role).
- E5. La migración no toca tablas, grants de tabla ni policies.

**Front**
- E6. Vista admin = columnas públicas de la tabla + costo mergeado de la RPC; misma forma de fila que antes (salvo `cost_price`, ausente y sin lectores).
- E7. Vista pública nunca llama a las RPC.
- E8. RPC inexistente (PGRST202/404) → `AppError` `ADMIN_COST_RPC_UNAVAILABLE`, sin fallback a lectura directa; el contexto expone `adminCatalogError {kind:'adminCosts'}`; `VendorPage`, `DashboardPage` y `SettingsPageShipping` muestran `CatalogLoadError` (alerta con botón de recarga); en envíos no se muestran zonas editables (evita guardar "zona nueva" con costo 0 sobre la real).
- E9. Guardado de combos con RPC caída: falla en voz alta y no inserta.
- E10. Ningún `.select/.order/.eq...` del `src` nombra una columna sensible (ratchet), solo `adminCostService` llama `admin_list_*`.

**Contrato B (archivo separado)**
- E11. Tras B: para anon y authenticated, `has_column_privilege` es false en cada columna sensible y true en todas las demás; `has_table_privilege` false.
- E12. Cliente, anon y **también admin** reciben 42501 al leer una columna sensible directo, con `select *`, o filtrando/ordenando por ella.
- E13. Lecturas públicas del catálogo (listas explícitas, filtros, orden, `count(*)`, `final_price`) siguen funcionando; RLS sin cambios (cliente no ve inactivos).
- E14. Admin sigue leyendo costo solo por RPC y escribiendo con `RETURNING` explícito (también `inventory` con sus triggers); `RETURNING *` falla (documentado).
- E15. `order_analytics` y `remittance_services` cerrados; ninguna tabla protegida en realtime.
- E16. Rollback restaura exactamente los grants previos (snapshot de grants de tabla y de columna); B es idempotente y up/down/up.

## 4. Diseño

- **RPC** `admin_list_{product_costs,combo_costs,category_margins,inventory_costs,shipping_zone_costs}(p_limit int=500, p_offset int=0, p_ids uuid[]=NULL)`. Devuelven `id` + costo; el front lee las filas públicas de la tabla (orden y filtros intactos) y mergea por `id`. Cuerpo: `auth.uid() IS NULL OR NOT (is_admin_user() OR is_super_admin())` → `RAISE ... ERRCODE '42501'`. `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` + `GRANT EXECUTE ... TO authenticated`. Termina con `NOTIFY pgrst, 'reload schema'`.
- **Front**: `src/lib/adminCostService.js` (`listProductCosts`, `listComboCosts`, `listCategoryMargins`, `listInventoryCosts`, `listShippingZoneCosts` → `Map<id,row>`; páginas de 500 hasta página corta; ids en bloques de 500). Helpers `withProductCosts`, `withCategoryMargins`, `withComboCosts`, `withTransportCost` fuera de las funciones públicas (el escáner estático de funciones públicas sigue limpio). `catalogErrors.classifyAdminCatalogError`. `ProductContext.adminCatalogError` (por fuente, prioridad adminCosts > permission > load). Textos `products.catalogError.adminCosts` (ES/EN).
- **B** en `supabase/contract/` (no en `supabase/migrations/`: `db push` y el replay del bootstrap la aplicarían por accidente) y rollback en `supabase/rollbacks/`. Para cada tabla: `REVOKE SELECT ON tabla FROM anon, authenticated` (también limpia grants de columna) + `GRANT SELECT (todas las columnas salvo las ocultas)`. Lista = complemento de las ocultas, **superconjunto** de `PUBLIC_READABLE_COLUMNS`: incluye `delivery_days`, `delivery_note`, `image_file`, timestamps, que el admin lee directo y no son sensibles. Columnas futuras quedan cerradas hasta que se las otorgue (fail closed). Test estático compara listas con `PUBLIC_READABLE_COLUMNS`; test DB compara `grant ∪ ocultas = columnas reales`.
- `combo_items` no se toca (no tiene columnas sensibles).

## 5. Tareas TDD (rojo → verde)

| # | Slice | Rojo inicial | Verde |
|---|---|---|---|
| 1 | `adminCostReadRpcs.test.js` (DB) | 36 de 37 fallan: `function ... does not exist` | migración A: 37/37 |
| 2 | `phase0bContract.test.js` (DB, transacción con ROLLBACK) | archivo no cargable (ENOENT del contrato y su rollback) | contrato + rollback: 33/33; mutación (quitar el REVOKE de `products`) → 8 fallan |
| 3 | `adminCostReads.test.js` (unit) | módulo `adminCostService` inexistente | 22/22 |
| 4 | `catalogErrors`, `CatalogLoadError`, `ProductContext.adminCatalogError` | (escritos junto con la implementación, rojo no observado por separado) | verdes |
| 5 | `DashboardPage.adminCosts` | 2/2 rojo: sin llamadas RPC / sin alerta | verde |
| 6 | `SettingsPageShipping.adminCosts` | 1/2 rojo: sin alerta | verde |
| 7 | `VendorPage.adminCosts` | 1/2 rojo: sin alerta | verde |
| 8 | ratchet `publicCatalogStatic` + `phase0bContractStatic` | ratchet viejo rojo (wildcard y lectores) | actualizado |

Tests existentes ajustados (afirmaban el comportamiento viejo, justificado): `publicCatalogQueries` (3 baselines "sin cambios" + shipping `['*','*']`), `publicCatalogStatic` (wildcard y lista de lectores), `comboService.margin`, `productService.categories`, `productService.unit` y `DashboardPage.financials/currencyDisplay` (mocks con `rpc`), `rateFunctionsAndConstraints` (dejó de afirmar "es la migración más nueva": cualquier migración posterior lo rompe; ahora verifica que ninguna posterior toque sus objetos).

## 6. Orden de despliegue

1. Dale del dueño → aplicar **A** a remoto (aditiva; reversible con `supabase/rollbacks/20261016160000_..._down.sql`). Verificar `has_function_privilege('anon', ..., 'EXECUTE') = false` en producción (SELECT).
2. Dale → merge y deploy del front (Vercel). Si el deploy ocurriera antes que A, el admin ve la alerta `adminCosts` (no hay fallback).
3. Observación ≥ 48 h: `query_logs` sin 42501 de la app; ninguna lectura directa de columnas ocultas.
4. **Condición de entrada obligatoria para B (no recomendación):** sonda por HTTP real contra PostgREST (rama Supabase o stack local con A y B aplicados y luego ambos rollbacks, comparando grants): `select=*` (esperado 42501), `order=`/filtro sobre columna oculta (42501), `PATCH`/`POST` con `Prefer: return=representation` y `select=` explícito (debe pasar; confirmar que PostgREST no emite `table.*`), `HEAD` con `count=exact`, embed de categoría `category:product_categories(...)` y embed `combo_items(... products(...))`. El harness prueba la semántica SQL, no lo que genera PostgREST.
5. Dale → copiar B a `supabase/migrations/` con timestamp nuevo (o ejecutarlo) y aplicar. Rollback inmediato disponible, sin revertir el front.
6. Post-B (SELECT): `has_column_privilege` en producción para las 9 columnas ocultas.

## 7. Abogado del diablo (objeciones a este diseño)

1. **"Hay admins con pestañas viejas que aún hacen queries directas."** Antes de B siguen funcionando (A es aditiva). Tras B recibirán 42501 en lecturas directas de costo → mitigación: ventana de 48 h, bundles de Vercel se renuevan al recargar; la alerta de carga pide recargar. Riesgo residual aceptado: 2 admins + 3 super_admins (producción).
2. **"Realtime puede filtrar costos."** Verificado: solo `orders` y `remittances` están publicadas; ninguna tabla protegida. El test B lo vuelve a asegurar. Residual: `remittances.delivery_cost` (F4b).
3. **"La RPC devuelve demasiado."** Devuelve `id` + solo las columnas de costo; `cost_price` no se devuelve (NULL y sin uso). Límite 1000 filas, ids ≤ 1000. Costo vs 53 productos: trivial.
4. **"Vendor sin rol admin."** No existe: roles `user/admin/super_admin` (`manager` permitido por el CHECK, 0 filas, sin acceso hoy). Si se crea el rol, tendrá que entrar explícitamente en `is_admin_user()` y en las RPC; el test de "usuario degradado" cubre la regresión.
5. **"Rollback."** A: 5 `DROP FUNCTION`. B: archivo de rollback que restaura el estado exacto (comparado contra un snapshot de grants de tabla y columna) y es inmediato; el front funciona con y sin B.
6. **"Performance."** Admin pasa de 1 a 2 round-trips por lista (tabla + RPC en secuencia para productos; combos/ítems en paralelo). Con ≤ 53 filas es despreciable; páginas de 500 evitan crecimiento sin tope. Mejora futura posible: mergear en una sola RPC si el catálogo crece.
7. **"Paginación/orden: el merge por id pierde el orden."** El orden y los filtros los define la consulta a la tabla; la RPC solo aporta valores por `id`. El orden por `id` en la RPC solo hace estables las páginas (test con `created_at` idéntico).
8. **"SECURITY DEFINER hygiene."** `search_path = public, pg_temp`, objetos calificados, EXECUTE solo `authenticated` (anon/PUBLIC/service_role revocados; el default de Supabase da EXECUTE a anon), chequeo de rol dentro, error genérico sin valores, `STABLE`. Test de catálogo recorre todas las `admin_list_*`. Nota: `is_admin_user()` consulta `user_profiles` en cada llamada (JWT viejo no basta: test de degradado/deshabilitado).
9. **"Regresiones de tests."** 8 archivos de test ajustados (ver §5) y 2 ampliados (`catalogErrors`, `CatalogLoadError`); ratchet reforzado (ninguna llamada `.select/.order/filtro` nombra columnas sensibles). Falla preexistente no relacionada: `bizumFrontContract.test.js > set_payment_fx_rate retirado` espera token `unknown` pero `bizumErrors.js` ya mapea `payment_fx_managed_centrally` (introducido en #92); no se tocó.
10. **"El grant de B es más ancho que 'columnas públicas'."** Sí, a propósito: complemento de las ocultas. Una lista mínima rompería lecturas admin legítimas (`delivery_days`, `image_file`) y obligaría a RPC grandes. Todo lo concedido no es costo; test de deriva garantiza `concedidas ∪ ocultas = columnas reales`.
11. **"Alguien reabre la puerta con `GRANT SELECT ON tabla`."** Lint estático sobre migraciones (solo 2 históricas permitidas) + test de privilegios de columna en el harness. Un `ALTER TABLE ADD COLUMN` nuevo nace cerrado.
12. **"`select('*')` o `.select()` vacío rompe toda la tabla."** El ratchet prohíbe comodines en `src`; PostgREST con `RETURNING *` da 42501 (probado como SQL; la verificación por HTTP real con PostgREST no se hizo: ver riesgos).
13. **"`inventory_select` y `shipping_zones_select` son `USING true`."** Filas visibles a todos (seguirá así: no son costo); es un seguimiento de RLS fuera de alcance.
14. **"Inferencia de costo por variación de precio público."** Residual conocido (FLAW-03): `final_price` es público; no se corrige con grants.
15. **"Un super_admin con rol cambiado en caliente."** Cubierto: la RPC consulta el rol vigente en cada llamada.

## 8. Riesgos abiertos

- PostgREST sobre un stack HTTP real con grants parciales no se probó (el harness usa SQL con `SET ROLE` + claims). Recomendado: probar en una rama/stack Supabase antes de B.
- Deriva entre el clon local y producción: se verificó que los grants y `reloptions` coinciden (SELECT en ambos), pero no hay sonda automática pinneada.
- `remittances.delivery_cost` y `inventory_select` siguen fuera de alcance.
