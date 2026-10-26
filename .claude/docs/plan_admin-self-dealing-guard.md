# Plan: separación de funciones (admin sobre su propia operación)

Estado: DISEÑO + EVIDENCIA. No se implementó nada. No se aplicó nada a remoto (solo SELECT). Rama `docs/admin-self-dealing-plan`, sin commit.
**Es un cambio de política**: bloquea a los admins de operar sus propios pedidos/remesas. Requiere aprobación del dueño antes de cualquier implementación (sección 7).

## 1. Evidencia (prod, solo SELECT, 2026-10-26)

| Dato | Resultado |
|---|---|
| Usuarios con rol admin/super_admin | 5 (2 `admin` + 3 `super_admin`, todos `is_enabled`) |
| Pedidos / remesas cuyo `user_id` es admin | 0 / 0 (totales: 33 pedidos, 29 remesas) |
| md5 `prosrc` vivo `_order_transition` | `28a851a3...` (8185 chars) |
| md5 `prosrc` vivo `_remittance_transition` | `ebbd27fe90d583f269b76884e65f18ba` (coincide con memoria del repo) |
| md5 `admin_set_remittance_commission` vivo | `61f88264...` = md5 del cuerpo en `20261028100300_commission_acceptance_rpcs.sql` (coincide) |
| md5 `remittance_accept_commission` vivo | `5dc1bee0...` = repo `20261028100300` (coincide) |

Corrección al supuesto del encargo: NO hay "único super_admin"; hay 3. Siempre existe otro admin que pueda actuar, hoy.

## 2. Rutas de código vivas por brecha

**(a) Comisión propia.** `admin_set_remittance_commission` (SECURITY DEFINER): la única autorización es `is_admin_user() OR is_super_admin()`; luego `SELECT ... FROM remittances ... FOR UPDATE` y NO compara `v_rem.user_id` con `auth.uid()`. Inserta en `remittance_commission_overrides(set_by = auth.uid())`, actualiza `commission_total/discount_amount/amount_to_deliver` y crea la propuesta (`created_by = auth.uid()`, dirección increase/decrease). Las columnas de dinero están protegidas por `guard_remittance_money_columns` solo para `current_user IN (authenticated, anon)`; al correr dentro de la RPC (dueño de la función) pasa. Congelada tras el comprobante (status solo `payment_pending/payment_rejected`) y ventana propia (20261025100000).

**(b) Validar/rechazar pago y entregas propias.** `order_validate_payment`, `order_reject_payment`, `order_mark_delivered`, `remittance_validate_payment`, `remittance_reject_payment`, `remittance_confirm_delivery` (y los demás `order_*`/`remittance_*`) son wrappers de 1 línea sobre `_order_transition` / `_remittance_transition` (SECURITY DEFINER). En ambas: `v_is_admin := is_admin_user()`; acciones `validate_payment, reject_payment, start_processing, dispatch|confirm_delivery, mark_delivered, complete` exigen solo `v_is_admin`; el dueño se calcula (`v_is_owner` / `v_owner`) pero solo se usa para `submit_proof`, `reopen`, `cancel`. No hay chequeo "actor != dueño" en la rama admin. En `_order_transition` la rama admin tiene precedencia en `cancel` (admin cancela en `pending|processing`; el dueño solo en `pending` sin pago validado). `guard_status_via_rpc` (BEFORE UPDATE OF status[, payment_status], solo actúa si `current_user IN (authenticated, anon)`) fuerza el camino por RPC pero no mira al actor.
Triggers AFTER relevantes ya existentes y que NO se tocan: `courier_accrual_on_delivered`, `trg_refund_request_on_cancel/reopen`, `release_stock_on_order_cancel`, `audit_*`.

