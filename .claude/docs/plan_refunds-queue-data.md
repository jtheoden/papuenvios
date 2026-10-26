# Plan: cola de devoluciones (operaciones canceladas ya pagadas) — capa de datos/backend

Estado: DISEÑO. **ND-1..8 aprobados por el dueño tal como se recomendaron + ajuste de política (rev. 2): espera de 48 h antes de reembolsar (ver §3 y §10).**
Estado previo: DISEÑO. No se implementó nada, no se aplicó nada a Supabase. Base: `origin/main` @ 51e18bf9.
Alcance: datos, RPC, ventana de tiempo, contador/notificaciones. La UI admin se diseña aparte (aquí solo el contrato de servicios).

## 1. Hallazgos (verificados)

### 1.1 No existe nada de devoluciones
- `refund_requests`, `business_holidays` y cualquier RPC de reembolso: inexistentes en prod (`to_regclass` = NULL) y en `supabase/migrations`.
- Solo hay texto: `TermsPage.jsx` §9 y `legalConfig.js` (`REFUND_BUSINESS_DAYS = 5`, "proposal"). Los `user_alerts` ya tienen tipos `order_cancelled`/`remittance_cancelled` (solo para el cliente, definidos en `userAlertService.js`).

### 1.2 Conteos en prod (SELECT agregado, hoy)
| Entidad | Estado | Filas |
|---|---|---|
| orders | cancelled (cualquier payment_status) | **0** |
| orders | pending / proof_uploaded | 1 (candidata futura: si se cancela, queda "no verificado") |
| orders | processing/dispatched/delivered/completed, validated | 3/8/2/16 |
| remittances | cancelled | **0** |
| remittances | payment_proof_uploaded | 1 |
| remittances | payment_rejected (con comprobante) | 3 |
| remittances | payment_pending | 7 |
| remittances | payment_validated/processing/delivered/completed | 3/8/2/3 |

Todo es `payment_method='zelle'` (30 pedidos, 27 remesas, USD). `orders.payment_currency/payment_amount` (Bizum, EUR) existen en el esquema pero están en NULL. Admins: 5 de 44 usuarios.
**Conclusión backfill: hay 0 cancelaciones, se parte de cero.** Riesgo: hasta el despliegue alguien podría cancelar (la rama `fix/commission-cancel-ux` y el diseño de aceptación de comisión aumentan cancelaciones). Runbook: re-ejecutar el conteo justo antes de aplicar; si >0, backfill manual (ver §6 E1).

### 1.3 Cómo cancela hoy cada rol (migraciones 20261024110000 / 20261024110100)
- **Pedidos** (`_order_transition`, 'cancel'): admin cancela `pending|processing` (payment_status SIN tocar); dueño cancela `pending` y `payment_status<>'validated'` y **sobrescribe `payment_status='rejected'`** aunque hubiera `proof_uploaded`. Se guarda el motivo en `rejection_reason`. **No hay `cancelled_at` ni `cancelled_by` en `orders`** (solo `updated_at`, e `order_status_history`).
- **Remesas** (`_remittance_transition`): solo el dueño cancela, desde `payment_pending|payment_rejected|payment_proof_uploaded`; escribe `cancelled_at`, `cancelled_by`, `cancellation_reason`. **Hoy una remesa cancelada NUNCA tiene pago validado** (no hay cancel admin ni tras validar). Aviso de deriva: el cuerpo vivo de `_remittance_transition` NO es el de 20261024110100 (20261025110000 lo reemplazó, ver `plan_commission-client-acceptance.md` línea 36) → el diseño no debe reemplazar esos helpers.
- **Reabrir** (`order_reopen`): el dueño reabre un pedido `cancelled` con `payment_status IN (pending,rejected,proof_uploaded)` → `pending/pending`. Tras cancelación del dueño `payment_status='rejected'`, o sea reabrible. Con pago validado no se puede reabrir.
- Triggers existentes: `release_stock_on_order_cancel` (AFTER UPDATE en orders) = precedente directo del patrón "trigger al pasar a cancelled". Hay `guard_status_via_rpc` (BEFORE) y `audit_*_status` (AFTER) en ambas tablas; sin colisión de nombre con el nuevo.

### 1.4 Dato clave: "pagado" no es derivable después de cancelar
Para pedidos, la cancelación del dueño destruye la evidencia (`payment_status` pasa a `rejected`) y un comprobante rechazado por el admin conserva `payment_proof_url`. Por tanto una **vista derivada** (`status='cancelled' AND payment_proof_url IS NOT NULL`) mezcla: comprobante rechazado (no hubo pago), comprobante sin verificar (puede haber pago), validado (hubo pago). El estado correcto solo existe en la fila `OLD` en el instante de la transición → **hay que capturarlo en ese instante**.

