# Plan: costo en CUP y repricing automático por tasa

Estado: aprobado por el usuario el 2026-11-09 ("proceed with the recommendations you support"). Nada se aplica a producción sin un "dale" explícito por migración.

## Problema
El dueño compra en CUP y vende en USD. El vendedor teclea el costo en CUP, el sistema lo convierte a USD con la tasa de ese momento y guarda solo `products.base_price` (USD). Al cambiar la tasa informal, el USD queda viejo y el margen se erosiona. `cost_price` está vacío en los 60 productos: el costo CUP original no existe en la base de datos.

## Fórmula
`base_price (USD) = round(cost_cup / rate_USD_CUP, 4)`; `final_price` sigue siendo la columna generada `round(base_price * (1 + profit_margin/100), 2)`.
Combos (rediseñado tras la revisión, 2026-11-10): los 16 combos con componentes tienen `base_total_price` entre un 5 % y un 25 % distinto de la suma de sus productos (datos reales), así que NO se recalculan por suma. Cada apply los escala por razón de tasas: `base_total_price = round(base_total_price * tasa_última_aplicada / tasa_nueva, 2)`. Misma tasa = sin cambios.
La tasa es `exchange_rates.rate` del par USD→CUP activo (la que el dueño edita), nunca `market_rate` ni la fila inversa CUP→USD (6 decimales, pierde precisión).

## Decisiones tomadas (recomendación del asistente, aprobadas)
- Opción B: repricing como evento controlado (RPC `SECURITY DEFINER`), no cálculo en lectura ni trigger silencioso.
- Simétrico: el USD baja si el dólar sube, para sostener el margen.
- Umbral de confirmación extra: 10 % respecto a la última tasa aplicada.
- Pedidos y cobro siguen en USD; pedidos existentes no cambian (importes congelados).
- Productos sin `cost_cup` no se tocan: hoy no cambia ningún precio.
- Costos (actualizado por el usuario el 2026-11-09: "do not make repricing too tedious, the existing values are the ones, eventually he will change them"): sin pantalla de validación. La migración rellena `cost_cup = round(base_price * tasa_activa, 2)` para productos USD sin costo, de modo que activar no cambia ningún precio (round-trip exacto) y el dueño edita los costos en el formulario del vendedor cuando quiera.
- Casilla `show_in_selector` por moneda: rama aparte, independiente.

## Diseño SQL (fase 1)
- `products.cost_cup numeric(14,2) NULL CHECK (cost_cup IS NULL OR cost_cup >= 0)`.
- `catalog_reprice_runs`: id, rate, previous_rate, pct_change, status, applied_by, applied_at, products_updated, combos_updated, skipped_combos.
- `catalog_price_history`: run_id, entity_type ('product'|'combo'), entity_id, old_base, new_base, rate.
- `preview_catalog_reprice(p_rate numeric default null) returns jsonb`: STABLE, solo super_admin; cuenta productos y combos afectados, variación media y máxima, `requires_extra_confirmation`, muestra de ítems.
- `apply_catalog_reprice(p_confirm_large boolean default false) returns jsonb`: lee la tasa activa USD→CUP, re-verifica `is_super_admin()`, `pg_advisory_xact_lock(hashtext('catalog_reprice'))`, rechaza tasa no positiva, exige `p_confirm_large` si |variación| > 10 %, actualiza productos con `cost_cup` y moneda base USD, recalcula combos completos, escribe historial, ejecución y auditoría. Idempotente: misma tasa dos veces = cero cambios.
- GRANT EXECUTE solo a `authenticated`; RLS en las tablas nuevas: lectura admin, sin escritura directa.
- Rollback en `supabase/rollbacks/`. Patrón de referencia: `20260808000001_bulk_delete_products_categories.sql` y `20260808000002_platform_reset.sql`.

## Fases
1. SQL + pruebas con PostgreSQL real (agente A). Migración preparada, no aplicada.
2. Formulario del vendedor guarda `cost_cup` sin convertir (productos) y recalcula combos.
3. (Eliminada: no hay pantalla de carga de costos; el backfill automático de la migración la sustituye.)
4. Flujo de tasas con un solo paso para el dueño: al guardar la tasa, un diálogo temático muestra la vista previa ("N productos y M combos, variación media X %") y un clic confirma; la segunda confirmación solo aparece si la tasa se mueve más de 10 %. Guardar tasa -> `apply_catalog_reprice`; indicador de "precios desactualizados" si la última ejecución difiere de la tasa activa, con botón de reintento.
5. Activación: respaldo de `products`/`combo_products`, "dale" para aplicar la migración (el backfill no cambia precios), comprobar que la primera ejecución con la tasa actual da cero cambios.

## Casilla show_in_selector (rama aparte, agente B)
Columna `currencies.show_in_selector boolean not null default true`; el selector público filtra, el contexto conserva todas las monedas, los formularios de vendedor/admin usan la lista completa; no se puede ocultar la moneda base ni la última visible; casilla en la gestión de monedas de Ajustes Financiero. Migración preparada, no aplicada.

## Riesgos abiertos
- Si `base_price` no admite 4 decimales, decidir precisión (probar).
- Precio de envío fuera de provincia en combos (`out_of_province_price`): no se reprecia en esta fase.
- Guarda `order_items` (migración preparada, no aplicada) asume USD y un piso del 50 %: revisar antes de aplicarla.
- Carritos abiertos (corregido por la revisión): `cart.pricesUpdated` solo compara contra la tasa de visualización, no contra `final_price` del catálogo; el carrito guarda el producto con su `final_price` en localStorage, así que un carrito antiguo se compra al precio viejo tras un repricing. No hay validación de precio en el servidor (la guarda de `order_items` está preparada y no aplicada). Fuera del alcance de estos PR: seguimiento aparte (re-consultar `final_price` por id al confirmar).
- Trigger de sincronía: un UPDATE de `base_price` sin cambiar `cost_cup` anula `cost_cup` (el precio manual gana y el producto sale del repricing automático).
- Orden de despliegue: la migración antes que el código de la fase 2; el código detecta la columna y, si no existe, guarda como hoy. Rollback: revertir el front antes de ejecutar el down.

## Trazabilidad
Actualizar `TRACKING_PROGRESS.md` (hay ediciones sin confirmar de Codex: anexar, no reemplazar) y Engram al cerrar cada fase.