**(c) Propuesta + aceptación por la misma persona.** Propuesta: creada en (a) (`created_by = admin`). Aceptación: `remittance_accept_commission` exige `v_owner = auth.uid()` (admins NO aceptan por el cliente). Admin-dueño puede, por tanto, proponer (a) y aceptar. Cerrando (a) el circulo no existe; `guard_commission_acceptance` (BEFORE UPDATE OF status en remittances) solo verifica que no haya propuesta `pending` al subir comprobante y no mira actores. No hay triggers sobre `remittance_commission_overrides` ni `remittance_commission_proposals` (verificado).

**Brecha adicional observada (d), fuera de alcance del encargo, a decidir:** `orders` tiene la política RLS `orders_update` (`user_id = auth.uid() OR is_admin_user()`) y `guard_orders_owner_update` hace `RETURN NEW` para cualquier admin, así que un admin autenticado puede hacer UPDATE directo de columnas de dinero (`total_amount`, `payment_amount`, ...) de CUALQUIER pedido vía PostgREST; `status/payment_status` sí están cubiertos por `guard_status_via_rpc`. Para remesas las columnas de dinero sí están protegidas (`guard_remittance_money_columns`). Auditoría financiera registra el cambio (`audit_financial_update`) pero no lo bloquea. No lo cubre este plan salvo que el dueño lo pida (sección 7, D6). No verifiqué si existe otra protección.

## 3. Mecanismo mínimo por brecha

Principio: NO reemplazar `_order_transition`, `_remittance_transition` ni ninguna función viva. Solo triggers nuevos `BEFORE`, con `WHEN` estrecho. Un trigger dispara también dentro de RPC SECURITY DEFINER y `auth.uid()` (claims del JWT) sigue siendo el usuario real, por eso funciona sin tocar las RPC. Contextos sin JWT (service_role, postgres, cron, Edge Functions): `auth.uid() IS NULL` => el trigger no hace nada.

| Opción | Riesgo flujos existentes | Riesgo sobre funciones protegidas | Cobertura | Veredicto |
|---|---|---|---|---|
| A. Trigger BEFORE UPDATE en `orders`/`remittances` (propietario-actor + admin + transición solo-admin) | Bajo: solo dispara cuando `auth.uid()=user_id` Y `is_admin_user()`; hoy 0 filas afectadas | Ninguno (no reemplaza nada) | Cubre (b) también si alguien llama otra RPC futura o PostgREST | RECOMENDADA para (b) |
| B. Trigger BEFORE INSERT en `remittance_commission_overrides` | Mínimo: el INSERT solo lo hace `admin_set_remittance_commission`; hace rollback antes de tocar remittances/propuestas | Ninguno | Cierra (a) y, por consecuencia, (c) sin reemplazar la RPC viva | RECOMENDADA para (a) |
| C. Chequeo dentro de las RPC (CREATE OR REPLACE) | Medio: requiere reemplazar `admin_set_remittance_commission` (permitido solo tras comparar prosrc: ya comparado, md5 coincide) y NO se puede hacer para `_order/_remittance_transition` (prohibido) | Alto en transiciones | Tiene mejor mensaje de error y permite `{ok:false}` + evento auditado (patrón R5) | Solo para (a) si el dueño quiere confirmación explícita (ver D3); para (b) descartada |
| D. Solo UI | Ninguno | Ninguno | Nula (PostgREST/RPC directo la salta) | Solo como degradación: etiqueta y botón deshabilitado; nunca la defensa |

Limitación del trigger: `RAISE EXCEPTION` revierte la transacción, así que el intento NO queda en una tabla de eventos (sin transacciones autónomas en plpgsql). Compensación: `RAISE WARNING` con sqlstate/código (sin PII) visible en logs de Postgres, y el front registra el error tipado. Si el dueño exige auditoría persistente del intento, usar la opción C (RPC que devuelve `{ok:false,code}` tras insertar evento), con el costo de reemplazar la función viva.

