# Plan: reembolsos, trazabilidad auditable y comprobante (R5a / R5b / R5c)

Estado: DISEÑO, nada implementado ni aplicado. Base: `origin/main` ca9cb1a9 + rama `feat/refunds-queue-db` (worktree agent-a84b7e6beaf6006f1, migraciones 20261029100000..100400, sin mergear ni aplicar).
Nuevas migraciones desde `20261029110000`. Rollbacks en `supabase/rollbacks/`.

## 0. Estado de implementación (2026-10-26, local, sin commit, nada aplicado a Supabase remoto)

Rama `feat/refunds-audit-trail-r5` (sobre `origin/main` 2b8a8f02, que ya trae R4 #132 y mensajería #133; las migraciones 20261029110000..110500 se ordenan antes de las 20261031* ya aplicadas en prod y son independientes de ellas). Hecho: R5a (110000-110200), R5b (110300-110500, sin `admin_attach_refund_proof` por ser el comprobante obligatorio), R5c mínimo (modal con comprobante obligatorio, etiqueta "Operación propia", bloqueo y confirmación reforzada). Desviaciones respecto al diseño: (1) las columnas `proof_*` y `self_resolved` van en 110000 (el trigger de auditoría y la guarda las usan); (2) el trigger de auditoría guarda solo el SQLSTATE en `activity_logs` (`refund_event_failed`), nunca el mensaje; (3) los triggers de cancelación/reapertura de R4 YA son fail-open en la rama (e4dc9c74: `refund_capture_failed` / `refund_close_failed`), por lo que la nota de "R4 fail-closed" más abajo está superada; (4) [CERRADO en la revisión independiente] la v1 `admin_resolve_refund` ya no es un atajo: la guarda `refund_requests_guard` (110000) exige `proof_path` para `pending->refunded` mientras `refund_proof_required()` sea true y rechaza `resolved_by = user_id` salvo `self_resolved` (o reapertura real). La v1 sigue sin revocarse (compatibilidad con el front viejo), pero 'refunded' sin comprobante falla con 42501; (5) edge function escrita, sin desplegar, sin prueba automatizada. Pendiente: secciones/timeline en detalles, KPIs de Dashboard, CSV, botón "Purgar vencidos", vista del cliente, bloqueo de autoaplicación en comisión/validación de pago (migración aparte), paso de Storage en el runbook de reset. Bitácora: `.claude/TRACKING_PROGRESS.md`.

### 0.1 Correcciones de la revisión independiente (veredicto "aplicable con correcciones")

1. Guarda (110000): v1 ya no evita el comprobante ni la separación de funciones (ver punto 4 de arriba). `refund_proof_required()` vive ahora en 110000 (la guarda la llama); 110300 solo la referencia.
2. Purga: la Edge Function re-consulta `_refund_dispute_open` (EXECUTE solo `service_role`, solo lectura) justo antes de cada `remove` y omite si hay disputa. Carrera residual documentada: una disputa abierta entre esa consulta y el `remove` aún pierde el archivo (la fila queda para revisión).
3. Bucket (110300): la política INSERT exige `refund_requests.status = 'pending'`; índice parcial `refund_requests_proof_path_idx (proof_path) WHERE proof_path IS NOT NULL` para la política DELETE. Barrido de huérfanos (subida sin RPC y limpieza fallida) = fase 2, no construido.
4. Front: tras `ok:true`, si `refund.proof_path !== proofPath` se descarta la subida (repetición idempotente).
5. Rollback 110000_down aborta si `refund_request_events` tiene filas, salvo `SET app.confirm_refund_rollback = 'yes'`.
6. 110200: alias `row` renombrado a `rec` en `admin_refund_export`.
7. Nueva `20261029110600_refund_constants_search_path`: `ALTER FUNCTION ... SET search_path = pg_catalog` en `refund_hold_hours()` y `refund_business_days()` (no redefine cuerpos; rollback con `RESET search_path`).
8. `self_resolution_blocked` se limita a 1 por reembolso y actor por hora (`_refund_event_self_block`, usado por v2 y por `admin_set_refund_dispute`).
9. Comentario de la guarda corregido (ya no dice "write-once").
10. **Orden de despliegue de R5: PRIMERO las migraciones, DESPUÉS el front.** El front nuevo usa `admin_resolve_refund_v2` y el bucket `refund-proofs`; sin migraciones fallaría. El front viejo usa la v1, que sigue funcionando salvo 'refunded' sin comprobante, que la guarda ahora rechaza. Hoy hay 0 solicitudes en prod, así que no hay flujo en vuelo que romper.

## 1. Hallazgos (rastro actual)

Conteos agregados de prod (SELECT, sin PII): order_status_history 126, remittance_status_history 61, activity_logs 1026, financial_audit_log 8, zelle_transaction_history 49, remittance_commission_overrides 1, pedidos cancelados 0, remesas canceladas 0, bucket `refund-proofs` no existe, activity_logs `refund_resolved` 0.

| Fuente | Columnas / quién escribe | Evidencia |
|---|---|---|
| order_status_history | id, order_id, previous_status, new_status, changed_by (auth.users), notes, metadata, created_at. Trigger `audit_order_status_change` (SECURITY DEFINER) lee `app.status_note` (set_config local por `_order_transition`); escribe si cambia status o (hay nota y cambia payment_status). created_at = NOW() de la transacción | 20241001000000_complete_schema.sql:397; 20261024110000_order_transition_rpcs.sql:55-75, 183, 242 |
| remittance_status_history | id, remittance_id, old_status, new_status, changed_by, change_reason, notes, created_at (columnas leídas de prod). Trigger `audit_remittance_status_change`, misma nota `app.status_note` | 20261024110100_remittance_transition_rpcs.sql:36-52, 160, 196; RLS insert 20261019110000_phase15_s4_history_and_offers.sql:73 |
| activity_logs | id, action, entity_type, entity_id, performed_by (text), description, metadata jsonb, created_at. Mutable por diseño (no es append-only); el reset la conserva | 20251205000002_activity_and_offer_support.sql:2-16; 20261020100000...sql:57 |
| financial_audit_log | una fila por columna monetaria cambiada: table_name, row_id, column_name, old/new_value, operation, changed_by, changed_by_role, via_function, txid, changed_at (clock_timestamp). Append-only (triggers BEFORE UPDATE/DELETE/TRUNCATE), sin FK, el reset la conserva. NO registra estados ni reembolsos | 20261020100000_financial_audit_log.sql:106-160 |
| zelle_transaction_history | solo admin (RLS `zth_manage`); el reset la borra | 20260210000001_security_hardening.sql:195-197; 20260909120000...sql:78 |
| remittance_commission_overrides / _proposals | overrides: set_by, set_at, reason. Propuestas: status, created_at/by, responded_at/by, override_id (SET NULL) | 20261023120000_remittance_commission_override.sql:54-62; 20261028100100_commission_proposals_table.sql:18-31 |

Cómo se muestra hoy:
- Remesas, cliente: `RemittanceTimeline.jsx` recibe `statusHistory` (MyRemittancesPage.jsx:1285). Servicio: `getRemittanceDetails` lee `remittance_status_history` con degradación elegante (remittanceService.js:1405-1425).
- Admin: `OrderDetailsModal.jsx` NO muestra historial (solo `created_at`); en `AdminRemittancesTab`/`AdminRemittancesInbox` no hay historial (los `history` encontrados son `window.history`). **No existe hoy una vista admin de línea de tiempo**: la sección nueva es construcción, no extensión.
- Logging front: `errorHandler.logError` hace `console.error` con stack, `window.location.href` y userAgent, y tiene un TODO de tracking (errorHandler.js:149-171); `activityLogger.js` usa `console.info/warn` y cola en localStorage; Edge Function `notify-zelle-deactivation` loguea con console y llega a imprimir el email del destinatario (index.ts:180) = PII en logs a evitar en el módulo nuevo.

Hallazgo crítico de diseño (reset): `execute_platform_reset` hace `DELETE FROM remittances/orders` y los FK `ON DELETE CASCADE` de `refund_requests` se activan. Una tabla de eventos con FK cascade y trigger BEFORE DELETE de inmutabilidad **rompería el reset**. Por eso los eventos no llevan FK y se conservan como `financial_audit_log` (fuente: 20260909120000...sql:54-57).

## 2. Trazabilidad (R5a)

### 2.1 Tabla `refund_request_events` (append-only)
Columnas: `id bigint identity`, `refund_id uuid`, `operation_type text`, `order_id uuid`, `remittance_id uuid` (exactamente uno; SIN FK), `event_type text CHECK IN ('created','closed_refunded','closed_not_applicable','closed_by_reopen','proof_attached','proof_expired','dispute_opened','dispute_closed','self_resolution_blocked')`, `from_status`, `to_status`, `actor_id uuid`, `actor_role text CHECK IN ('customer','admin','super_admin','system')`, `amount numeric(10,2)`, `currency`, `reason_code text` (enum cerrado: 'reopened','admin_text','proof_late'...; el texto libre queda solo en refund_requests), `has_reference boolean`, `has_proof boolean`, `proof_object_id uuid`, `txid bigint DEFAULT txid_current()`, `occurred_at timestamptz NOT NULL DEFAULT now()`.
- Sin PII: nada de nombre, email, teléfono, referencia Zelle, path completo ni URL. Sí ids (uuid) y montos.
- `hold_elapsed` NO se persiste (no hay cron): la línea de tiempo lo deriva de `eligible_at`/`due_at` como marcadores `derived:true`. Evita un job y evita eventos inventados.
- Inmutable: copia del patrón de financial_audit_log (BEFORE UPDATE/DELETE/TRUNCATE -> `RAISE 42501`), `REVOKE ALL` a anon/authenticated/service_role salvo SELECT admin; INSERT solo por función SECURITY DEFINER `_refund_event(...)` sin GRANT. Índices: `(order_id, occurred_at, id)`, `(remittance_id, occurred_at, id)`, `(refund_id, id)`.
- Re-escritura de la historia: reabrir = evento `closed_by_reopen`; re-cancelar = nueva fila `refund_requests` (ya garantizado por el índice único parcial) + nuevo evento `created`. Nunca se edita un evento. Además, trigger BEFORE UPDATE en `refund_requests`: las filas terminales (`status <> 'pending'`) son inmutables salvo la transición única de `proof_path` NULL -> valor, y las columnas de identidad (`order_id`, `amount`, `cancelled_at`, `eligible_at`, `due_at`, `user_id`) nunca cambian.

### 2.2 Población sin tocar los cuerpos vivos
Un único trigger `AFTER INSERT OR UPDATE ON refund_requests` (SECURITY DEFINER, **NO fail-closed**: cuerpo en `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING '...' (solo SQLSTATE y ids, sin datos) ; intento best-effort de insertar en `activity_logs` (action `refund_event_failed`, metadata con refund_id y SQLSTATE) dentro de un sub-bloque con su propia EXCEPTION; RETURN NULL`) deriva el evento comparando OLD/NEW: INSERT -> `created`; pending->refunded -> `closed_refunded`; pending->not_applicable -> `closed_not_applicable` (si `resolution_reason='reopened'` -> `closed_by_reopen`); proof_path NULL->valor -> `proof_attached`. Cubre el trigger de cancelación, el de reapertura y `admin_resolve_refund` sin modificarlos. Actor: `auth.uid()` + rol por `is_admin_user()`/super_admin (mismo cálculo que `refund_request_on_cancel`), `system` si uid NULL. Reloj: `now()` de la transacción, así el evento de cancelación comparte `occurred_at` con la fila de `*_status_history` (NOW()) y `txid` con `financial_audit_log`.

### 2.3 Referencia desde el ciclo de vida de la operación (sin reemplazar `_order_transition`/`_remittance_transition`)
No se añade columna a orders/remittances. Enlace = `order_id`/`remittance_id` + `refund_id`, tres piezas:
1. RPC admin `admin_operation_timeline(p_operation_type, p_operation_id)` (SECURITY DEFINER, STABLE, 42501 si no admin, limite 500): UNION ALL de status_history, `refund_request_events`, marcadores derivados (`eligible_at`, `due_at`), propuestas de comisión (created_at / responded_at), override (set_at), y entrega (columnas de entrega: no verificadas). Opcional `p_include_financial` agrega `financial_audit_log` por `row_id` (valores monetarios, solo admin). Salida por fila: `ts, source, kind (clave i18n), actor_id, actor_name, ref_id, summary jsonb (sin PII)`. Orden: `ts, source_rank, id`. Los eventos del mismo instante (misma transacción) se ordenan por rank de fuente: status_history, evento de reembolso, financiero.
2. RPC `admin_get_operation_refunds(type, id)`: todas las solicitudes (historial completo de episodios) con estado y `queue_state`.
3. Las listas admin existentes pueden sumar `refund_status` con LEFT JOIN en un cambio posterior (no bloquea).
Alternativa descartada: vista SQL (no puede aplicar el check admin con SECURITY DEFINER limpio y su orden depende de RLS por tabla); RPC es el patrón del proyecto.

### 2.4 Qué ve el cliente (v2, no construir ahora)
RPC `my_operation_refund(type, id)` con whitelist: `status` (pending / refunded / not_applicable), `eligible_at`, `due_at`, `refunded_at`, importe/moneda. Verifica `user_id = auth.uid()` en el cuerpo. Nunca devuelve `proof_path`, `resolved_by`, `refund_reference` (decisión: no), razón interna ni actor. No se concede SELECT sobre las tablas nuevas a clientes. Test: un cliente no ve filas ajenas y la respuesta no contiene las claves prohibidas.

### 2.5 Horario
Todo `timestamptz` (UTC). El front formatea con `Intl.DateTimeFormat(..., {timeZone:'America/New_York'})`, convención ya usada (DashboardPage `timeZoneNote`, zelleService.js:125) y tooltip con UTC. Exportación en ISO-8601 UTC.

## 3. Medible, trazable, registrable (requisito adicional)

### 3.1 MEDIBLE
RPC `admin_refund_metrics(p_from, p_to, p_operation_type DEFAULT NULL)` -> solo agregados, jsonb: 
- `time_to_refund_from_cancel` y `..._from_eligible` (p50, p90, medio, en horas) = `resolved_at - cancelled_at` / `resolved_at - eligible_at` para `status='refunded'`;
- `pct_on_time` = refunded con `resolved_at <= due_at` / refunded;
- `overdue_by_day` (serie: pendientes con `due_at < día` por día, hora ET);
- `pending_amount_by_currency`, `queue_age` (p50/max de `now()-cancelled_at` en pendientes);
- `not_applicable_rate`, `reopen_count` (eventos `closed_by_reopen`), `pct_with_proof` / `pct_without_proof`.
Se calculan desde `refund_requests` (columnas ya inmutables) y de los eventos solo para reaperturas. Rango máximo 366 días. Exportación: `admin_refund_export(p_from,p_to)` devuelve filas de auditoría (ids, operation_number, tipo, montos, moneda, cancelled_at, eligible_at, due_at, resolved_at, estado, actor_id, has_proof, queue_state, SLO cumplido) sin nombre/email/teléfono/referencia; CSV generado en el cliente con escape contra inyección de fórmulas (prefijo `'` en celdas que empiezan por `= + - @`), tope 5000 filas, ISO UTC.
KPIs en `DashboardPage.jsx`: pendientes accionables (ya viene de `admin_refund_counts`), vencidas, % a tiempo 30 d, mediana de horas, monto pendiente, % sin comprobante.
SLO simples: S1 >= 95% de reembolsos resueltos antes de `due_at` (ventana 30 d); S2 cero solicitudes vencidas > 2 días hábiles; S3: 100% de reembolsados con comprobante (obligatorio); S4: 0 comprobantes vencidos sin purgar más de 7 días; S5: 0 `self_resolved` salvo excepción. Alertas sin spam: v1 solo in-app (badge ya existente + KPI en rojo, estado derivado, sin escribir filas por vencer). Aviso por correo = v2, máximo 1 resumen diario y solo si cambió el conteo de vencidas (clave de deduplicación `fecha+conteo`), reutilizando Resend desde una Edge Function; no se construye ahora.

### 3.2 TRAZABLE
Cadena sin FK frágiles: `operation_id` (clave de correlación estable, ya existe) -> `refund_id` (episodio) -> `event.id` (con `refund_id`, `operation_id`, `txid`) -> comprobante (`refunds/{refund_id}/{uuid}.ext`, `proof_object_id` en el evento) -> `activity_logs` (`entity_id=refund_id`, metadata con ambos ids, R4) -> `financial_audit_log` (`row_id = operation_id`, mismo `txid`) -> propuesta de comisión (`remittance_id`). No se crea otro identificador: el uuid de la operación y el de la solicitud bastan (YAGNI). Los FK cascade existen solo operación->solicitud; los eventos y auditoría son sin FK para sobrevivir al reset; la integridad se verifica con la vista de huecos.
RPC `admin_refund_trace(p_operation_type, p_operation_id)`: devuelve la línea de tiempo + `gaps[]` calculados:
- cancelación de operación con estado previo pagado en `*_status_history` y sin `refund_requests` (obligación perdida);
- solicitud sin evento `created` o resuelta sin evento `closed_*`;
- `refunded` sin `proof_path` (marca `no_proof`; error solo si `refund_proof_required()`);
- evento cuya solicitud ya no existe (esperado tras reset: se rotula `orphan_after_reset`, no es error).
Si falta un eslabón, la RPC no falla: reporta el hueco y la UI lo muestra con alerta.

### 3.3 REGISTRABLE
| Qué | Dónde vive | Regla |
|---|---|---|
| Eventos de auditoría | `refund_request_events` + `activity_logs` (ya `refund_resolved`) | inmutables / sin PII; texto libre solo en `refund_requests` |
| Logs front/servicios | helper único `src/lib/logSafe.js` (`sanitizeLogContext`) usado por `logError` y por un nuevo `src/lib/refundService.js` | ids truncados a 8 caracteres, `correlation` = `op:xxxxxxxx refund:xxxxxxxx`; lista de campos prohibidos |
| Errores tipados | `parseSupabaseError` + `ERROR_CODES` (errorHandler.js) con códigos nuevos `REFUND_ON_HOLD`, `REFUND_ALREADY_RESOLVED`, `REFUND_PROOF_REQUIRED`, `REFUND_PROOF_INVALID` | se registran una sola vez, en el servicio (la UI muestra el mensaje i18n, no re-loguea) |
| Edge Functions | ninguna nueva en v1 | si hay (aviso v2): sin emails/URLs en `console` |
Qué NO se loguea: referencia/confirmación Zelle, teléfono, email, nombre, `payment_proof_url`, `proof_path` completo, URLs firmadas (ni su token), montos junto a identidad, `window.location.href` con query (usar solo `pathname`), stack completo en producción de usuario final.
Deuda detectada: `logError` hoy mete `url: window.location.href` y `userAgent` y el stack; el helper debe limitarlo para este módulo sin reescribir el global.
Tests:
- BD (concurrency): un evento se crea con `actor_id`, `actor_role` y `occurred_at = now()` de la transacción; `UPDATE/DELETE/TRUNCATE` sobre eventos falla con 42501; ningún rol API puede INSERT; reabrir y re-cancelar crean eventos nuevos y las filas previas no cambian; el reset de plataforma no se rompe y conserva los eventos; el evento de cancelación comparte `occurred_at` con la fila de status_history.
- Fail-open (BD): con el INSERT de eventos forzado a fallar (p. ej. REVOKE temporal o un CHECK imposible en el entorno de test), cancelar un pedido y una remesa pagados SIGUE funcionando, la `refund_requests` queda creada, hay un WARNING/fila `refund_event_failed` y `admin_refund_trace` devuelve el hueco `no_created_event`. Mismo test sobre la ruta de cierre (`no_closed_event`).
- Purga (BD + Edge): nunca toca archivos no vencidos (vence en 1 s, vence mañana, `proof_expires_at` nulo); ni disputados ni ya purgados; `_mark_refund_proof_purged` rechaza una fila no vencida aunque se la llame directo; dry_run vs ejecutar con conteo distinto se niega; tras ejecutar, el blob no existe en Storage (no solo la fila) y hay un evento `proof_expired` con actor y hora, una vez; segunda corrida = 0 cambios; metadatos intactos; fallo entre borrar y marcar se recupera; el informe "por vencer" cuenta exactamente lo que vence en 30 días.
- Obligatoriedad: `refunded` sin `p_proof_path` falla `proof_required`; `not_applicable` sin comprobante funciona; ruta con otro `refund_id` falla.
- Separación de funciones: ver sección 5c.
- Barrido de PII (BD): aserta que las columnas de `refund_request_events` no están en la lista prohibida y que la función de timeline no devuelve `refund_reference`/`payer_phone`.
- Unit (Vitest): `sanitizeLogContext` trunca ids y elimina claves prohibidas; un test recorre los mensajes de `console.*` de `refundService` simulados y falla si aparece email, teléfono, URL firmada o path completo.
Costo y retención: ~3 filas de evento por reembolso (~150 B/fila); 100k reembolsos ~ 45 MB. Hoy 0 cancelaciones. Retención: indefinida (auditoría); sin purga en v1 (el trigger de inmutabilidad la impide a propósito). Si el volumen lo exige, archivar por rango de fechas con una migración explícita (decisión futura). Comprobantes: ~5 MB máx. c/u; retención igual a la del registro financiero (ND-3).

### 3.4 Checklist reutilizable (mensajería, aceptación de comisión, futuros módulos)
1. Tabla de eventos append-only con triggers anti UPDATE/DELETE/TRUNCATE y sin GRANT de escritura.
2. Actor (id + rol) y `now()` de la transacción en cada evento; `txid` para unir con auditoría financiera.
3. Sin PII ni texto libre en eventos; razones como código.
4. Sin FK que rompa el reset; ids de correlación = ids de dominio existentes.
5. Un RPC admin de línea de tiempo/trace, con `gaps`.
6. Logs front con `sanitizeLogContext` (ids truncados, lista de campos prohibidos) y errores tipados registrados una vez.
7. Métricas solo agregadas + SLO nombrado; alerta sin spam (estado derivado, no filas).
8. Tests: evento con actor/hora, inmutabilidad, barrido de PII, vista del cliente con whitelist.
9. Cliente: RPC propio con whitelist, nunca datos de admin.
10. Documentar retención y tamaño.

## 4. Comprobante del reembolso (R5b)

- Bucket `refund-proofs`: `public=false`, `file_size_limit=5242880` (igual que order-documents, 20261022100000:70), MIME `image/jpeg, image/png, image/webp, application/pdf`. Ruta `refunds/{refund_id}/{uuid}.{ext}`.
- Políticas de storage (patrón de 20261022100000): SELECT e INSERT solo `is_admin_user()` y con nombre que cumpla el regex del prefijo; sin UPDATE. DELETE solo admin y solo si el objeto no está referenciado (`NOT EXISTS (SELECT 1 FROM refund_requests WHERE proof_path = name)`): permite limpiar huérfanos y bloquea borrar un comprobante vigente.
- Columnas nuevas nullable en `refund_requests` (tabla nueva, aditivo): `proof_path text`, `proof_sha256 text` (hash opcional calculado en el cliente con `crypto.subtle`), `proof_expires_at timestamptz`, `proof_purged_at timestamptz`; todas write-once (NULL -> valor, una vez). `proof_expires_at = refunded_at + interval '1 year'` se calcula en la RPC v2 y se guarda (no puede ser columna generada: `timestamptz + interval` no es IMMUTABLE por la zona horaria). CHECK de formato `^refunds/<id>/<uuid>\.(jpg|jpeg|png|webp|pdf)$` y trigger de inmutabilidad de la sección 2.1.
- RPC (revisado por la restricción de producción): `admin_resolve_refund` de R4 NO se reemplaza ni se sobrecarga (sobrecarga con defaults = PGRST203 en PostgREST; DROP+CREATE = cambiar una función viva). Se agrega una función NUEVA `admin_resolve_refund_v2(p_refund_id, p_action, p_reference, p_refunded_at, p_reason, p_proof_path)` que reutiliza la misma lógica (la v1 queda intacta y válida; el front nuevo llama a v2). Solo si R4 aún no está aplicada a remoto se puede integrar `p_proof_path` en su migración antes de aplicarla (decisión del dueño de cuándo aplicar). v2 valida: prefijo = `refunds/{p_refund_id}/`, extensión, y existencia del objeto en `storage.objects` (SECURITY DEFINER puede leerlo). Rollback: re-crear la firma antigua.
- `admin_attach_refund_proof` ya NO se construye: el comprobante es obligatorio al resolver (decisión del dueño), no hay adjuntar-después (YAGNI). El evento `proof_attached` se emite en la misma transacción que `closed_refunded`. No hay "quitar" (ND-2).
- Huérfanos si la RPC falla tras subir: el front intenta borrar el objeto (permitido por la política DELETE condicionada). Si no puede, queda un huérfano contado por una consulta de mantenimiento (objetos del bucket sin `proof_path` con más de 24 h), solo agregado.
- Enlaces: URL firmada de 60 s, creada por demanda al abrir, nunca guardada en estado persistente ni logueada; en listas solo el indicador `has_proof`.
- PII en capturas de Zelle (nombre, email, teléfono, saldo): mitigación = bucket privado + solo admin + firmada 60 s + sin miniaturas en listas + aviso "recorta datos no necesarios" + **expiración y borrado real a 1 año del reembolso**, conservando solo metadatos sin PII (referencia, fechas, hash). Riesgo residual: la captura vive hasta 1 año accesible a admins y una purga olvidada la alarga; por eso 'por vencer' y 'vencidos sin purgar' son KPI.
- Reset de plataforma: `execute_platform_reset` es SQL y no toca Storage (no encontré borrado de storage en la migración; no verifiqué el runbook). Borrar `storage.objects` por SQL no borra el archivo físico. Acción: añadir paso al `runbook_platform_reset.md` para vaciar `refund-proofs` por la API de Storage tras el reset, y que el reset no rompa por eventos (sección 1).
- **Obligatorio desde el inicio (decisión del dueño):** `refund_proof_required()` devuelve `true`. `admin_resolve_refund_v2` con `p_action='refunded'` exige `p_proof_path` (si no, `22023 proof_required`); `not_applicable` solo exige motivo. Estado derivado `proof_state` = `available` | `expired` (purgado) | `none` (solo filas históricas, no deberían existir; el trace las marca `refunded_without_proof`). `expired` cuenta como "con comprobante" en métricas.
- **Retención: 1 año completo tras el reembolso** (`proof_expires_at`). Purga con la API de Storage, nunca por SQL (borrar `storage.objects` por SQL deja el blob huérfano):
  - Mecanismo recomendado: Edge Function nueva `purge-refund-proofs` (service role, `verify_jwt`, el llamante debe ser admin), disparada a mano desde un botón "Purgar vencidos" con vista previa. `dry_run` devuelve conteo y fechas (sin paths); ejecutar exige `confirm_count` igual al de la vista previa o se niega.
  - Por qué manual en v1: verifiqué en prod que `pg_cron` 1.6.4 y `supabase_vault` 0.3.1 están instalados pero `pg_net` NO; programar la llamada HTTP exigiría habilitar una extensión y guardar un secreto en la BD (toca producción). Volumen ~0. Fase 2 (ND-7): habilitar `pg_net` + `cron.schedule` diario hacia la misma Edge Function con secreto en Vault, o cron externo; el mecanismo ya es idempotente.
  - Flujo: (1) RPC `_refund_proofs_due(p_limit)` (solo `service_role`) devuelve `refund_id, proof_path` de filas con `proof_path IS NOT NULL AND proof_purged_at IS NULL AND proof_expires_at <= now()` y sin disputa abierta; la Edge Function toma los paths SOLO de aquí, nunca del request. (2) `storage.remove([path])` por la API; 404 = éxito (idempotente). (3) RPC `_mark_refund_proof_purged(refund_id, actor)` (solo `service_role`): bloquea la fila, REVALIDA vencimiento, disputa y `proof_purged_at IS NULL`, fija `proof_purged_at = now()` y emite el evento `proof_expired`. Primero se borra el blob y luego se marca; si el marcado falla, la siguiente corrida reintenta sin pérdida ni doble evento.
  - Se conservan: `proof_path` (queda como registro sin objeto), `proof_sha256`, referencia, fechas, eventos. La guarda de refund_requests permite exactamente la transición `proof_purged_at` NULL -> valor (solo si venció): no rompe write-once ni la inmutabilidad de eventos (se añade un evento).
  - Disputa abierta: eventos `dispute_opened` / `dispute_closed` vía `admin_set_refund_dispute(refund_id, open)`; estado = último evento; la purga excluye las abiertas. El esquema actual no tiene concepto de disputa (no verificado en otras tablas); esto lo introduce.
  - Informe "por vencer en 30 días": RPC `admin_refund_proofs_expiring(p_days default 30)` con conteo y lista de `refund_id` y `proof_expires_at`, sin paths ni PII; tarjeta en Dashboard y en la sección Reembolso. La UI pide URL firmada solo si `proof_state='available'`.

## 5. UI (R5c)
- Sección "Reembolso" en `OrderDetailsModal.jsx` y en el detalle admin de remesas: estado, importe, fechas ET con tooltip UTC, `queue_state`, enlace "Ver en cola" (navega a la pestaña de devoluciones con el id), indicador de comprobante.
- Componente nuevo `OperationTimeline` (lista ordenada `<ol>` semántica, hora en `<time datetime>`), alimentado por `admin_operation_timeline`; reutiliza `StatusBadge`; filtra por fuente; avisos de `gaps`. `RemittanceTimeline.jsx` es del cliente y no se toca.
- Modal "Marcar reembolsado": campo de archivo OBLIGATORIO (confirmar deshabilitado sin archivo; en "No procede" no aparece) (accept jpeg/png/webp/pdf, 5 MB, validación previa en cliente), subida a `refund-proofs`, luego RPC con `p_proof_path`; si la RPC falla, borra el objeto. Reutiliza `modals/ConfirmDialog.jsx`/`InputDialog.jsx`. Etiquetas con i18n (ES/EN).
- Exportación CSV y KPIs en Dashboard (sección 3.1). Mobile-first 320–1280 px (lista vertical, sin tablas anchas; usar `ResponsiveTableWrapper` si hay tabla), foco visible, `aria-live` en subida, contraste AA.

## 5b. Protección de datos de producción (restricción dura del dueño)

Principios: (1) todo aditivo: tablas, bucket, columnas nullable, funciones nuevas; (2) cero UPDATE/DELETE/backfill sobre filas existentes; (3) no se reemplaza ninguna función viva (por eso `admin_resolve_refund_v2`; `_order_transition`, `_remittance_transition`, `audit_*_status_change`, triggers de orders/remittances NO se tocan; el único trigger nuevo cuelga de la tabla nueva `refund_requests`); (4) timeline/trace/metrics/export son RPC STABLE de solo lectura; (5) eventos sin backfill.
Estado verificado: R4 no está aplicada (bucket y tablas de reembolso no existen en prod; 0 cancelaciones). Si algo de R4/R5 falla, el sitio actual no cambia porque no depende de ninguna de estas piezas, salvo los triggers de cancelación de R4 (ver abajo).

Despliegue en pasos reversibles (cada paso exige un "dale" separado del dueño; nunca `apply_migration` automático):
0. Rama de Supabase / entorno local primero: correr toda la suite concurrency contra copia (no contra prod).
1. R4 migración 1/4 (tabla). 2. R4 migraciones 2-4 (funciones, triggers, RPCs): único paso con riesgo para el flujo vivo, porque añade triggers AFTER UPDATE OF status en orders/remittances (hoy fail-closed en R4; pendiente de pasar a fail-open según la otra rama). Mitigación: test de cancelación con y sin pago antes; rollback inmediato = DROP TRIGGER (los 4 triggers), instantáneo.
3. R5a (eventos, trigger sobre refund_requests, RPC de lectura). 4. R5b (bucket + columna + RPC v2/attach). 5. Front (R5c), detrás de datos que ya existen; el front antiguo sigue compatible.
Cada migración usa `SET LOCAL lock_timeout='5s'`, `IF NOT EXISTS`/`CREATE OR REPLACE` solo sobre objetos propios, transacción única, y no adquiere locks largos en orders/remittances (solo `CREATE TRIGGER` en R4, lock breve).

Comprobaciones previas (snapshot guardado en el runbook, solo conteos y checksums, sin PII):
- Conteos: orders, remittances, order_status_history, remittance_status_history, activity_logs, financial_audit_log, zelle_transaction_history, remittance_commission_overrides/proposals, storage.objects por bucket.
- Checksums: `md5(string_agg(id::text||status||coalesce(payment_status,'') , ',' ORDER BY id))` de orders y de remittances (id+status+total), y `md5` de `pg_get_functiondef` de `_order_transition`, `_remittance_transition`, `audit_order_status_change`, `audit_remittance_status_change` (verificación del prosrc: deben ser idénticos antes y después).
- Lista de triggers de orders/remittances (nombres) para comparar.
Comprobaciones posteriores (tras cada paso): los mismos conteos y checksums deben coincidir exactamente (sin cambios en tablas existentes); las dos columnas nuevas/tablas aparecen; `get_advisors` sin nuevos avisos de seguridad; una cancelación de prueba en entorno local (no en prod) crea 1 solicitud y 1 evento.

Reversión por migración (todas con archivo en `supabase/rollbacks/`; exportar filas antes si la tabla ya tiene datos):
- 110000 eventos: DROP TRIGGER en refund_requests, DROP FUNCTION, DROP TABLE refund_request_events (pierde auditoría: exportar antes). Efecto sobre operaciones: ninguno.
- 110100 / 110200 (RPC de lectura): DROP FUNCTION.
- 110300 bucket: borrar políticas de storage; el bucket solo se elimina vacío (si hay comprobantes, conservar el bucket y dejarlo sin políticas). Columna `proof_path`: `DROP COLUMN` solo si todas son NULL; si no, dejarla.
- 110400: DROP de `admin_resolve_refund_v2` y `admin_attach_refund_proof`.
Si algo falla a medio camino: cada migración es transaccional (todo o nada). Si falla el trigger de eventos en producción: ya no bloquea cancelaciones (fail-open); se corrige y, de ser necesario, se hace `DROP TRIGGER` del trigger de eventos (la cancelación vuelve a funcionar, se pierden solo eventos nuevos hasta corregir; el estado de la solicitud sigue en `refund_requests` e `activity_logs`). Si hay que apagar el comprobante: `refund_proof_required()` es constante `false` por defecto; ponerla en false (migración `CREATE OR REPLACE` de una función propia nueva) o ignorar el campo en el front desactiva su exigencia; los comprobantes ya subidos y sus filas se conservan, no se borran. Flag/datos: no hay flag en tabla en v1, por eso no existe estado de flag a corromper; los datos de reembolso existentes no se modifican nunca por una reversión (salvo el DROP TABLE de eventos, que es auditoría nueva).

## 5c. Admin como cliente / separación de funciones

Hallazgos (verificados en migraciones): `_order_transition` calcula `v_is_admin` y `v_is_owner` por separado y la rama admin tiene precedencia en varias acciones (20261024110000:105-121); solo la rama de no-admin sobrescribe `payment_status` a 'rejected' (línea 225). El trigger de R4 etiqueta `cancelled_by_role` con `is_admin_user()`: 'admin' aunque sea el dueño. `admin_set_remittance_commission` solo exige ser admin (20261028100300:26-27), sin comparar con `remittances.user_id`; `remittance_accept_commission` exige ser el dueño (líneas 169-170), así que un admin-dueño podría proponer y aceptar sobre su propia remesa. Hoy: 5 admins, 0 operaciones propias (dato del coordinador, no re-verificado).

Diseño:
1. Admin-cliente: usa las mismas RPC de cliente (cancelar, ver su estado de reembolso v2 vía `my_operation_refund`, filtrado por `user_id = auth.uid()` sin importar el rol). Su solicitud entra a la cola normal; el evento `created` añade `owner_is_actor boolean` (compara `auth.uid()` con `user_id`) para no depender del rol.
2. Conflicto de interés: `admin_resolve_refund_v2` y `admin_set_refund_dispute` rechazan con `self_resolution_not_allowed` si `auth.uid() = refund.user_id`, antes de cualquier cambio. Código tipado `REFUND_SELF_RESOLUTION_NOT_ALLOWED` en `ERROR_CODES`. Todo evento `closed_*` registra `owner_is_actor`. La cola devuelve `is_own_operation` calculado en servidor; la UI muestra la etiqueta "Operación propia" y deshabilita las acciones mostrando el motivo (`aria-describedby`); la defensa real es la RPC, no el botón.
3. Auditoría del intento: un `RAISE EXCEPTION` deshace la transacción y con ella cualquier INSERT, y plpgsql no tiene transacciones autónomas. Por eso la RPC devuelve `jsonb {ok:false, code:'self_resolution_not_allowed'}` (no lanza) tras insertar el evento `self_resolution_blocked` (sin PII) y un `RAISE WARNING`; el servicio front lo convierte en error tipado. El trace marca `self_dealing_attempt` por cada evento de ese tipo.
4. Único super_admin que es también el cliente: se permite SOLO con `p_self_resolve_confirm = true` (confirmación reforzada en UI: texto + segundo clic) y solo si `is_super_admin()`; un admin normal nunca. Queda `self_resolved=true` en el evento y en la fila (columna nullable write-once). Las métricas lo cuentan aparte (`self_resolved_count`, S5): no se excluyen del cumplimiento de plazo, pero se muestran en rojo en el Dashboard y en el export.
5. Otros flujos ya aplicados (RIESGO + recomendación; NO modificados aquí, tocan funciones vivas y requieren migración aparte con verificación del `prosrc` y "dale" propio):
   - `admin_set_remittance_commission` sobre la remesa propia: un admin podría bajarse su comisión. Recomendar rechazar si `auth.uid() = remittances.user_id`; igual en override y propuestas.
   - `remittance_accept_commission`: el admin-dueño acepta su propia propuesta; con el punto anterior cierra el círculo. Recomendar el bloqueo en la propuesta, no en la aceptación.
   - Validación de pago propio (`order_validate_payment` y equivalente en remesas): un admin puede validar el pago de su propia operación. Recomendar bloquear validar y rechazar pago cuando el actor es el dueño.
   - Entregas (`mark_delivered`, `complete`) y otros cambios administrativos sobre operaciones propias: mismo criterio, mínimo marcar `owner_is_actor` en el historial.
   - Mensajería: un admin en su propio hilo mezcla roles; mostrar el rol del emisor y no atender un hilo propio con el mismo usuario. No revisé el módulo de mensajería.
6. Tests: admin cancela su pedido pagado -> solicitud en cola con `owner_is_actor=true`; ese admin no resuelve (`self_resolution_not_allowed`), queda `self_resolution_blocked` y el trace muestra `self_dealing_attempt`; otro admin sí puede; super_admin con confirmación resuelve y queda `self_resolved`; admin normal con confirmación es rechazado; `is_own_operation` correcto; el cliente no ve campos de otros.

## 6. Etapas TDD
Cada etapa: test rojo -> migración -> verde -> corrección (relectura) -> verificación -> actualizar `TRACKING_PROGRESS.md`. Nada se aplica a remoto sin "dale". Pruebas de BD en `src/tests/concurrency/` (patrón de `financialAuditLog.test.js`), UI en `src/tests/unit/`.

R5a (eventos + timeline + trace + métricas):
- 20261029110000_refund_request_events.sql (tabla, inmutabilidad, `_refund_event`, trigger sobre refund_requests, guarda de filas terminales). Rollback `..._down.sql`.
- 20261029110100_operation_timeline_trace.sql (`admin_operation_timeline`, `admin_get_operation_refunds`, `admin_refund_trace`).
- 20261029110200_refund_metrics_export.sql (`admin_refund_metrics`, `admin_refund_export`).
Depende de R4 aplicada (misma ventana).

R5b (comprobante): 
- 20261029110300_refund_proofs_bucket.sql (bucket, políticas, columnas `proof_path/sha256/expires_at/purged_at`, CHECK, `refund_proof_required()` = true).
- 20261029110400_refund_resolve_with_proof.sql (función NUEVA `admin_resolve_refund_v2` con control de autoresolución; no toca la v1). Rollback: DROP.
- 20261029110500_refund_proof_retention.sql (`_refund_proofs_due`, `_mark_refund_proof_purged` solo service_role, `admin_set_refund_dispute`, `admin_refund_proofs_expiring`). Edge Function `supabase/functions/purge-refund-proofs/` (despliegue aparte, con su "dale"). Rollback: DROP FUNCTION y borrar la Edge Function; columnas y eventos ya escritos se conservan.

R5c (UI): `logSafe.js`, `refundService.js` (extensión), `OperationTimeline`, sección Reembolso, modal con archivo, KPIs, CSV, i18n, runbook de reset.

Orden de despliegue: R4 -> R5a -> R5b -> R5c. Front antes que BD no sirve (RPC inexistente); BD antes que front es compatible.

## 7. Riesgos
1. Fail-open por decisión del dueño: un fallo del módulo de reembolsos jamás aborta una cancelación legítima. El trigger de eventos captura la excepción (WARNING + `activity_logs` best-effort); el costo es que puede faltar un evento. El hueco es detectable: `admin_refund_trace` reporta `no_created_event` / `no_closed_event` y el KPI de huecos lo cuenta. Mismo criterio aplica a cualquier trigger encadenado a la cancelación; `refund_request_on_cancel` / `_on_reopen` de R4 (hoy fail-closed, ver 20261029100200:24-26) se reevalúa en la otra rama; si pasan a fail-open, el hueco `paid_cancel_without_refund_request` del trace ya cubre la obligación perdida. Limitación: un fallo de sintaxis/permiso en el cuerpo se captura igual, por eso los tests de contrato corren antes de aplicar. Nota: lo que sí sigue siendo error son las RPC de admin (resolve/attach), que no corren dentro de la cancelación.
2. Inmutabilidad por trigger no frena a un superusuario de BD ni `DROP TABLE` (mismo límite que financial_audit_log).
3. Eventos sin FK + reset: quedan eventos huérfanos legítimos.
4. PII en capturas (aceptado, mitigado).
5. Reapertura (ND-5 de R4) cierra el reembolso como `not_applicable`: si luego se vuelve a cancelar y ya se había reembolsado fuera del sistema, queda doble obligación; el trace lo muestra.
6. v1 y v2 de resolve conviven: riesgo de que dos clientes de UI resuelvan con reglas distintas; la v2 delega en la misma validación y el front nuevo solo usa v2.
7. Referencia Zelle: no va al cliente ni a eventos.

## 8. Decisiones ND (recomendación)
- ND-1 DECIDIDO: comprobante obligatorio para `refunded` desde el inicio (`refund_proof_required()=true`); `not_applicable` solo motivo.
- ND-2 Reemplazar/quitar comprobante: no; write-once. Un error se corrige con nota/evento, no se borra.
- ND-3 DECIDIDO: comprobantes expiran y se borran 1 año completo tras `refunded_at`; eventos y metadatos se conservan indefinidamente.
- ND-4 Cliente ve referencia del reembolso: no en v2 inicial; solo estado y fechas.
- ND-5 Alerta por correo de vencidas: v2, resumen diario deduplicado.
- ND-7 Programación de la purga: manual con vista previa en v1; pg_cron + pg_net (hoy sin pg_net) en fase 2 si el dueño lo pide.
- ND-8 Super_admin único que es también el cliente: permitido con confirmación reforzada y marca `self_resolved` (sección 5c).
- ND-6 Backfill: PROHIBIDO por el dueño. La tabla de eventos nace vacía; una solicitud creada antes de R5a (si R4 se aplicara antes y ya hubiera filas) aparece en el trace con el hueco `no_created_event` en lugar de un evento sintético.

Pregunta mínima: ¿aceptás la purga manual con vista previa en v1 (sin habilitar pg_net en prod) y automatizarla después?

## 9. No verificado
No leí el skill /observability; no revisé columnas de entrega de remesas/pedidos ni las de `zelle_transaction_history`; no corrí SQL de las migraciones (nada aplicado); no revisé el runbook de reset por pasos de Storage; no comprobé los componentes de la pestaña de devoluciones (rama sin merge); estimaciones de tamaño son aproximadas.
