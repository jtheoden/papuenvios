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

Requisitos antes de CADA paso: backup/PITR reciente confirmado en el panel de Supabase (no verificable desde aquí) y un
"dale" explícito del dueño para ESA migración. Una por una, en este orden (recomendado por la revisión independiente):

| Paso | Archivo | `name` en `apply_migration` | Qué hace | Previo | Rollback |
|---|---|---|---|---|---|
| — | `20261103124844_exchange_rates_super_admin_write.sql` | — | Policy `exchange_rates_manage` solo super_admin | **YA aplicada en prod** (misma versión). NO aplicar | `..._down.sql` |
| 1 | `20261104160200_exchange_rates_validate_distinct_currencies.sql` | `exchange_rates_validate_distinct_currencies` | `VALIDATE CONSTRAINT` | Justo antes: `SELECT count(*) FROM exchange_rates WHERE from_currency_id = to_currency_id;` = 0 | `..._down.sql` (NOT VALID otra vez) |
| 2 | `20261104160300_revoke_rate_readers_from_anon.sql` | `revoke_rate_readers_from_anon` | Quita EXECUTE a PUBLIC/anon en `get_order_exchange_rate` / `get_market_exchange_rate` | — | `..._down.sql` (ACL exacta previa) |
| 3 | `20261104160400_get_my_role_is_enabled.sql` | `get_my_role_is_enabled` | `get_my_role()` = 'user' si la cuenta no está habilitada | — | `..._down.sql` (cuerpo exacto previo) |
| 4 | `20261104160100_exchange_rate_history.sql` | `exchange_rate_history` | Tabla append-only + 6 triggers AFTER (INSERT/UPDATE/DELETE en `exchange_rates` y `remittance_types`) | — | `..._down.sql` (quita triggers, **conserva** tabla y filas) |
| 5 | `20261104160000_remittance_types_pricing_super_admin_only.sql` | `remittance_types_pricing_super_admin_only` | Solo super_admin crea tipos o cambia tasa, comisiones o par de monedas; trigger `updated_at` | **Solo después de desplegar el front F2** (rama `fix/financial-client-hardening`, commit 64ad7da9: oculta "Nuevo tipo" y los campos de tasa y comisión a quien no es super_admin, cuyo guardado no envía esas columnas) | `..._down.sql` |

### Tras CADA `apply_migration`: alinear el repo con la versión que asigna prod (no ampliar la deriva)
1. Ver la versión asignada: `list_migrations` (MCP) o
   `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;`
   → la última fila debe tener el `name` usado; anotar su `version` (V).
2. En una rama del repo, renombrar migración y rollback a esa versión:
   `git mv supabase/migrations/<TS>_<name>.sql supabase/migrations/<V>_<name>.sql` y
   `git mv supabase/rollbacks/<TS>_<name>_down.sql supabase/rollbacks/<V>_<name>_down.sql`. Actualizar las referencias:
   el mapa `M` de `src/tests/concurrency/financialDbHardeningF3.test.js`, la expresión `^20261104160[0-3]00_` de la allowlist
   de `rateFunctionsAndConstraints.test.js`, las líneas "ROLLBACK:" de las cabeceras y este runbook. Cambiar también la
   cabecera a "APPLIED IN PROD as <V>".
3. Repetir la consulta del paso 1: `ls supabase/migrations | grep <V>` debe coincidir con la fila de prod. Hay una
   alternativa sin renombrar, `supabase migration repair`, pero es más frágil y no la recomiendo con la deriva actual.

### Comprobación de cada paso (solo lectura)
- 1: `SELECT convalidated FROM pg_constraint WHERE conname = 'exchange_rates_distinct_currencies_chk';` → true.
- 2: `SELECT proname, proacl FROM pg_proc WHERE proname IN ('get_order_exchange_rate','get_market_exchange_rate');` → `{postgres=X/postgres,authenticated=X/postgres}`.
- 3: `SELECT prosrc FROM pg_proc WHERE proname = 'get_my_role';` contiene `is_enabled = true`.
- 4: `SELECT count(*) FROM exchange_rate_history;` → 0 (sin backfill). Grants: solo SELECT para authenticated y service_role.
  Los 6 triggers `exchange_rate_history_*` tienen `tgenabled = 'A'`.
- 5: `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.remittance_types'::regclass AND NOT tgisinternal;` → `guard_remittance_types_pricing` = A, `trigger_update_remittance_types_updated_at` = O.
- Después de cada paso, `exchange_rates` y `remittance_types` deben tener el mismo conteo y hash que la línea base.

