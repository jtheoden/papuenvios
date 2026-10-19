# Plan Fase 1.5 — S3 (guard de order_items + reconciliación) y S4 (historial de remesas + ofertas)

- Fecha: 2026-10-19. Base: `origin/main` @ `5951e380`. Insumo: `audit_phase1_price_tamper.md` (P2, P4, P5; T-01/03/04/06/17/18).
- Estado: PREPARADO, NO APLICADO. En producción solo `SELECT` (MCP). Sin commit.
- Migraciones: `20261019100000_phase15_s3_order_items_guard.sql`, `20261019110000_phase15_s4_history_and_offers.sql`.
- Tests: `src/tests/concurrency/phase15S3OrderItemsGuard.test.js` (33), `phase15S4HistoryAndOffers.test.js` (19). Ajustados por consecuencia directa: `zelleCharacterization` y `phase15S2RemittancePricingGuard` (lista exacta de triggers de `orders`/`remittances` incluye los 2 triggers de oferta).

## 1. Decisiones

**S3 / P2.** Trigger `guard_order_items_pricing` (BEFORE INSERT en `order_items`, orden alfabético: tras `guard_order_items_insert`). Interruptor `system_config.order_items_pricing_guard_mode` (`off|warn|block`, arranca `warn`, faltante/inválido = `warn`), setter `set_order_items_pricing_guard_mode` (solo super_admin, log en `activity_logs`). Reutiliza `price_integrity_flags` (ya en prod por S2; no se crea ninguna tabla).
- Reglas bloqueantes (en `warn` solo se registran): `item_type_invalid`, `item_not_in_catalog`, `below_floor` (`unit_price < 0.5 * final_price`), `line_total_mismatch` (tolerancia `0.005*qty + 0.01`), `quantity_above_cap` (> 1000).
- Reglas solo-bandera: `currency_unverified` (producto con moneda base distinta de USD: el carrito convierte a la moneda de visualización, comparar crudo no tiene sentido), `catalog_price_missing`.
- Un item `product` cuyo id es un combo se trata como combo (igual que `_order_stock_needs`; existe 1 línea así en prod).
- **Desvío respecto a la auditoría (conservador):** el CHECK de total de línea y el tope de cantidad van como reglas del trigger, no como CHECK de tabla, para que el interruptor pueda apagarlos sin migración (D-12). Prod: 0 violaciones de ambos.
- Bypass idéntico a S2: `auth.uid() IS NULL`, GUC `role`, `is_admin_user()`, `is_super_admin()`; nunca `current_user` dentro de DEFINER. `search_path = public, pg_temp`, EXECUTE revocado a PUBLIC/anon/authenticated (salvo el setter), error uniforme `order_item_pricing_rejected` (23514, sin DETAIL).

**S3 / P4.** `_flag_order_price_mismatch(order_id)` registra `items_subtotal_mismatch` (modo `flag`, tabla `orders`) si `|sum(items.total_price) - subtotal| > 0.01 + 0.01*n_lineas`, una vez por pedido; nunca bloquea ni cancela, traga sus propios errores. Se llama desde `_reserve_order_locked`, el único punto de paso de `reserve_order_inventory` y `consume_order_inventory` (no llamar a reserve no esquiva el chequeo; el pedido pagado nunca se cancela).
- Riesgo de tocar la función de stock: se re-crea byte a byte igual al original (md5 en prod = `cca10f4ee5d7cd8a2876450be73b47ab` = el de `20261014190000`) más UNA línea entre marcadores `P4-BEGIN/P4-END`. Un test estático quita esas líneas y compara con la migración original; el `down` restaura el md5 de prod (verificado).
- Alternativas si el dueño no quiere tocarla: (a) invocar el helper solo desde los dos wrappers públicos (más copias de funciones grandes); (b) consulta de auditoría periódica por admin (sin cambio de funciones). Se prefirió el punto único.

**S4 / P5.**
- `rsh_insert`: `EXISTS remittances r WHERE r.id = remittance_id AND (r.user_id = auth.uid() OR is_admin_user())`. El front nunca inserta en `remittance_status_history` (solo `SELECT` en `getRemittanceDetails`); el historial real lo escribe el trigger DEFINER `audit_remittance_status_change`. Prod: 58 filas, 0 huérfanas, 0 con autor ajeno.
- `offer_id` válido (T-06): trigger `guard_offer_id_validity` en `orders` y `remittances` (`WHEN offer_id IS NOT NULL`, nombres `guard_order_offer_id` / `guard_remittance_offer_id`) con interruptor propio `offer_id_guard_mode` (+ `set_offer_id_guard_mode`), independiente de S2/S3. Reglas: oferta activa y dentro de ventana, `min_purchase_amount <= subtotal` (solo pedidos), `max_usage_global` y `max_usage_per_user` contra `offer_usage` (conteo sin lock: mejor esfuerzo, el cliente registra el uso después del pedido). Las columnas legacy `usage_limit/usage_count/user_usage_limit` se ignoran (el cliente no las lee).
- **`offers_select_authenticated` NO se quita.** `orderService.js` (líneas ~613 y ~736) consulta ofertas por id para enriquecer pedidos, incluidas inactivas/vencidas (`is_active` en el select); `offers_select_public_active` solo devuelve activas en ventana. Test de caracterización lo fija. Cierre futuro seguro: RPC/vista DEFINER con los campos de ofertas de los pedidos propios + cambio de `orderService` + drop de la policy (slice aparte, con dale).

## 2. Verificaciones en producción (SELECT, 2026-10-19)

