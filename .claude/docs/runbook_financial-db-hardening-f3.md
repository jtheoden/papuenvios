# Runbook: Fase 3 de la auditoría financiera (endurecimiento de BD), migraciones PREPARADAS

Origen: `.claude/docs/audit-report-financiero-monedas-2026-11-04.md`. Rama `feat/financial-db-hardening`.
**Nada de esto está aplicado en producción.** Aplicar es una decisión posterior del dueño ("dale"), una migración cada vez.

## Principio
Ninguna migración borra, reescribe ni rellena filas. Solo crean o reemplazan una policy, triggers, funciones, una tabla nueva
vacía, un `VALIDATE CONSTRAINT` y un `REVOKE`. Cada una tiene su rollback en `supabase/rollbacks/<nombre>_down.sql`.
No se tocan `_order_transition` ni `_remittance_transition`.

## Línea base de prod (2026-11-05, solo lectura)
| Tabla | Filas | Hash md5 (columnas clave) |
|---|---|---|
| exchange_rates (id, rate, market_rate, is_active, effective_date) | 21 | 105cca5de9596340b5e13e8da5f6908c |
| remittance_types (id, exchange_rate, commission_percentage, commission_fixed, is_active, updated_at) | 4 | a9016470bff0f0629af9b0429ad3f429 |
| remittances (id, exchange_rate, amount_to_deliver, status) | 31 | 22093c28cb444bfae844292cc96a0432 |
| orders (id, total_amount, status) | 34 | 9d0c9c81b7f4b1d771d74bdbf9c2b2a8 |
| financial_audit_log | 34 (max id 42) | solo crece |

Después de cada migración, `exchange_rates` y `remittance_types` deben tener el mismo conteo y hash (las migraciones no escriben
filas). orders y remittances pueden crecer por el uso normal.

## Orden y comandos (vía `apply_migration` con el contenido del archivo, nunca `supabase db push`)
`db push` no es seguro hoy: varias versiones en prod no coinciden con los nombres de archivo del repo (p. ej. repo
`20261103130000_*`, prod `20261104121046`), porque `apply_migration` asigna su propio timestamp.

| # | Archivo | Qué hace | Previo | Rollback |
|---|---|---|---|---|
| 0 | `20261103124844_exchange_rates_super_admin_write.sql` | Policy `exchange_rates_manage` solo para super_admin | **YA aplicada en prod** (misma versión). No aplicar: solo se recupera en el repo | `..._down.sql` (vuelve a permitir a cualquier admin) |
| 1 | `20261104160000_remittance_types_pricing_super_admin_only.sql` | Trigger: solo super_admin crea tipos o cambia `exchange_rate`, `commission_percentage` y `commission_fixed`; trigger `updated_at` | Desplegar antes el front F2 que oculte esos campos a los admin no super | `..._down.sql` |
| 2 | `20261104160100_exchange_rate_history.sql` | Tabla append-only + 4 triggers AFTER | — | `..._down.sql` (quita los triggers y **conserva** la tabla y sus filas) |
| 3 | `20261104160200_exchange_rates_validate_distinct_currencies.sql` | `VALIDATE CONSTRAINT` | Ejecutar justo antes: `SELECT count(*) FROM exchange_rates WHERE from_currency_id = to_currency_id;` debe dar 0 | `..._down.sql` (la vuelve a crear NOT VALID) |
| 4 | `20261104160300_revoke_rate_readers_from_anon.sql` | Quita EXECUTE a PUBLIC/anon en `get_order_exchange_rate` y `get_market_exchange_rate` | — | `..._down.sql` (ACL exacta previa) |
| 5 | `20261104160400_get_my_role_is_enabled.sql` | `get_my_role()` devuelve 'user' si la cuenta está deshabilitada | — | `..._down.sql` (cuerpo exacto previo) |

Comprobación tras cada paso (solo lectura):
- 1: `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.remittance_types'::regclass AND NOT tgisinternal;` → `guard_remittance_types_pricing` = A, `trigger_update_remittance_types_updated_at` = O.
- 2: `SELECT count(*) FROM exchange_rate_history;` → 0 (no hay backfill). Grants: solo SELECT para authenticated y service_role.
- 3: `SELECT convalidated FROM pg_constraint WHERE conname = 'exchange_rates_distinct_currencies_chk';` → true.
- 4: `SELECT proname, proacl FROM pg_proc WHERE proname IN ('get_order_exchange_rate','get_market_exchange_rate');` → `{postgres=X/postgres,authenticated=X/postgres}`.
- 5: `SELECT prosrc FROM pg_proc WHERE proname = 'get_my_role';` contiene `is_enabled = true`.