## Efectos de comportamiento
1. (remittance_types) Un admin que no es super_admin ya no puede crear tipos ni cambiar `exchange_rate`,
   `commission_percentage`, `commission_fixed`, `currency_code` o `delivery_currency`; recibe 42501
   `remittance_type_pricing_super_admin_only`. Puede seguir editando el resto, activar/desactivar y borrar tipos.
   - El guard compara OLD y NEW con `IS DISTINCT FROM`: una columna que no se envía, o que se envía con su valor
     guardado, no cuenta como cambio. `remittance_types.commission_percentage` es `numeric(20,10)` (solo
     `remittances.commission_percentage` es `numeric(5,2)`), así que el super_admin la escribe con precisión completa.
   - Lo que hace F2 (rama `fix/financial-client-hardening`, commit 64ad7da9), y en lo que se apoya el guard: oculta
     "Nuevo tipo" y los campos de tasa y comisión a quien no es super_admin. El guardado de ese admin no envía
     `exchange_rate`, `commission_percentage` ni `commission_fixed`. El formulario ya no reescribe
     `commission_percentage` al editar solo nombre, límites o `is_active`; solo la recalcula si se cambia la tasa de mercado
     o la de entrega.
   - Con el front anterior a F2 (el de main hoy), que reenvía todos los campos:
     - editar el nombre o los límites sigue pasando en las 4 filas vivas, porque su comisión recalculada coincide con la
       guardada (probado en `financialDbHardeningF3.test.js`);
     - "Nuevo tipo" y cualquier cambio de tasa o comisión de un admin normal reciben el 42501.

     Por eso esta migración se aplica después de desplegar F2.
   - Los intentos rechazados no quedan en `financial_audit_log`, porque el RAISE revierte la transacción; solo quedan en el
     log de Postgres.
2. (historial) Desde la aplicación, cada alta, baja o cambio de tasa, `market_rate`, `effective_date`, `rate_type`, par de
   monedas, comisión o `is_active` deja una fila inmutable.
   - Si el historial no se puede escribir, el cambio falla (fail-closed).
   - **Un futuro platform reset no podrá borrar este historial**: los triggers append-only bloquean también a postgres.
     Borrarlo exigiría retirar a mano los triggers de inmutabilidad, con decisión explícita del dueño.
3. (revoke) `service_role` pierde EXECUTE sobre esas dos funciones, porque solo lo tenía vía PUBLIC. No hay llamadas en src/,
   en edge functions ni en otras funciones. `authenticated` aún puede llamar a `get_order_exchange_rate`, que devuelve 1.0 si
   falta la tasa (queda para F4).
4. (get_my_role) Hoy los 2 admin y los 3 super_admin están habilitados, así que nadie pierde acceso. Un admin deshabilitado
   dejaría de pasar 22 policies (bank_accounts, recipient_bank_accounts, business_visual_settings, notification_settings,
   publications, remittance_bank_transfers y el bucket `publications`).

## Pruebas (scratch local, nunca prod)
1. Scratch fresca: `TEST_DB_NAME=papuenvios_test_f3d bash scripts/test-db-bootstrap.sh`. El bootstrap reaplica TODAS las
   migraciones del repo, F3 incluida.
2. Verde: `STOCK_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/papuenvios_test_f3d npm run test:concurrency`.
   - Suites: `exchangeRatesSuperAdminWrite.test.js` y `financialDbHardeningF3.test.js`.
   - La sección (3b) añade temporalmente la forma de prod de `exchange_rates` (`market_rate NOT NULL`, `rate_type`, CHECK
     `rate_higher_than_market`) y la retira al terminar.
3. Rojo real: `F3_SKIP_MIGRATION=1` solo evita volver a aplicar las migraciones en `beforeAll`. Sobre una scratch ya
   bootstrapeada NO da rojo. Para reproducirlo:
   - Deshacer F3 en esa scratch:
     `psql "$STOCK_TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261104160000_remittance_types_pricing_super_admin_only_down.sql -f supabase/rollbacks/20261104160100_exchange_rate_history_down.sql -f supabase/rollbacks/20261104160200_exchange_rates_validate_distinct_currencies_down.sql -f supabase/rollbacks/20261104160300_revoke_rate_readers_from_anon_down.sql -f supabase/rollbacks/20261104160400_get_my_role_is_enabled_down.sql -c 'DROP TABLE IF EXISTS public.exchange_rate_history; DROP FUNCTION IF EXISTS public.exchange_rate_history_block_mutation()'`
   - Ejecutar `F3_SKIP_MIGRATION=1 npx vitest run --config src/tests/concurrency/vitest.config.js src/tests/concurrency/financialDbHardeningF3.test.js`
     (dio 24 fallos el 2026-11-05).
   - Para `exchangeRatesSuperAdminWrite.test.js`, ejecutar antes su `_down.sql`.
   - Alternativa: bootstrapear la scratch desde un checkout que todavía no tenga los archivos F3.
