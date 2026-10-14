# Runbook: aplicar las migraciones pendientes sin tocar ni perder datos

Fecha de la línea base: 2026-10-13 (BD papuenvios `qcwnlbpultscerwdnzbm`).

## Principio
Ninguna migración de esta cadena borra, reescribe ni transforma filas existentes.
Auditoría de sentencias (`rg` sobre las 6 migraciones): sin `DROP COLUMN/TABLE`, `DELETE`, `TRUNCATE` ni
`UPDATE` sobre datos. Solo: columnas nuevas NULL o con DEFAULT constante, un `INSERT ... ON CONFLICT DO NOTHING`,
CHECKs que las filas existentes ya cumplen, y `DROP ... IF EXISTS` de constraints/policies/triggers propios.
El único `UPDATE` (dentro del RPC de recálculo) solo corre cuando un usuario lo invoca.

## Línea base (antes de aplicar)
| Tabla | Filas | Hash (md5 de columnas clave) |
|---|---|---|
| orders (id, total_amount, status) | 24 | 1c6eabc97d1eb91f5a127b19cd64b48c |
| order_items (id, unit_price, quantity) | 125 | ede2e33d6308fa3e29179de457b04598 |
| remittances (id, amount_sent, amount_to_deliver, exchange_rate, commission_total, status, payment_validated) | 23 | b878b5903bfa15b3cdbcdc61a4570308 |
| products (id, base_price, profit_margin, final_price) | 69 | dcd023f54bb17a681c1851d01fe354f0 |
| product_categories (id, name_es) | 11 | c13c991d1c1078eaa9c86729f8c5c088 |
| system_config (key, value_numeric) | 4 | 0425aad999db82dd7ca27bf2f1702caa |
| shipping_zones (id, shipping_cost, free_shipping, is_active) | 26 | 6535d34a17f87cb5b9ef36c1137ccf6b |
| activity_logs | 148 | (solo conteo; crece con el uso) |

Abiertos al medir: 7 remesas `payment_pending`/`payment_rejected`, 9 pedidos no cerrados.

## Resultado esperado después de aplicar (se compara con la misma consulta)
- orders, order_items, remittances, products, product_categories, shipping_zones: **conteo y hash idénticos**.
- system_config: 5 filas (4 + `default_combo_profit_margin` = 35); las otras 4 filas con el mismo valor.
- activity_logs: puede crecer (uso normal), nunca bajar de 148.
- Columnas nuevas (`payer_phone`, `delivery_cost`, `shipping_zone_id`, `product_categories.profit_margin`): existen y están en NULL / 0 para todas las filas previas.

## Orden de aplicación (una migración por vez, con `apply_migration`; nunca `db push`)
1. `20261013140000_add_payer_phone.sql` (PR-06a)
2. `20261013150000_f8_profit_margin_settings.sql` (PR-07)
3. `20261013160000_remittances_delivery_cost.sql` (PR-09)
4. `20261013170000_remittances_owner_update_guard.sql` (guard + RPC)
Después de cada una: comparar la línea base. Recién después de las 4, desplegar el front.
Antes de empezar: confirmar que existe un backup/PITR reciente en el panel de Supabase (no verificable desde acá).

## Validación ya hecha de la migración 4 (transacción revertida, 2026-10-13)
19/20 sondas OK; la 20 (`delivery_cost = 0`) fue artefacto de la sonda (la columna ya valía 0). Paridad del RPC:
remesa 8b06d77f: SQL independiente = 116280.00 / comisión 3.92 (tasa 780, monto 153.00), igual al resultado del RPC.
Las 23 remesas existentes tienen `recipient_province = 'Ciego de Ávila'`, igual a `shipping_zones` (PR-08 no bloquea ninguna).

## Efectos de comportamiento (no pérdida de datos) a conocer
1. Las 7 remesas pendientes y 9 pedidos abiertos pedirán el teléfono del pagador en su próxima subida de comprobante; sus filas quedan con `payer_phone` NULL hasta entonces (no se inventa ni se rellena).
2. Márgenes globales: los admins que tengan valores distintos de 40/35 en el localStorage de su navegador verán 40/35 de la BD. No cambia ningún precio guardado (`final_price` sale del margen de cada producto). Si el negocio usa otros valores, un admin debe guardarlos una vez en Configuración > Financiero.
3. Importes ya cobrados con la fórmula vieja del carrito (sobrecobrado USD 19.70, subcobrado USD 18.00) NO se corrigen: son datos históricos y no se reescriben.
4. El dueño de una remesa ya no puede cancelar desde `payment_validated`/`processing` ni editar el comprobante tras subirlo.