### 1.5 Definiciones de "pago recibido"
- **`validated`** (pago confirmado por admin): pedidos `OLD.payment_status='validated'`; remesas `OLD.payment_validated_at IS NOT NULL` (o status ∈ payment_validated|processing|delivered; hoy imposible de cancelar, el diseño lo soporta si el otro diseño agrega cancel admin).
- **`proof_unverified`** (comprobante subido, el admin aún no verificó en Zelle; el dinero puede haber llegado): pedidos `OLD.payment_status='proof_uploaded'`; remesas `OLD.status='payment_proof_uploaded'`. Entra en la cola con la etiqueta "verificar recepción primero"; el admin la resuelve como reembolsada o `not_applicable` ("no llegó el dinero").
- **No genera devolución**: `pending`; `rejected` (el admin rechazó el comprobante); `payment_pending`; `payment_rejected`.
- Monto: pedidos `total_amount` (USD) — si `payment_currency IS NOT NULL` (Bizum) `payment_amount` en esa moneda; remesas `amount_sent + COALESCE(delivery_cost,0)` (= `calcTotalToPay`, `remittanceService.js:977`). Política: se reembolsa el total pagado.

### 1.6 Notificaciones hoy
- Badge del avatar admin: `Header.jsx` `loadPendingCount` = `getPendingOrdersCount()` (RPC `get_pending_orders_count`, `SECURITY DEFINER`, solo admin, cuenta `status='pending' OR payment_status='pending'`) + `getPendingRemittancesCount()`; refresco con `useRealtimeOrders` + `useRealtimeRemittances` + polling 30 s.
- Publicación `supabase_realtime` contiene SOLO `orders` y `remittances` (verificado). Cancelar es un UPDATE de esas tablas → el badge ya se refresca solo; `refund_requests` NO necesita estar en la publicación para el evento de alta.
- Canales: `notification_settings` tiene `admin_email`, `site_email`, `whatsapp_admin_phone`, `whatsapp_group`, `whatsapp_target`. En código, WhatsApp son enlaces `wa.me` abiertos por el navegador del usuario (`whatsappService.js`); no hay envío server-side al admin; la Edge Function `notify-zelle-deactivation` es solo email por Resend a clientes. **No existe canal push al admin**: la notificación realista es in-app (badge/Dashboard). `user_alerts` es de cliente (RLS por `user_id`), no sirve para admin.

### 1.7 Interacciones
- `plan_commission-client-acceptance.md` (worktree ae8f4c72): usa migraciones **20261028100000–100300**, NO toca `_remittance_transition`, cancela con `remittance_cancel(reason='commission_declined')`, y agrega `guard_commission_acceptance` (trigger sobre remittances). Mi trigger es AFTER UPDATE independiente → compatible; la cancelación por rechazo de comisión desde `payment_proof_uploaded` generará automáticamente una fila `proof_unverified` (su ND-7 pregunta si ese caso merece trato prioritario; ver ND-7 aquí).
- Rama `fix/commission-cancel-ux`: local = `origin/main` (0/0 commits de diferencia). No pude ver trabajo sin commitear del otro escritor.
- `execute_platform_reset` hace `DELETE FROM orders/remittances`: una FK sin cascade lo rompería (precedente `financial_audit_log`: sin FK por eso). Ver §2.

## 2. Diseño recomendado: (b) tabla `refund_requests` poblada por TRIGGER

### Alternativas
| Opción | Pro | Contra | Veredicto |
|---|---|---|---|
| (a) Vista derivada + tabla mínima de resolución | Sin trigger | **No distingue pagado/rechazado/sin verificar en pedidos (§1.4)**; due_at y monto se recalculan sobre filas mutables; JOIN doble; badge más caro | Descartada por pérdida de información |
| (b1) Poblar desde `_order_transition`/`_remittance_transition` | Explícito | Hay que `CREATE OR REPLACE` ambos helpers (deriva de prod, choque con el otro diseño y con la rama del otro escritor); no cubre caminos futuros ni UPDATE directo de servicio | Descartada |
| **(b2) Trigger AFTER UPDATE en orders y remittances** | No toca helpers; cubre TODOS los caminos (cliente, admin, futuro cancel admin, aceptación de comisión); `OLD` conserva el estado de pago; precedente `release_stock_on_order_cancel` | Lógica "oculta" en trigger (mitigado con tests y comentario de migración) | **Recomendada** |
| (c) Columnas en orders/remittances (`refund_status`, ...) | Sin tabla | Contamina tablas calientes con guards de dinero; sin historial de ciclos cancel/reabrir | Descartada |