4. Las suites de reembolsos (`refundAuditTrail`, `refundRequests`, `refundV1RevokeAndOrphans`) pueden fallar en una corrida
   completa por contaminación previa entre suites: reaplican migraciones antiguas que vuelven a conceder
   `admin_resolve_refund` v1. Reaplicar `20261103140000_revoke_admin_resolve_refund_v1.sql` en la scratch lo corrige.

## Deriva repo↔prod encontrada (no corregida aquí)
- Solo existen en prod: `exchange_rates.market_rate` (NOT NULL, sin default), `exchange_rates.rate_type` (default 'general' +
  CHECK), el CHECK `rate_higher_than_market` y las funciones `get_order_exchange_rate` / `get_market_exchange_rate`. Por eso
  el historial lee las columnas con `to_jsonb()` y el revoke usa `to_regprocedure`.
- #144 revirtió entero #143:
  - la migración (recuperada aquí);
  - los tests de concurrencia (restaurados aquí);
  - el front de solo lectura de tasas para admin: `currencyService`, `SettingsPageFinancial`, `FxReferenceCard` (queda para F2).

## Hallazgos fuera del alcance de F3 (revisión independiente, NO implementados)
- `currencyService.saveExchangeRate` hace upsert sin `market_rate`. Al insertar una fila nueva en prod falla con 23502
  (`market_rate` es NOT NULL y no tiene default). Reproducido en la scratch con la forma de prod (test (3b)).
- Edge function `notification-settings`:
  - `checkIsAdmin` ignora `is_enabled`;
  - reenvía el JWT del usuario, así que el upsert corre bajo RLS (no con service role, como dice CLAUDE.md);
  - hace `console.log` del payload con el teléfono y el email del admin (PII en logs).
- 3 policies de `storage.objects` (bucket `publications`) llaman a `get_my_role()` sin envolverla en `(SELECT …)`, así que se
  evalúa por fila.
- `src/tests/e2e/remesas-roles.spec.js:10` ("qa-admin can view AND edit rates/commissions") contradice el nuevo contrato.
  Ajustarlo después de aplicar `remittance_types_pricing_super_admin_only`.
- `src/lib/errorHandler.js` no traduce el 42501 `remittance_type_pricing_super_admin_only` a un mensaje para el usuario.

## Decisiones pendientes del dueño (F4/F5, NO implementadas)
- **Fórmula canónica de remesa**: spread fijo (`enviado × (tasa − 20)`, lo que usa el cliente y cuadra con los datos) frente a
  comisión porcentual del servidor (`(enviado − comisión) × tasa`, `_remittance_quote`). Hoy 19/30 remesas difieren hasta 4 CUP.
- **Guards de precio a `block`** (`order_items`, `remittance`, `offer_id`): hoy están en `warn`. Pasarlos a `block` cuando los
  datos confirmen que no hay falsos positivos.
- **RPC `create_order` / `create_remittance`** que recalculen subtotal, envío, total y tasa en el servidor, y retirar el INSERT
  directo.
- **Expiración de tasa**: hay remesas `payment_pending` con tasa congelada antigua (730–830 frente a 915). Definir también la
  vigencia máxima de la tasa activa.
- **CHECKs de moneda**: `orders.currency_id` (¿solo USD?) y `remittances.currency_sent/currency_delivered` contra `currencies` /
  `remittance_types`.
- **Par inverso**: CUP→USD = 1/900 (`market_rate`) frente a 1/915 (`rate`). ¿Cuál es la referencia?
- **`rate >= market_rate`**: ¿`market_rate` es el costo de la empresa? Si lo es, el CHECK actual permite margen negativo.
- **Resto de `remittance_types` editable por admin**: `is_active`, `min_amount`, `max_amount` (el par de monedas ya queda solo
  para super_admin). ¿También solo super_admin?
- **`get_order_exchange_rate` / `get_market_exchange_rate`**: borrarlas, o hacer que lancen un error en lugar de devolver 1.0.
- F5: confirmar contra el banco el pedido de 106.04 USD validado sin transacción Zelle; reactivar la tasa EUR antes de Bizum.
