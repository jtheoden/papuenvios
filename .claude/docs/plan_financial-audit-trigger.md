# Plan: trigger de auditoría de cambios de dinero (`financial_audit_log`)

Rama: `feat/financial-audit-trigger` (desde `origin/main` f003e852). Migración: `supabase/migrations/20261020100000_financial_audit_log.sql`
(NO aplicada en producción). Rollback: `supabase/rollbacks/20261020100000_financial_audit_log_down.sql`.

## Problema (evidencia)
Un admin puede hacer PATCH directo sobre columnas de dinero de `remittances`, `orders`, `remittance_types` y `shipping_zones`
sin dejar traza: `remittance_status_history` / `order_status_history` solo auditan `status`. Verificado en prod (SELECT, 2026-10-19):
las columnas existen tal cual, `remittance_types` y `shipping_zones` no tienen ningún trigger, y no existe `financial_audit_log`.
Las únicas funciones que hacen UPDATE sobre estas tablas son `recalculate_remittance_at_current_rate` (toca dinero) y las de stock
(`_reserve/_release_order_locked`, `expire_stale_order_reservations`, `reserve_order_inventory`, `restock_order_inventory`; no tocan dinero).

## Decisiones
1. **Tabla dedicada, no `activity_logs`.** `activity_logs` (migración SEC-07 `20260809000002`) tiene TTL de 90 días vía pg_cron
   (`purge-old-activity-logs`), lo cual es incompatible con un registro financiero; además los clientes la escriben (forjable) y se
   le aplica redacción de emails que muta el contenido. La auditoría necesita: sin TTL, solo-trigger, inmutable.
2. **Una fila por columna cambiada** (no diff jsonb). Razón: la UI filtra por remesa/pedido (`row_id`), usuario (`changed_by`) y
   columna (`column_name`) con WHERE simples e índices; con jsonb habría que usar operadores `?`/`->` y el front tendría que
   “desarmar” el diff. Costo: varias filas por UPDATE multi-columna (se agrupan por `txid`/`changed_at`). Valores en `text`
   (numeric::text conserva la escala exacta; boolean y uuid también).
3. **Trigger AFTER UPDATE** (los 4 tablas) y **AFTER DELETE** (`remittance_types`, `shipping_zones`). DELETE escribe una fila por
   columna monitoreada con `new_value = NULL`. `SECURITY DEFINER`, `search_path = public, pg_temp`, EXECUTE revocado.
   Solo registra columnas con `IS DISTINCT FROM`; un UPDATE sin diferencia real no genera filas.
4. **Fail-closed.** Si la inserción de auditoría falla, falla el UPDATE. Un cambio de dinero sin traza es peor que un error; el
   trigger solo hace trabajo cuando cambió una columna monitoreada (raro: ajustes admin, recálculo, config de tipos/zonas). Se
   verificó que el INSERT de checkout no dispara (trigger solo en UPDATE), y que recálculo, cancelación, reserva de stock y
   `execute_platform_reset` (que hace DELETE de orders/remittances, y el trigger no es de DELETE en esas tablas) siguen funcionando.
5. **Actor.** `changed_by = auth.uid()`; `changed_by_role` ∈ `super_admin | admin | user | service_role | system`
   (`uid` NULL + rol GUC `service_role` → `service_role`; `uid` NULL restante, p.ej. SQL editor/postgres → `system`).
   `via_function`: nombre de la función PL/pgSQL llamadora más cercana, extraído de `PG_CONTEXT` (NULL si el cambio fue un
   UPDATE directo, p.ej. PATCH de PostgREST). Así `recalculate_remittance_at_current_rate` queda distinguible de un PATCH admin
   sin modificar esa función SECURITY DEFINER existente. Es informativo, no es prueba de seguridad.
6. **RLS/privilegios.** RLS ON; policy SELECT `(SELECT is_admin_user())`; `GRANT SELECT` a `authenticated` y `service_role`;
   `REVOKE ALL` a PUBLIC/anon/authenticated/service_role antes (los default privileges de Supabase otorgan ALL). Sin
   INSERT/UPDATE/DELETE/TRUNCATE para roles de API. No se publica en realtime. Sin FK (para que reset y deletes nunca se bloqueen).
7. **Inmutabilidad:** triggers BEFORE UPDATE/DELETE (fila) y BEFORE TRUNCATE (statement) que lanzan excepción para TODOS, incluido
   postgres/admin. Salida legítima: migración que haga `DROP TRIGGER` (queda en git). No impide `DROP TABLE` ni
   `ALTER TABLE ... DISABLE TRIGGER` a un superusuario: límite documentado.
