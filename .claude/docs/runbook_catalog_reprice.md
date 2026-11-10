# Runbook: costo en CUP y repricing del catálogo

Migraciones preparadas, NO aplicadas: `20261110100000_catalog_cost_cup_reprice.sql` y `20261110110000_currencies_show_in_selector.sql`. Aplicarlas a producción es una acción aparte que requiere el "dale" explícito del dueño del proyecto.

## Comprobaciones previas (solo lectura)
1. `20261016160000_phase0b_admin_cost_read_rpcs` debe estar aplicada (la migración nueva lo comprueba y falla con mensaje claro si no).
2. Filas activas USD->CUP por tipo: `select rate_type, count(*) from exchange_rates e join currencies f on f.id=e.from_currency_id join currencies t on t.id=e.to_currency_id where f.code='USD' and t.code='CUP' and e.is_active group by 1`. El 2026-11-10 había una sola, `general`. Si aparecen `orders` o `remittances`, alinear `readActivePairRate`/`getLiveConversionRate` con el criterio del SQL (`general` primero) antes de activar.
3. Respaldo de `products` y `combo_products` (precios y márgenes) antes de aplicar.
4. Estado de los tests de contrato `phase0bContract` y `adminCostReadRpcs`: fallan contra una BD de pruebas anterior a la migración; reconstruir la BD local con `npm run test:db:bootstrap -- --recreate` y repetirlos.

## Orden de despliegue
1. Aplicar `20261110100000` (con el "dale"). El backfill rellena `cost_cup = round(base_price * tasa_activa, 2)` en productos USD y registra una ejecución `backfill` con esa tasa: activar NO cambia ningún precio.
2. Fusionar el PR del repricing (el front detecta la columna y, si no está, guarda como hoy).
3. Comprobar: Ajustes Financieros > guardar la tasa actual sin cambios no debe pedir diálogo (cero afectados); un `apply` con la misma tasa da cero cambios.
4. Opcional: aplicar `20261110110000` (casilla "mostrar en el selector"). El front es compatible sin ella, pero la casilla da error al alternarla hasta aplicarla.

## Operación diaria
- El super admin cambia la tasa USD->CUP en Ajustes Financieros. Aparece una vista previa con tasa anterior, nueva y variación; un clic confirma y el sistema guarda la tasa y aplica el repricing.
- Variación de tasa > 10 % respecto a la última aplicada exige una segunda confirmación.
- Si el apply falla o la tasa cambió entre vista previa y aplicación (`rate_changed`), la tasa queda guardada y aparece el banner "precios desactualizados" con Reintentar.
- Los productos con costo en CUP se reprecian; los productos con precio fijo en USD (`cost_cup` nulo) no. Un UPDATE directo de `base_price` (panel de Supabase u otra ruta) anula `cost_cup` y saca el producto del repricing automático.
- Los combos se escalan por la razón `tasa_última_aplicada / tasa_nueva`.

## Limitaciones conocidas
- **Combos y baseline antiguo:** si la tasa se guarda sin apply (guardar sin repricing, `rate_changed`, apply fallido), el baseline queda en la tasa de la última ejecución. Si en ese estado se edita un combo a mano y luego se hace apply, el combo se escala por `tasa_baseline / tasa_nueva` y se reescala. Mientras el banner de "precios desactualizados" esté visible, hacer Reintentar antes de editar combos.
- **Deriva de centavos en combos:** el redondeo a centavos en cada paso puede dejar 0,01 de diferencia tras varios cambios de tasa y volver a la original. Los productos quedan exactos.
- **Carritos abiertos:** el carrito guarda el producto con su `final_price` en localStorage y `cart.pricesUpdated` solo compara contra la tasa de visualización, no contra el catálogo. Un carrito antiguo se compra al precio viejo tras un repricing. No hay validación de precio en servidor (la guarda de `order_items` está preparada y no aplicada). Seguimiento aparte.
- **Costos legibles:** `products` tiene SELECT para `anon`, por lo que `base_price` y `cost_cup` son legibles por la API hasta aplicar el contrato phase0b (`supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql`, ya incluye `cost_cup`). La nueva columna no empeora la exposición existente.

## Rollback
1. Revertir primero el front (el código que envía `cost_cup`).
2. Ejecutar `supabase/rollbacks/20261110100000_catalog_cost_cup_reprice_down.sql`: copia `cost_cup` a `public.products_cost_cup_backup_20261110` (sin acceso para roles de API), restaura `admin_list_product_costs` de 3 columnas y elimina funciones, trigger, tablas y columna. Los precios ya repreciados NO se tocan.
3. Revertir el front después del down produce un error transitorio hasta recargar.
4. Casilla del selector: `supabase/rollbacks/20261110110000_currencies_show_in_selector_down.sql`.

## Verificación posterior
- `select * from catalog_reprice_runs order by applied_at desc limit 5` y `catalog_price_history` del último run.
- Logs: sin 42703 (`cost_cup` inexistente) ni PGRST204 en `/rest/v1/products`.
- Un pedido nuevo con precios de catálogo coherentes con lo mostrado.