### Diseño (b): `guard_admin_self_dealing()`
- `CREATE TRIGGER trg_orders_admin_self_dealing BEFORE UPDATE OF status, payment_status ON orders FOR EACH ROW WHEN (old.user_id IS NOT NULL AND (new.status IS DISTINCT FROM old.status OR new.payment_status IS DISTINCT FROM old.payment_status)) EXECUTE FUNCTION guard_admin_self_dealing();` y el análogo en `remittances` (`OF status`).
- Función `SECURITY INVOKER`, `SET search_path = public`: `IF auth.uid() IS NULL OR auth.uid() <> OLD.user_id OR NOT public.is_admin_user() THEN RETURN NEW;` Luego **lista blanca** de transiciones que un cliente normal también puede hacer (misma que `guard_orders_owner_update`/`_remittance_transition`):
  - orders: `pending -> cancelled` con `payment_status <> 'validated'` (más `payment_status -> rejected` acompañando ese cancel), `cancelled -> pending` con `payment_status IN (pending, rejected, proof_uploaded)` (más `-> pending`), y `payment_status -> proof_uploaded` con status `pending` y pago previo en `pending|rejected|proof_uploaded` (submit_proof).
  - remittances: `payment_pending|payment_rejected -> payment_proof_uploaded` (submit_proof) y `payment_pending|payment_rejected|payment_proof_uploaded -> cancelled` (cancel).
  - Todo lo demás (validar/rechazar pago, `processing`, `dispatched`, `delivered`, `completed`, cancel de `processing` por rama admin) => `RAISE EXCEPTION 'admin_self_dealing_not_allowed' USING ERRCODE = '42501'`.
- Fail-closed deliberado: un estado nuevo futuro quedará bloqueado para admin-dueño hasta añadirlo a la lista blanca (preferible en dinero).
- Importante: el trigger es BEFORE ... OF status; los AFTER existentes (acrual de mensajero, reembolso, stock) no se alteran porque, cuando el trigger bloquea, la transacción completa se revierte antes de ellos.
- `recalculate_remittance_at_current_rate`: permitido a dueño; un admin-dueño la usa igual que un cliente (respeta override). No se bloquea (no es ventaja: usa tasa vigente). No verifiqué el cuerpo completo (solo el encabezado de autorización).

### Diseño (a)+(c): `guard_commission_self_dealing()`
- `BEFORE INSERT ON remittance_commission_overrides FOR EACH ROW`: si `NEW.set_by = (SELECT user_id FROM remittances WHERE id = NEW.remittance_id)` => `RAISE EXCEPTION 'commission_self_adjust_not_allowed' USING ERRCODE='42501'`. Sin exigir `auth.uid()` (basta `set_by`, que la RPC fija a `auth.uid()`); cubre también service_role que fuerce `set_by` = dueño (inserción manual sería la excepción deliberada con `set_by NULL`, ver abajo).
- (c) cinturón y tirantes: `BEFORE UPDATE OF status ON remittance_commission_proposals`: si `NEW.status='accepted' AND NEW.created_by = auth.uid()` => bloquear. En la práctica inalcanzable tras (a); se incluye porque es de 10 líneas y cubre propuestas históricas. (Opcional: el dueño puede decidir no incluirlo, YAGNI.)
- Con B no se reemplaza ninguna función viva, no hay riesgo sobre `guard_commission_acceptance` ni `guard_remittance_money_columns`.

## 4. Caso admin que compra para sí mismo (cuentas de prueba / internas)