8. **`execute_platform_reset` conserva la auditoría** (igual que `activity_logs` y `admin_destructive_ops_log`, ver cabecera de
   `20260808000002_platform_reset.sql`: “es el rastro de TODO lo hecho”). Las filas de remesas/pedidos borrados quedan huérfanas
   (sin FK) a propósito. Coherente con `runbook_platform_reset.md` (se añade una línea).
9. **Columnas monitoreadas** (única lista, dentro de la función):
   - remittances: commission_percentage, commission_fixed, commission_total, exchange_rate, amount_sent, amount_to_deliver,
     discount_amount, delivery_cost, shipping_zone_id
   - orders: subtotal, discount_amount, shipping_cost, tax_amount, total_amount, shipping_zone_id, payment_amount,
     payment_usd_reference, payment_fx_rate (los 3 últimos: importes Bizum sellados; se añaden porque son dinero)
   - remittance_types: exchange_rate, commission_percentage, commission_fixed, min_amount, max_amount, is_active, currency_code,
     delivery_currency
   - shipping_zones: shipping_cost, transport_cost, free_shipping
   Columnas de dinero futuras (p.ej. costos de courier) requieren ampliar la lista en una migración nueva.
10. **Índices:** `(table_name, row_id, changed_at DESC, id DESC)` para “historial de esta remesa/pedido” y
    `(changed_at DESC, id DESC)` para el feed global paginado. Nada por `changed_by`/`column_name` (volumen esperado: cientos de filas;
    se agrega cuando haya evidencia). Validado con EXPLAIN ANALYZE en BD scratch con datos sintéticos.
11. **Sin RPC de lectura**: SELECT directo con RLS + paginación keyset `(changed_at, id)` alcanza.
12. **Sin PII**: solo ids, nombres de columna, valores monetarios/booleanos/uuid de zona. Nada del destinatario.

## Objeciones del abogado del diablo
- *“Fail-closed puede romper el checkout/pagos.”* El INSERT no dispara el trigger. Los UPDATE de pago/cancelación/stock no
  cambian columnas monitoreadas (el trigger sale sin escribir). El único flujo que cambia dinero es el recálculo (1 remesa).
  Test explícito de cada flujo.
- *“La tabla crecerá sin TTL.”* Una fila por cambio de dinero, volumen minúsculo (27 remesas, 31 pedidos en prod). Retención: ninguna a propósito.
- *“Un admin con service_role/SQL puede deshabilitar el trigger.”* Cierto; la auditoría cubre la vía API (PATCH) y las funciones.
  Superusuario fuera de alcance (se registra en logs de Supabase).
- *“`via_function` puede falsearse.”* Solo lo escribe el trigger a partir de la pila real de la sesión; un cliente no controla PG_CONTEXT.
- *“Una fila por columna infla filas.”* Tabla chica; la simplicidad de UI pesa más. Se agrupan por `txid`.
- *“El reset debería vaciar la auditoría.”* Contradice el propósito: el reset es justo el momento en que la evidencia debe sobrevivir.
- *“Los valores en text pierden tipo.”* El UI muestra texto; numeric::text es lossless y comparable por `column_name`.

## Orden de aplicación (prod, requiere “dale” separado)
1. Pre-chequeos SELECT (columnas existen, `financial_audit_log` ausente, `is_admin_user` existe).
2. `apply_migration` de `20261020100000_financial_audit_log.sql` (una transacción implícita; idempotente).
3. Post-chequeos: tabla/RLS/grants, 5 triggers (remittances, orders, remittance_types ×2, shipping_zones ×2) y triggers de inmutabilidad;
   `get_advisors` security.
4. Smoke manual: UPDATE inofensivo en una zona dentro de transacción con ROLLBACK no deja filas; un cambio real sí.

## Rollback exacto
Ver `supabase/rollbacks/20261020100000_financial_audit_log_down.sql` (DROP de 6 triggers de auditoría, función, triggers de inmutabilidad y tabla).
Pierde las filas de auditoría: exportarlas antes si ya hay datos.

## Etapas
1. Tests rojos (`src/tests/concurrency/financialAuditLog.test.js`) → 2. Migración + rollback → 3. Verde → 4. Suite completa + vitest + build →
5. EXPLAIN ANALYZE, limpieza (DROP DATABASE scratch) → 6. Runbook reset (nota).