### Tabla `public.refund_requests`
```
id uuid pk default gen_random_uuid()
order_id uuid null  references orders(id)       on delete cascade
remittance_id uuid null references remittances(id) on delete cascade
check ((order_id is null) <> (remittance_id is null))             -- exactamente una
operation_type text generated: 'order' | 'remittance'  (o columna + check coherente)
user_id uuid not null                                              -- cliente (snapshot, sin FK para no bloquear borrado de usuario)
payment_evidence text not null check in ('validated','proof_unverified')
amount numeric(10,2) not null check (amount > 0)
currency text not null default 'USD'
payment_method text not null                                       -- 'zelle' hoy; 'bizum' futuro
zelle_account_id uuid null                                         -- cuenta que RECIBIÓ el pago (snapshot)
payment_reference text null, payer_phone text null                 -- snapshot de remesa/pedido
cancellation_reason text null                                      -- orders.rejection_reason / remittances.cancellation_reason
cancelled_at timestamptz not null default now()
cancelled_by uuid null, cancelled_by_role text null check in ('customer','admin','system')
eligible_at timestamptz not null                                   -- cancelled_at + REFUND_HOLD_HOURS (48 h): no se reembolsa antes
due_at timestamptz not null                                        -- add_business_days(eligible_at, REFUND_BUSINESS_DAYS) (rev. 2: el plazo corre desde eligible_at)
status text not null default 'pending' check in ('pending','refunded','not_applicable')
refund_reference text null, refunded_at timestamptz null           -- referencia/fecha Zelle del reembolso (la fecha la teclea el admin)
resolution_reason text null                                        -- motivo "no procede" / 'reopened'
resolved_by uuid null, resolved_at timestamptz null
created_at timestamptz not null default now()
check (due_at > eligible_at and eligible_at >= cancelled_at)
check (status = 'pending' or resolved_at is not null)
-- rev. 2: la espera se hace cumplir en admin_resolve_refund (no en un CHECK: now() no es inmutable), ver §4
check (status <> 'refunded' or (refund_reference is not null and refunded_at is not null))
check (status <> 'not_applicable' or char_length(btrim(resolution_reason)) between 1 and 500)
```
- **Sin duplicados / sin doble reembolso:** índices únicos PARCIALES `unique(order_id) where status='pending'` y `unique(remittance_id) where status='pending'` (a lo más una abierta por operación). Permiten ciclos legítimos: cancelar → resolver → reabrir → pagar → cancelar de nuevo = otra fila. El trigger inserta con `ON CONFLICT (...) WHERE status='pending' DO NOTHING` (idempotente). La resolución exige `FOR UPDATE` + `status='pending'`; reintento con mismos parámetros devuelve la fila (idempotente), parámetros distintos → `already_resolved`.
- **FK con CASCADE** (no sin FK): mantiene integridad y no bloquea `execute_platform_reset` (reset legítimo = datos de prueba). Tradeoff: si algún día se borra un pedido físicamente se pierde el pasivo; hoy solo ocurre en el reset (ND-6).
- **RLS/GRANT** (patrón 20261027100000): `ENABLE RLS`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT SELECT ... TO authenticated`; UNA policy SELECT `USING ((SELECT public.is_admin_user()))`. Cero INSERT/UPDATE/DELETE para cualquier rol API (escribe solo trigger/RPC definer). Sin realtime.
- Índices: `(status, eligible_at, due_at)` parcial `where status='pending'` (cola y conteos); `(user_id)`; los dos únicos parciales.

### Trigger `trg_refund_request_on_cancel` (SECURITY DEFINER, `search_path=public,pg_temp`, REVOKE EXECUTE de PUBLIC/anon/authenticated)
- `AFTER UPDATE OF status ON orders` / `remittances` `WHEN (NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')`.
- Evalúa `OLD` según §1.5; si no hay evidencia, no hace nada. Inserta la fila (snapshots). `cancelled_by = auth.uid()`; rol = `is_admin_user()` → 'admin', `auth.uid()` null → 'system', si no 'customer'.
- Segundo trigger (o rama) `AFTER UPDATE`: `OLD.status='cancelled' AND NEW.status<>'cancelled'` (reabrir): si hay fila `pending` → `not_applicable` con `resolution_reason='reopened'`, `resolved_by=auth.uid()`. Caso `proof_unverified` reabierto: el dinero podría haber llegado; DECIDIDO por el dueño (ND-5): se cierra sola, NO se bloquea la reapertura (gana este diseño sobre el de UX que proponía bloquear). Etiqueta de UI: "reabierto". Aplica también cuando la fila está en `on_hold`.
- No escribe en orders/remittances → no dispara guards de dinero ni de status.

## 3. Ventana: espera de 48 h + 5 días hábiles (rev. 2)

Política (dicha por el cliente, aprobada por el dueño): los reembolsos **empiezan 48 horas después de la cancelación**. Modelo:
```
cancelled_at
eligible_at = cancelled_at + REFUND_HOLD_HOURS                        (48 h reales, intervalo exacto; no hábiles)
due_at      = add_business_days(eligible_at, REFUND_BUSINESS_DAYS)    (5 días hábiles, lun-vie, America/New_York)
```
- **48 h reales y no hábiles:** el texto dice "48 horas"; contar horas hábiles no está en la política y complica el SQL. Una cancelación el viernes 18:00 ET es elegible el domingo 18:00 ET y su plazo corre desde ahí (`add_business_days` salta el fin de semana; día 1 = lunes).
- **Qué significa para el admin:** antes de `eligible_at` la fila existe pero NO es accionable: el botón "marcar reembolsado" se deshabilita y `admin_resolve_refund('refunded')` rechaza con `22023 refund_on_hold` (DETAIL=`eligible_at`). Sí se permite `not_applicable` antes de `eligible_at` (p. ej. "no llegó el dinero": no hay nada que esperar). Plazo máximo prometido al cliente: 48 h + 5 días hábiles desde la cancelación.
- **Regla de días hábiles:** lunes–viernes, `America/New_York`, sin festivos en v1 (ND-3 aprobado). `add_business_days(p_from timestamptz, p_days int) returns timestamptz` (STABLE, `SET search_path=pg_catalog`): `d := (p_from AT TIME ZONE 'America/New_York')::date; repetir p_days veces: d := d+1; mientras isodow(d) in (6,7): d := d+1; devolver ((d+1)::timestamp) AT TIME ZONE 'America/New_York'` (fin del 5º día hábil; DST resuelto por la zona nombrada). `eligible_at` se calcula con `cancelled_at + make_interval(hours => refund_hold_hours())` (suma sobre el instante, no sobre hora de pared). Constantes en la migración: `refund_hold_hours()=48` y `refund_business_days()=5` (funciones IMMUTABLE de una línea; test que las compara con `legalConfig.js` leyendo el archivo).
- **`eligible_at` y `due_at` se guardan** (calculados por el trigger desde `cancelled_at`): la promesa al cliente no se mueve si cambia la política. Los estados de la cola se calculan **al leer** con `now()`.
- **Estados de la cola** (`queue_state`, derivado, no se guarda; solo para `status='pending'`):
  | `queue_state` | Condición | Acción admin |
  |---|---|---|
  | `on_hold` (en espera de 48 h) | `now() < eligible_at` | No reembolsable aún (solo "no procede") |
  | `on_time` (en plazo) | `now() >= eligible_at` y `due_at - now() >= 24 h` | Reembolsar |
  | `due_soon` (vence en <24 h) | `now() >= eligible_at` y `0 < due_at - now() < 24 h` | Reembolsar, prioridad |
  | `overdue` (vencido) | `now() >= due_at` | Reembolsar, prioridad máxima |
  Orden de la lista: `overdue`, `due_soon`, `on_time`, `on_hold`; dentro de cada grupo por `due_at` asc.
- **Espejo JS:** `src/lib/refundWindow.js` (puro, patrón Intl de `dashboardMetrics.js`): `addBusinessDays(isoOrDate, n)`, `refundEligibleAt(cancelledAt)` (usa `REFUND_HOLD_HOURS` de `legalConfig.js`), `refundDueAt(cancelledAt)`, `refundQueueState({ eligibleAt, dueAt }, now)`. Fuente de verdad = BD; el JS solo muestra y hace correr el contador.
- **Vectores compartidos** `src/tests/fixtures/refund-window-vectors.json` (Vitest y test de BD). Cada vector: `cancelled_at` → `eligible_at` → `due_at` (se guardan en UTC; aquí en ET):
  1. Lun 26-oct-2026 10:00 ET → elegible Mié 28-oct 10:00 ET → jue 29 (1), vie 30 (2), lun 2-nov (3), mar 3 (4), mié 4 (5) → `due_at` = Jue 5-nov 00:00 ET (05:00 UTC, ya EST).
  2. Vie 23-oct 18:00 ET → elegible Dom 25-oct 18:00 ET → lun 26 (1) … vie 30 (5) → `due_at` = Sáb 31-oct 00:00 ET (04:00 UTC, EDT).
  3. Sáb 24-oct 12:00 ET → elegible Lun 26-oct 12:00 ET → mar 27 (1) … lun 2-nov (5) → `due_at` = Mar 3-nov 00:00 ET.
  4. Cancelación 23:30 ET (UTC ya es el día siguiente) → elegible 23:30 ET dos días después; fija que el día hábil se evalúa en ET y no en UTC.
  5. DST: cancelación Vie 30-oct 12:00 ET (EDT, 16:00 UTC) → +48 h reales = Dom 1-nov 16:00 UTC = 11:00 ET (EST; el cambio fue a las 06:00 UTC) → lun 2 (1) … vie 6 (5) → `due_at` = Sáb 7-nov 00:00 ET (05:00 UTC). Fija "48 h reales" vs "2 días de calendario" (que daría 12:00 ET).
  6. Estados: `now` = eligible_at − 1 s (`on_hold`); = eligible_at (`on_time`); = due_at − 24 h − 1 s (`on_time`); = due_at − 24 h (`due_soon`); = due_at − 1 s (`due_soon`); = due_at (`overdue`).
  7. Constantes: `REFUND_HOLD_HOURS` (JS) == `refund_hold_hours()` (SQL); `REFUND_BUSINESS_DAYS` == `refund_business_days()`; y `REFUND_HOLD_HOURS` no se importa ni se deriva de `CLAIM_WINDOW_HOURS`.

## 4. RPC y seguridad (todas `SECURITY DEFINER`, `search_path=public,pg_temp`, REVOKE PUBLIC/anon, GRANT authenticated, rol interno `is_admin_user()`; patrón 20261024110100)

1. `admin_list_refunds(p_status text default 'pending', p_limit int default 100, p_offset int default 0) returns jsonb/setof`: valida admin (`42501 not_authorized`); une cliente (nombre/email desde `user_profiles`), número de operación (`order_number`/`remittance_number`), cuenta Zelle (alias/email vía `zelle_accounts`, enmascarar lo que ya enmascare el panel de Zelle) y `payment_proof_url` de la operación (para firmar la URL con el flujo de comprobantes privados existente). Calcula `queue_state` (§3) con `now()` y devuelve `eligible_at` y `due_at`. Filtro opcional `p_queue_state`. Orden: `overdue`, `due_soon`, `on_time`, `on_hold`; luego `due_at` asc. Límite máx 200.
2. `admin_refund_counts() returns jsonb` → `{actionable, on_hold, due_soon, overdue, pending_amount_usd}` con `actionable` = pendientes con `now() >= eligible_at` (una sola query agregada sobre el índice parcial). **Recomendación: el badge cuenta solo `actionable`** (lo que el admin puede y debe hacer hoy; contar las `on_hold` deja un número que no se puede bajar durante 48 h y habitúa a ignorarlo). Las `on_hold` se muestran en la vista y en el Dashboard como "en espera: N" sin sumar al badge. Alternativa: sumarlas atenuadas (aviso más temprano, más ruido). El badge cambia cuando `now` cruza `eligible_at` sin evento de BD: el polling de 30 s del Header lo cubre (retraso ≤30 s); no hace falta realtime. Admin: números; no admin/anon: `{0,...}` o `42501` (decidir como `get_pending_orders_count`: devuelve 0 a no-admin). Alimenta badge y Dashboard.
3. `admin_resolve_refund(p_refund_id uuid, p_action text, p_reference text default null, p_refunded_at timestamptz default null, p_reason text default null) returns refund_requests`: `auth.uid()` no nulo → `current_user_is_blocked()` falso → `is_admin_user()` → `SELECT ... FOR UPDATE` → si `status<>'pending'`: idempotente si mismos parámetros, si no `22023 already_resolved`. `p_action='refunded'`: **solo si `now() >= eligible_at`, si no `22023 refund_on_hold`**; `reference` 1..200 caracteres obligatorio, `refunded_at` ≤ now() y ≥ `eligible_at` (default now()). `p_action='not_applicable'`: `reason` 1..500 obligatorio. Escribe `resolved_by/resolved_at`, e inserta auditoría server-side en `activity_logs` (`action='refund_resolved'`, `entity_type='refund_request'`, `entity_id`, `performed_by`, metadata sin PII: id, action, monto, operación). `activity_logs.performed_by` es text.
4. Errores: `42501` (no admin, bloqueado), `P0002 refund_not_found`, `22023 invalid_argument` (DETAIL=campo), `22023 already_resolved`.
5. **Auditoría adicional:** la fila misma es la traza (resolved_by/at/reference, inmutable porque no hay UPDATE directo). Opcional: registrar `refund_requests.status/refund_reference` en el trigger `audit_financial_changes` (`financial_audit_log`, columna por fila; ver 20261020100000) — ND menor, recomendado sí por ser dinero, es una línea de configuración.
6. **Qué ve el cliente (ND-4):** recomendado v1 = nada nuevo en BD; v2 = RPC `my_refund_status(p_order_id uuid default null, p_remittance_id uuid default null)` (dueño de la operación, devuelve solo `status`, `due_at`, `refunded_at`, `refund_reference`; sin notas internas ni cuenta) para mostrar "Reembolso en proceso, hasta el {fecha}" / "Reembolsado, ref. X" en Mis Pedidos/Mis Remesas. No exponer SELECT directo al cliente (la fila lleva datos internos).

## 5. Notificaciones
- **Badge:** nueva RPC `admin_refund_counts()` (no tocar `get_pending_orders_count`: tiene test de hardening `pendingOrdersCountHardening.test.js`). En `Header.loadPendingCount` sumar `actionable` como tercer origen con el mismo patrón `.catch(() => 0)`; `overdue>0` permite un estilo rojo opcional. Servicio nuevo `src/lib/refundService.js` (`getRefundCounts`, `listRefunds`, `resolveRefund`) con `callTransitionRpc`-style de errores tipados.
- **Realtime:** el alta ya dispara los eventos de `orders`/`remittances` que el Header escucha → refresco inmediato. La resolución NO emite evento de esas tablas: refrescar en la misma pestaña tras `resolveRefund` (llamar `loadPendingCount`) y para otros admins basta el polling de 30 s (aceptable, mismo respaldo del diseño actual). No agregar `refund_requests` a `supabase_realtime` en v1 (política de las demás tablas internas); alternativa en ND-8.
- **Dashboard:** tarjeta "Devoluciones pendientes" con `actionable`, `on_hold`, `overdue`, `pending_amount_usd`, y enlace a la cola. Con el mismo RPC; no mezclar con ingresos (el Dashboard calcula por `validated_at`; una cancelada ya pagada sigue en esas métricas hasta que ocurra el reembolso → ND-8 define si el Dashboard descuenta reembolsos; recomendado: NO en v1, solo mostrar pasivo).
- **Alerta en el momento de cancelar:** no hay canal server-side al admin (§1.6). v1 = badge/cola. Opcional posterior: el cliente que cancela puede abrir un `wa.me` al admin (patrón `whatsappService`), no confiable; descartado.

## 6. Plan por etapas (TDD, `CLAUDE.md`: test rojo → implementar → corregir → verificar → trazabilidad)
Orden de despliegue: migraciones antes del front; cada migración idempotente, `BEGIN; SET LOCAL lock_timeout='5s'`, rollback en `supabase/rollbacks/`, aplicar a prod solo con "dale" explícito del dueño (`apply_migration`/psql, no `db push`: hay deriva).

| Etapa | Migración propuesta | Contenido | Rollback |
|---|---|---|---|
| E1 | `20261029100000_refund_requests_table.sql` | tabla, checks, índices parciales, RLS + REVOKE/GRANT. Antes de aplicar: conteo de canceladas (`orders`/`remittances`); si >0, backfill manual: remesas con `cancelled_at` + `payment_proof_url` + historial `old_status='payment_proof_uploaded'`; pedidos vía `order_status_history`. | `DROP TABLE refund_requests` (exportar filas primero) |
| E2 | `20261029100100_add_business_days.sql` | función `add_business_days` + `refund_hold_hours()=48` y `refund_business_days()=5` | `DROP FUNCTION` |
| E3 | `20261029100200_refund_triggers.sql` | funciones trigger + `trg_refund_request_on_cancel` (orders/remittances) y cierre al reabrir | `DROP TRIGGER`/`DROP FUNCTION` |
| E4 | `20261029100300_refund_rpcs.sql` | `admin_list_refunds`, `admin_refund_counts`, `admin_resolve_refund` (+ opcional `my_refund_status`), grants | `DROP FUNCTION` |
| E5 | (código) | `src/lib/refundWindow.js`, `src/lib/refundService.js`, hook `useRefundCounts`, integración Header (1 línea) | revertir commit |
| E6 | (UI, aparte) | vista admin, tarjeta Dashboard, estado en Mis Pedidos/Remesas | — |
Si el front se desplegara antes que E4: `getRefundCounts` falla → `.catch(() => 0)`; seguro. `execute_platform_reset` no requiere cambio gracias al CASCADE (verificar con un test).

Tests (primero, rojos):
- **Unit (Vitest):** `refundWindow.test.js` con los vectores JSON compartidos; semáforo en límites; `REFUND_BUSINESS_DAYS` == constante SQL (lectura del archivo de migración).
- **BD (`src/tests/concurrency/`, con `dbSuiteSkipReason` como `orderTransitions.test.js`):** `refundRequests.test.js`:
  - matriz de elegibilidad: pedido pending/proof_uploaded/rejected/validated × cancela dueño/admin; remesa payment_pending/payment_rejected/payment_proof_uploaded → fila o no, `payment_evidence` y monto correctos (incluye `delivery_cost`);
  - pedido cancelado por dueño con proof_uploaded → fila `proof_unverified` aunque `payment_status` quede `rejected`;
  - `eligible_at` y `due_at` == vectores (incl. DST); `admin_resolve_refund('refunded')` antes de `eligible_at` → `refund_on_hold` y `not_applicable` antes sí; `admin_refund_counts` separa `on_hold`/`actionable` según `now()`; idempotencia (UPDATE repetido no duplica); reabrir cierra la fila; cancelar de nuevo crea otra; dos conexiones resolviendo a la vez → una gana, la otra `already_resolved` o devuelve la misma fila;
  - permisos: anon/cliente/otro cliente no leen ni llaman (`42501`); usuario bloqueado; INSERT/UPDATE directo denegado; `admin_resolve_refund` validaciones (referencia vacía, fecha futura, motivo);
  - `activity_logs` recibe la fila de auditoría; `execute_platform_reset` no queda bloqueado (en harness); snapshot de grants (que el test de revokes no marque funciones nuevas).
- **Servicios:** `refundService.test.js` (mock de supabase): mapeo de errores, conteos por defecto 0 si falla; `Header` suma el tercer origen.

## 7. Decisiones para el dueño (ND) — ND-1..8 APROBADOS tal como se recomendaron (rev. 2)

- **ND-1. ¿Las "comprobante subido sin verificar" entran en la cola?** Recomendado: SÍ, etiquetadas `proof_unverified` ("verificar en Zelle antes de devolver"); se resuelven como reembolsada o "no procede: no llegó el dinero". Tradeoff: algo de ruido vs. riesgo de quedarse con dinero del cliente. Alternativa: solo `validated`; hoy produciría 0 filas de remesas (nunca se cancelan validadas) y la cola quedaría casi vacía.
- **ND-2. Criterio de plazo:** ¿5 días hábiles desde la cancelación (recomendado, `due_at` al fin del 5º día, ET) o desde que el admin ve/confirma el pago? Desde la cancelación es lo que el cliente espera de TermsPage §9.
- **ND-3. Festivos y zona:** recomendado lun–vie `America/New_York`, sin festivos en v1 (los pagos son Zelle/EE. UU.; los festivos de Cuba no aplican). Tradeoff: un festivo federal cuenta como hábil → posible vencida marcada un día antes de lo real. Alternativa: tabla `business_holidays(date)` administrable (más trabajo y datos que mantener).
- **ND-4. Visibilidad al cliente:** recomendado v2 con RPC de solo lectura "estado de mi reembolso" (reduce consultas por WhatsApp y respalda la promesa legal). Alternativa: nada en v1.
- **ND-5 (DECIDIDO: cierre automático, sin bloquear; motivo "reabierto").** Reabrir un pedido cancelado con comprobante sin verificar: recomendado permitirlo y cerrar la solicitud como `not_applicable ('reopened')` (si el dinero llegó, el nuevo pago lo cubre o admin lo ve en la validación). Alternativa: bloquear reabrir mientras haya solicitud abierta (más seguro, cambia `order_reopen`, que hoy no queremos tocar).
- **ND-6. Integridad vs. reset de plataforma:** recomendado FK `ON DELETE CASCADE` (reset funciona sin cambios). Alternativa: sin FK + modificar `execute_platform_reset`.
- **ND-7. Trato a cancelaciones por "rechazo de comisión" (`commission_declined`):** misma cola y mismo plazo (política publicada). Alternativa: marcarlas `priority` y plazo menor; requiere decisión comercial y cambio en `TermsPage`.
- **ND-8. Dashboard y realtime:** recomendado en v1 solo mostrar pasivo (pendientes, vencidas, monto) y polling de 30 s para otros admins; no ajustar ingresos por reembolso ni agregar la tabla a `supabase_realtime`. Alternativa: tabla en realtime (la RLS la limita a admins) y descuento de reembolsos en "Cobrado".

## 8. Riesgos
- Cancelaciones entre hoy y el despliegue quedarían sin fila (mitigado: conteo previo y backfill manual).
- Trigger sobre dos tablas calientes: costo mínimo (WHEN a nivel de trigger solo dispara en transición a cancelled); un error en el trigger abortaría la cancelación → test de elegibilidad y que el trigger nunca lance por datos nulos (COALESCE en monto/`delivery_cost`).
- Deriva de migraciones repo vs prod: antes de E3/E4 comparar `prosrc` de funciones existentes que se usen (`is_admin_user`, `current_user_is_blocked`) y que la tabla `zelle_accounts` tenga las columnas que se unan.
- Bizum (EUR): campos `currency/payment_method` ya contemplados; el reembolso Bizum y su método de pago no están en la política → texto legal pendiente.
- Dos admins resolviendo a la vez: cubierto por FOR UPDATE.
- Un admin puede marcar "reembolsado" sin que exista transferencia real (la referencia es texto libre): no hay conciliación automática.

## 9. Qué NO cubre
UI (vista admin, tarjeta Dashboard, Mis Pedidos/Remesas) y textos ES/EN; ejecutar el reembolso (sigue manual por Zelle); reembolsos parciales; reversión de una resolución ya marcada; notificación push/email/WhatsApp automática al admin; notificación al cliente cuando se reembolsa; devolución de stock de pedidos cancelados tras `processing` (acción separada ya existente); conciliación con extractos de Zelle; festivos; ajuste de métricas del Dashboard.

## 10. Ajuste rev. 2: espera de 48 h — texto legal y constante (PENDIENTE de revisión del dueño)

**Constante nueva** en `src/lib/legalConfig.js`, distinta de `CLAIM_WINDOW_HOURS = 48` (ventana de reclamo tras la entrega); no reutilizar ni derivar una de otra aunque hoy valgan lo mismo:
```js
/** Hours after a cancellation before the refund process starts (owner policy, pending owner confirmation). */
export const REFUND_HOLD_HOURS = 48;
```
El SQL tiene su copia (`refund_hold_hours()`), comparada por test.

**Texto propuesto TermsPage §9** (borrador; cambia la primera viñeta "Antes del despacho"):
- ES: "…Si hubo un pago, se reembolsa el monto total pagado, de forma manual y al mismo método Zelle utilizado. El reembolso se inicia {REFUND_HOLD_HOURS} horas después de la cancelación y se completa dentro de los {REFUND_BUSINESS_DAYS} días hábiles siguientes."
- EN: "…If a payment was made, the full amount paid is refunded manually to the same Zelle method used. The refund starts {REFUND_HOLD_HOURS} hours after the cancellation and is completed within the following {REFUND_BUSINESS_DAYS} business days."
- Aviso al confirmar la cancelación (el otro diseño dice "lo reembolsaremos manualmente en {REFUND_BUSINESS_DAYS} días hábiles", `plan_commission-client-acceptance.md` líneas 164 y 173, y el diálogo del otro escritor): ES "Si ya enviaste el pago, lo reembolsaremos manualmente a partir de {REFUND_HOLD_HOURS} horas y dentro de los {REFUND_BUSINESS_DAYS} días hábiles siguientes." / EN "If you already sent the payment, we will refund it manually starting {REFUND_HOLD_HOURS} hours after cancellation and within the following {REFUND_BUSINESS_DAYS} business days."
- **Revisión legal:** el texto y la interpretación NO están aprobados jurídicamente; requieren revisión del dueño (y abogado si aplica) antes de publicar. **No tocar `LEGAL_VERSION` ni `LEGAL_LAST_UPDATED`** sin diseñar antes una migración de re-consentimiento (los usuarios quedarían con aceptación de una versión distinta a la publicada). Los tests `legalPages/legalConfig/legalLinks/legalNavigation` fijan valores actuales: actualizarlos en la misma etapa (TDD) al agregar la constante.
- Fuera de alcance: la viñeta "Pago rechazado o producto no disponible" promete reembolso en 5 días hábiles sin espera; no pasa por cancelación y este diseño no la cubre.

**Efectos en el resto del plan:** E1 agrega `eligible_at`; E2 agrega las dos funciones constantes; E4 aplica `refund_on_hold`; los textos de cancelar del otro diseño deben leer `REFUND_HOLD_HOURS`.

**Pregunta final (única):** ¿las 48 h van ANTES de los 5 días hábiles (plazo total = 48 h + 5 días hábiles, lo modelado) o DENTRO de ellos (el reembolso empieza a las 48 h pero debe estar listo a los 5 días hábiles desde la cancelación)? Recomiendo ANTES: es lo que dijo el cliente ("empiezan 48 h después") y deja margen operativo real; con DENTRO la ventana de acción se reduce a ~3 días hábiles. Si el dueño elige DENTRO solo cambia la fórmula: `due_at = add_business_days(cancelled_at, 5)` con `eligible_at` solo como bloqueo.