- Con la política propuesta un admin-dueño puede: crear, subir comprobante, cancelar/reabrir (acciones de cliente), ver reembolso propio. NO puede: validar/rechazar su pago, procesar, despachar, entregar, completar, ni tocar su comisión. Otro admin lo hace.
- Hoy hay 5 admins (3 super_admin): el modelo "otro admin opera" es viable. Con un solo admin la plataforma quedaría sin quien valide sus pedidos propios.
- Alternativa para pruebas legítimas sin debilitar el control: cuentas de cliente de prueba separadas (rol `user`), operadas por un admin real. Es lo recomendado (cero código nuevo).
- Camino de confirmación explícita estilo reembolsos (`self_resolved` solo super_admin + `p_self_resolve_confirm`): NO es posible con triggers sin reemplazar RPC vivas (no se puede pasar flag a `_order_transition`). Si el dueño lo quiere (D3), requiere una RPC NUEVA `admin_validate_own_payment_*` (no toca las protegidas; hace el UPDATE por el mismo camino dentro de una función con `SET LOCAL app.self_dealing_ok = '1'` leída por el trigger, solo para `is_super_admin()` y con evento `self_resolved`). Costo: complejidad y un hueco controlado. Recomendación: NO construirlo hasta que exista un caso real (YAGNI).

## 5. Plan por fases

Convención: cada migración es ADITIVA y con `_down.sql`; nada se aplica a remoto sin "dale" propio. Fixtures de prueba solo en el scratch local (puerto 55322, `scripts/test-db-bootstrap.sh`), nunca en prod.

Fase 0 (previo): aprobación del dueño (sección 7). Reverificar COUNTs en prod justo antes de aplicar (si algún admin ya tiene operaciones propias, el bloqueo pasaría a afectar flujos en vuelo: ver D4).

Fase 1: (a)+(c)
- `20261101100000_commission_self_adjust_guard.sql`: función + triggers de B. Rollback `..._down.sql`: `DROP TRIGGER ... ; DROP FUNCTION ...` (sin datos asociados).
- Tests (TDD, rojo primero) en `src/tests/concurrency/adminSelfDealingCommission.test.js`: admin-dueño no ajusta su comisión (sube ni baja; sin fila en overrides ni propuesta ni alertas: verificar conteos antes/después iguales); otro admin sí; comportamiento de `admin_set_remittance_commission` para remesa ajena sin cambios (checksum de remittance/overrides); accept por dueño no-admin sin cambios; (c) propuesta con `created_by` = aceptante bloqueada.

Fase 2: (b)
- `20261101100100_orders_admin_self_dealing_guard.sql` y `20261101100200_remittances_admin_self_dealing_guard.sql` (función compartida en la primera; la segunda solo trigger, o una sola migración si se prefiere un rollback único). Rollback: DROP TRIGGER/FUNCTION.
- Tests: matriz completa de transiciones (estado x acción) para actor = admin-dueño (permitido: submit_proof/cancel/reopen; bloqueado: validate/reject/start_processing/dispatch/mark_delivered|confirm_delivery/complete/cancel en processing) y para actor = cliente normal y = otro admin (comportamiento idéntico al actual, comparado con la suite existente `orderTransitions.test.js`/`remittanceTransitions` sin modificarla); service_role/postgres sin efecto (`auth.uid() IS NULL`); `courierAccruals`, refunds y concurrencia (mismo harness: dos transiciones simultáneas sobre la misma fila, una de admin-dueño bloqueada y otra de otro admin exitosa, sin deadlock: el trigger no toma locks). Verificar que los md5 de `_order_transition` y `_remittance_transition` no cambian (assert en el test, como hacen otras suites).
- Prueba segura con datos de ejemplo: en el scratch, crear un usuario admin con una operación propia + una ajena; antes/después comparar conteos y `md5(string_agg(...))` por tabla. En prod, solo SELECT de verificación previa y posterior (conteos de admin-ops = 0 y md5 de funciones protegidas).