## RESULTADO DE LA APLICACIÓN (2026-10-13, vía `apply_migration`, una por vez)
| # | Migración | Versión remota | Verificación tras aplicar |
|---|---|---|---|
| 1 | add_payer_phone | 20261013152559 | hashes y conteos idénticos a la línea base; `payer_phone` NULL en todas las filas; 2 CHECKs creados |
| 2 | f8_profit_margin_settings | 20261013152755 | idénticos; `system_config` = las 4 filas originales con el mismo hash (0425aad…) + `default_combo_profit_margin`=35; policies INSERT/UPDATE key-scoped; `anon` sin grants; `product_categories.profit_margin` NULL en todas |
| 3 | remittances_delivery_cost | 20261013152818 | idénticos; las 23 remesas con `delivery_cost`=0 y sin zona; CHECK y FK `ON DELETE SET NULL` creados |
| 4 | remittances_owner_update_guard | 20261013153036 | idénticos; trigger `guard_remittance_owner_update` activo; `anon` sin EXECUTE sobre el RPC |

Sondas con el trigger REAL instalado (transacción revertida): 19/19 OK, incluidos `delivery_cost = 5` y `shipping_zone_id` denegados, auto-validación y cambio de montos/tasa denegados, subir comprobante/cancelar/RPC/admin permitidos.
Sin residuos de sondas (0 remesas tocadas, 0 funciones temporales). `activity_logs` = 148 (sin bajar).
Pendiente: desplegar el front (ramas locales sin push) DESPUÉS de esto; hasta entonces el sitio en producción sigue con el código viejo, que es compatible con las columnas nuevas (NULL/DEFAULT).

## Migración 20261013180000_revoke_anon_secdef_rpcs (aplicada 2026-10-13)
- Solo permisos (REVOKE/GRANT), sin tocar datos. 10 RPCs SECURITY DEFINER ya no son ejecutables por anon; authenticated y service_role conservan EXECUTE.
- Siguen abiertas a anon (intencional): is_admin_user, is_super_admin, get_my_role, current_user_role, current_user_is_enabled (helpers de RLS) y get_testimonial_author_profiles (testimonios públicos).
- Verificado: conteos idénticos (orders 24, order_items 125, remittances 23, products 69, product_categories 11); anon lee catálogo (7 categorías visibles, 69 productos).
- Versión remota: `20261013153557`.
- Rollback: GRANT EXECUTE ON FUNCTION <firma> TO PUBLIC.

## Migración 20261014100000_zelle_accounts_visibility_flags (aplicada 2026-10-13, PR-10)
- Agrega `show_email` y `show_phone` (`boolean NOT NULL DEFAULT true`) a `zelle_accounts`, el CHECK `zelle_accounts_at_least_one_contact_visible (show_email OR show_phone)` y el RPC `get_zelle_account_public(uuid)` (SECURITY DEFINER, solo cuentas activas, email/phone en NULL según el flag; sin EXECUTE para anon, con EXECUTE para authenticated y service_role).
- Línea base previa: `zelle_accounts` = 4 filas, hash `87dc6da5139616e5cf5f4f8c664d19aa` (id, account_name, account_holder, email, phone, is_active).
- Verificado tras aplicar: mismas 4 filas con el mismo hash; las 4 con ambos flags en `true` (nada cambia de comportamiento); CHECK creado; RPC con permisos correctos.
- Se aplicó sin el `BEGIN/COMMIT` del archivo, porque `apply_migration` ya envuelve en una transacción; el resto es idéntico.
- Versión remota: `20261013162847`.
- Límite conocido: la policy `zelle_accounts_select_active` NO se tocó. Un cliente autenticado todavía puede leer email/phone con un `select` directo; los flags solo rigen en `reserveZelleAccount` y en la UI. Se cierra en un PR de seguimiento (RPC de listado, selector migrado, realtime reemplazado, luego policy admin-only).
- Pendiente: desplegar el front con PR-10 para que los toggles del admin existan; hasta entonces producción corre código viejo, compatible con las columnas nuevas.
- Rollback: `DROP FUNCTION IF EXISTS public.get_zelle_account_public(uuid); ALTER TABLE public.zelle_accounts DROP CONSTRAINT IF EXISTS zelle_accounts_at_least_one_contact_visible; ALTER TABLE public.zelle_accounts DROP COLUMN IF EXISTS show_email, DROP COLUMN IF EXISTS show_phone;`

## Correspondencia archivo local ↔ versión remota (para reconciliar el historial)
`apply_migration` registra la versión con el timestamp del momento de aplicar, no con el del archivo. Hay deriva de versiones con `supabase/migrations/` y `supabase db push` no debe usarse hasta reconciliarla.

| Archivo local | Versión remota |
|---|---|
| `20261013170000_remittances_owner_update_guard.sql` | `20261013153036` |
| `20261013180000_revoke_anon_secdef_rpcs.sql` | `20261013153557` |
| `20261014100000_zelle_accounts_visibility_flags.sql` | `20261013162847` |
(Las de payer_phone, margins y delivery_cost: `20261013152559`, `20261013152755`, `20261013152818`, ver tabla de arriba.)