- `order_items`: 146 filas; tipo inválido 0; bajo piso 0; total de línea fuera de tolerancia 0; cantidad > 1000 0 (máx 27); 11 apuntan a productos borrados (histórico, la regla es solo para INSERT nuevos); 1 combo etiquetado `product`.
- Productos con moneda base no-USD: 0. Triggers en `order_items`: solo `guard_order_items_insert`.
- P4 sobre los 31 pedidos (todos con items): 0 violaciones, diferencia máxima 0.01.
- Ofertas: 3, activas 0; pedidos con oferta 0; remesas con oferta 0. `remittance_status_history`: 58, huérfanas 0, autor ajeno 0.
- `price_integrity_flags` existe; no hay claves `order_items_pricing_guard_mode` ni `offer_id_guard_mode`; md5 de `_reserve_order_locked` coincide con el repo.

## 3. Resultados de tests (local)

- Rojo inicial: S3 21 de 33 fallaban (los 12 verdes son casos legítimos que ya pasaban o comprobaciones negativas); S4 15 de 19.
- Verde final: S3 33/33, S4 19/19; suite de BD completa 17 archivos, 721 pasan, 1 skipped (preexistente). Re-aplicación idempotente y up → down → up comprobados con `psql` (el down deja el md5 de prod).
- `vitest` completo: 2095 pasan, 1 falla (`selfHostedFonts`: falta `node_modules/@fontsource` en este worktree). `npm run build` no corre: falta `node_modules/vite/bin/vite.js` en el worktree. Ambos son del entorno del worktree, el diff no toca `src/` productivo. Revisar en el checkout principal.

## 4. Abogado del diablo

| # | Objeción | Respuesta |
|---|---|---|
| D-1 | `warn` por defecto deja T-01 abierto. | Deliberado: solo se registra hasta ver tráfico real; paso a `block` con el setter, sin migración. |
| D-2 | Piso 50% permite 50% de descuento ilegítimo (D-03). | Cierto; red contra abuso grosero. Control exacto en F4a. |
| D-3 | Multi-moneda (D-08): el carrito convierte a la moneda de visualización. | Precios en CUP son mayores y EUR ~0.9x: pasan el piso. Productos con base no-USD: solo bandera. Hueco residual: con `currency_id` CUP el piso es laxo (50% del número USD en CUP es casi nada); se cierra fijando la moneda en servidor (F4a, pregunta Q-3). |
| D-4 | Combos y combos mal etiquetados. | Cubiertos y testeados. Los combos no tienen moneda base; se asumen USD (precio `final_price`). |
| D-5 | Carrito con precio guardado (`displayed_price`) que sube >100% después. | Falso positivo posible en `block`; hoy se vería en `warn` antes de endurecer. |
| D-6 | Producto borrado entre carrito y checkout → `item_not_in_catalog`. | Correcto: la reserva ya cancelaría ese pedido (`invalid_item`). |
| D-7 | Tocar `_reserve_order_locked`. | Ver 1 (P4): byte a byte + 1 llamada, helper que no lanza, test estático, down verificado. Si el md5 de prod cambia antes de aplicar, rebasar el hook. |
| D-8 | Quitar `offers_select_authenticated`. | No se quita (rompe el enriquecimiento de pedidos antiguos); documentado y testeado. |
| D-9 | Conteo de uso de ofertas sin lock. | Mejor esfuerzo, como acepta la auditoría; uso atómico en F4a. |
| D-10 | En `block` el intento rechazado no deja bandera (rollback). | Igual que S2: visible solo en logs (`order_item_pricing_rejected`, `offer_id_rejected`). |
| D-11 | `execute_platform_reset` no limpia las banderas nuevas. | Sin FK, no bloquea; limpiar exige tocar una función DEFINER (otro dale). |

## 5. Orden de aplicación y dales

1. Re-ejecutar en prod los SELECT de las cabeceras y comparar el md5 de `_reserve_order_locked` (`cca10f4e...`). Si cambió, no aplicar S3.
2. Prerrequisitos: S1 y S2 aplicadas (S2 ya lo está en prod: `price_integrity_flags` existe).
3. **Dale A**: aplicar S3 (`20261019100000`), modo `warn`. Rollback en la cabecera (incluye restaurar el cuerpo original de la función de stock).
4. **Dale B**: aplicar S4 (`20261019110000`), modo `warn`. Efecto inmediato y duro: la policy `rsh_insert` (ningún flujo del front la usa).
5. Observar `price_integrity_flags` (service_role) con tráfico real.
6. **Dale C/D/E** (decisiones del dueño, sin migración): `set_order_items_pricing_guard_mode('block')`, `set_offer_id_guard_mode('block')`; cada una cuando no haya clientes reales marcados.
7. Pendientes con su propio dale: confirmar el tope de cantidad (1000), limpieza de banderas en `execute_platform_reset`, cierre de `offers_select_authenticated` vía RPC, moneda fija en servidor (F4a).

## 6. Falsos positivos a vigilar sobre clientes reales

- Precio guardado en el carrito vs catálogo cambiado (D-5). Moneda de visualización ≠ USD (D-3). Combos y mislabel (cubierto). Redondeo de línea (tolerancia `0.005*qty+0.01`, máximo histórico real 0.145 para 27 u). Ofertas: hoy 0 activas, riesgo latente; la ventana usa `start_date/end_date` (el cliente consulta un `valid_until` inexistente en `offers`, así que su chequeo de vencimiento es inoperante: el servidor sí lo aplica).