Fase 3: Front (degradación; la RPC/trigger es la defensa)
- Error tipado `ADMIN_SELF_DEALING_NOT_ALLOWED` (`admin_self_dealing_not_allowed`) y `COMMISSION_SELF_ADJUST_NOT_ALLOWED` en `statusTransition.js`/servicios + traducciones ES/EN (`t()`).
- Etiqueta "Operación propia" y botones validar/rechazar/entregar/comisión deshabilitados con motivo (`aria-describedby`) cuando `order.user_id === auth user id` y el rol es admin (cálculo en cliente; si falta el dato, no deshabilita y el servidor igualmente rechaza). `CommissionOverrideModal.jsx`: ocultar/deshabilitar si es remesa propia. Mensaje de error legible si igual llega el 42501.
- Tests unit en `src/tests/unit/` (Vitest).
- Despliegue del front es independiente: orden seguro = migración (Fase 1/2) primero o front primero; ambos son seguros porque sin front nuevo el admin-dueño recibe el error del servidor.

Fase 4: cierre — `TRACKING_PROGRESS.md`, Engram, codegraph sync, y un runbook corto si el dueño elige D3/D4.

Orden de aplicación en prod (cada una con "dale"): Fase 1, Fase 2, luego front. Un solo push al final (memoria: push único tras verificación exhaustiva).

## 6. Rollbacks (por pieza)

| Pieza | Rollback |
|---|---|
| Trigger/función commission self-adjust | `DROP TRIGGER trg_commission_override_self_adjust ON remittance_commission_overrides; DROP TRIGGER trg_commission_accept_self ON remittance_commission_proposals; DROP FUNCTION ...` |
| Trigger orders/remittances | `DROP TRIGGER trg_orders_admin_self_dealing ON orders; DROP TRIGGER trg_remittances_admin_self_dealing ON remittances; DROP FUNCTION guard_admin_self_dealing()` |
| Front | revert del commit; sin migraciones asociadas |
No hay cambio de datos ni columnas en estas fases: el rollback es completo e inmediato.

## 7. Decisiones del DUEÑO requeridas (bloquean la implementación)

- D1 (política): ¿aprobar que ningún admin/super_admin pueda validar/rechazar pago, procesar, entregar ni completar sus propios pedidos/remesas? (Recomendado: sí.)
- D2 (política): ¿bloquear que un admin cambie la comisión de su propia remesa, sin excepción? (Recomendado: sí; hay otros 4 admins.)
- D3: ¿camino de confirmación explícita para super_admin (patrón reembolsos) o "otro admin siempre"? (Recomendado: "otro admin"; construir D3 solo si queda un único admin.)
- D4: cuentas internas/de prueba: ¿se usan cuentas de cliente separadas (recomendado) o se necesita que un admin compre para sí? Si hay admins con operaciones en vuelo, definir cómo cerrarlas antes de activar.
- D5: ¿se requiere auditoría persistente del intento bloqueado (implica RPC nueva/reemplazo, opción C) o basta `RAISE WARNING` + log?
- D6: ¿incluir (d) UPDATE directo de columnas de dinero de `orders` por admin (nuevo trigger análogo a `guard_remittance_money_columns`)? Es un alcance distinto y toca el flujo de edición admin de pedidos; no mezclar sin decisión.

## 8. Qué NO verifiqué

- Cuerpos completos de `_order_transition`/`_remittance_transition` más allá de autorización y tabla `v_ok` (solo lectura parcial; no se modifican).
- Que no existan otros caminos con JWT de usuario que muten `orders.status`/`remittances.status` fuera de los wrappers (listé funciones que contienen `UPDATE orders|remittances`: `_order_transition`, `_remittance_transition`, `_release_order_locked`, `_reserve_order_locked`, `expire_stale_order_reservations`, `reserve_order_inventory`, `restock_order_inventory`, `recalculate_remittance_at_current_rate`, `admin_set_remittance_commission`, `remittance_accept_commission`; no leí cada cuerpo ni sus llamadores; las de stock/expiración parecen correr sin JWT o sobre columnas de stock). Verificar con tests de regresión de la suite completa.
- Que `is_admin_user()` dentro de un trigger BEFORE (contexto de DEFINER) resuelva `auth.uid()` igual que en el contexto de la RPC: confirmarlo en el test local (lee `request.jwt.claims`, no el rol de BD, por lo que se espera que sí).
- Mensajería, Edge Functions y otros módulos que actúen en nombre de un admin.
- Ejecución real de tests / harness local (no se corrió nada; no se escribió código ni migraciones).
- Timestamps de migración propuestos (20261101...) no se contrastaron contra ramas abiertas; ajustar al integrar.