Antes de empezar, confirmar que hay un backup/PITR reciente en el panel de Supabase (no se puede verificar desde aquí).

## Efectos de comportamiento
1. (1) Un admin que no es super_admin ya no puede crear tipos de remesa ni cambiar su tasa o comisión; recibe 42501
   `remittance_type_pricing_super_admin_only`. Puede seguir editando el resto, activar/desactivar y borrar tipos. El formulario
   reenvía tasa y comisión en cada guardado: en las 4 filas vivas el valor recalculado coincide exactamente con el guardado,
   así que editar el nombre no falla. Los intentos rechazados no quedan en `financial_audit_log`, porque el RAISE revierte la
   transacción; solo quedan en el log de Postgres.
2. (2) A partir de la aplicación, cada alta o cambio de tasa, comisión, `market_rate` o `is_active` deja una fila inmutable.
   Si el historial no se puede escribir, el cambio de tasa falla (fail-closed).
3. (4) `service_role` pierde EXECUTE sobre esas dos funciones, porque lo tenía solo vía PUBLIC. No hay ninguna llamada a
   ellas en src/, en las edge functions ni en otras funciones.
4. (5) Hoy los 2 admin y los 3 super_admin están habilitados, así que nadie pierde acceso. Un admin deshabilitado dejaría de
   pasar 22 policies (bank_accounts, recipient_bank_accounts, business_visual_settings, notification_settings, publications,
   remittance_bank_transfers y el bucket `publications`).

## Pruebas (scratch local, nunca prod)
`TEST_DB_NAME=papuenvios_test_f3 bash scripts/test-db-bootstrap.sh` y después
`STOCK_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/papuenvios_test_f3 npm run test:concurrency`.
Suites: `src/tests/concurrency/exchangeRatesSuperAdminWrite.test.js` y `financialDbHardeningF3.test.js`.
Con `F3_SKIP_MIGRATION=1` se obtiene la fase roja.

## Deriva repo↔prod encontrada (no corregida aquí)
- `exchange_rates.market_rate`, el CHECK `rate_higher_than_market` y `exchange_rates.rate_type` existen en prod y no en el
  repo. `get_order_exchange_rate` y `get_market_exchange_rate` también existen solo en prod. Por eso las migraciones 2 y 4
  están escritas para funcionar con y sin esos objetos.

## Decisiones pendientes del dueño (F4/F5, NO implementadas)
- **Fórmula canónica de remesa**: spread fijo (`enviado × (tasa − 20)`, lo que usa el cliente y cuadra con los datos) frente a
  comisión porcentual del servidor (`(enviado − comisión) × tasa`, `_remittance_quote`). Hoy 19/30 remesas difieren hasta 4 CUP.
- **Guards de precio a `block`** (`order_items`, `remittance`, `offer_id`): hoy están en `warn`. Pasar a `block` tras confirmar
  con datos que no hay falsos positivos.
- **RPC `create_order` / `create_remittance`** que recalculen subtotal, envío, total y tasa en el servidor, y retirar el INSERT
  directo.
- **Expiración de tasa**: remesas `payment_pending` con tasa congelada antigua (730–830 frente a 915); vigencia máxima de la
  tasa activa.
- **CHECKs de moneda**: `orders.currency_id` (¿solo USD?) y `remittances.currency_sent/currency_delivered` contra `currencies` /
  `remittance_types`.
- **Par inverso**: CUP→USD = 1/900 (`market_rate`) frente a 1/915 (`rate`). ¿Cuál es la referencia?
- **`rate >= market_rate`**: ¿`market_rate` es el costo de la empresa? Si lo es, el CHECK actual permite margen negativo.
- **Resto de `remittance_types` editable por admin**: `currency_code`, `delivery_currency`, `min_amount`, `max_amount`. ¿También
  solo super_admin?
- **`get_order_exchange_rate` / `get_market_exchange_rate`**: borrarlas o hacer que lancen error en lugar de devolver 1.0.
- F5: confirmar contra el banco el pedido de 106.04 USD validado sin transacción Zelle; reactivar la tasa EUR antes de Bizum.