## 9. Brechas residuales aceptadas / decisiones nuevas (revisión independiente, 2026-10-26)

Estado: D1 y D2 aprobadas; D3 = otro admin siempre; D4 = cuentas de prueba separadas; D5 = sin auditoría persistente; D6 = fuera. Implementado en `feat/admin-self-dealing-guard` (migraciones `20261101100000/100/200`), solo local. Lo siguiente NO está cerrado; nada de esto se implementa sin aprobación del dueño.

1. **`user_id` de orders/remittances escribible por un admin.** Las guardas se basan en `OLD.user_id`; un admin autenticado puede reasignar el `user_id` con un UPDATE directo (RLS `orders_update` y `admins can update all remittances` lo permiten; `guard_orders_owner_update` retorna temprano para admins) y luego operar como "otro admin". Documentado con un test que NO lo cierra (`KNOWN GAP` en `adminSelfDealing.test.js`). Mitigación barata propuesta: trigger BEFORE UPDATE OF user_id (en ambas tablas) que bloquee cuando `current_user IN ('authenticated','anon')` (las RPC SECURITY DEFINER, postgres y service_role siguen pudiendo). Riesgo: cualquier flujo legítimo que hoy reasigne dueño desde el front (no verificado). Pendiente de aprobación.
2. **`recalculate_remittance_at_current_rate`** puede ejecutarla el dueño-admin sobre su remesa (comportamiento de cliente, honra overrides), y un admin puede editar `remittance_types` / tasas de cambio que alimentan ese recálculo y la cotización. El trigger no lo cubre; control: revisión de cambios de tasas y `audit_financial_update`.
3. **INSERT de una operación propia con precio arbitrario.** Los triggers solo vigilan UPDATE de estado; crear una operación para sí mismo está permitido (como cualquier cliente) y los guards de pricing de INSERT son los existentes. No se valida que un admin no cree operaciones con precio manipulado más allá de esos guards.
4. **Intentos bloqueados sin auditoría persistente.** El `RAISE EXCEPTION` revierte la transacción: solo queda `RAISE WARNING` (sin ids) en logs de Postgres. Asimetría con R5 (reembolsos), donde la RPC devuelve `{ok:false}` tras insertar evento `self_resolution_blocked`. Cerrarlo exigiría RPC nueva o reemplazo de funciones vivas (D5 lo difirió).
5. **Bypass con `auth.uid()` NULL.** postgres, service_role, cron y Edge Functions con service key no están sujetos a la guarda (por diseño). Quien tenga la service key o acceso SQL puede operar cualquier cosa; el control es la custodia de credenciales.
6. **Un admin puede crear una segunda cuenta** (cliente) y operar con ella: no es cerrable con triggers; solo con control organizativo (revisión de altas, correo/identidad). La guarda impide el self-dealing sobre la MISMA cuenta, no la colusión ni el sockpuppet.
7. **Notas varias.** (a) En ES, las claves nuevas (`common.statusSelfDealing`, `ownOperation`, `ownOperationReason`) usan "usted", pero las vecinas `common.statusNotAuthorized` / `statusUserDisabled` (y otras) usan tuteo: inconsistencia previa, NO modificada. (b) Admin deshabilitado: la guarda no actúa (`is_admin_user()` exige `is_enabled`), pero las RPC lo rechazan antes con `user_disabled` (test incluido). (c) `UserPanel`/`OrderActionButtons`/Inbox/Tab muestran la razón como texto visible referenciado por `aria-describedby`, no solo `title`.
