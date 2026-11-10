# Plan: aceptación del cliente tras un reajuste de comisión de remesa

Estado: DISEÑO v2 (nada implementado, nada aplicado en prod). Base: `origin/main` 51e18bf9. Fecha: 2026-10-23.
Requisito: "Una vez que el admin reajusta la comisión de una remesa, el cliente debe ser NOTIFICADO y tener la opción de ACEPTAR o CANCELAR."
**Decisión del dueño (cerrada): "paga" = se sube el comprobante. La comisión queda CONGELADA desde `payment_proof_uploaded`. Ajuste, aceptación y cancelación por ajuste solo existen en `payment_pending` y `payment_rejected`.**

---

## 1. Hallazgos (verificados leyendo código y con SELECT a prod)

### 1.1 Qué cambia al reajustar
- `amount_to_deliver = round((amount_sent - commission) * rate4, 2)`. Lo que el cliente PAGA (`amount_sent + delivery_cost`) no cambia. Subir la comisión reduce lo que recibe el destinatario; bajarla lo aumenta. Solo una SUBIDA necesita consentimiento.
- Prod hoy: `admin_set_remittance_commission` (migración 20261025100000, aplicada, verificado por `prosrc`) permite `payment_pending|rejected|proof_uploaded` (sube/baja) y `payment_validated` (solo baja). **Contradice la decisión del dueño: hay que restringirlo (ver 2.5).** Datos: 1 fila en overrides, 1 remesa en `proof_uploaded`, 3 en `payment_validated`; ninguna propuesta existe (tabla nueva), así que no hay datos que migrar.

### 1.2 Infraestructura de notificación: estado REAL en prod
| Canal | Estado hoy | Evidencia |
|---|---|---|
| `user_alerts` | **Vacía (0 filas), nunca usada.** `authenticated` solo tiene SELECT/UPDATE; INSERT solo `service_role`, así que `createUserAlert` desde el navegador (sesión del admin) no puede funcionar. | policies, grants, `count(*)=0` |
| `user_alerts` en Realtime | **No** está en `supabase_realtime` (solo `remittances`). | `pg_publication_tables` |
| Superficie in-app | Solo `ZelleAccountAlert`, montado únicamente en `CartPage`. No hay campana/banner global. | `rg` |
| Integridad de `user_alerts` | El dueño puede UPDATE cualquier columna de su fila: solo sirve como puntero, no como estado de negocio. | política `Users can update own alerts` |
| WhatsApp al cliente | **No automatizado.** `notifyUser*` devuelve un string que el llamador descarta; único envío = enlace `wa.me` abierto a mano por el admin. `user_profiles` no tiene teléfono; solo `remittances.payer_phone` (opcional). | código + `information_schema` |
| Email (Resend) | `notify-zelle-deactivation` ACTIVA, pero responde 200 `success:false` si falta `RESEND_API_KEY` (falla silenciosa). **No verificable**: ni secretos ni logs de edge accesibles por MCP. `notification_settings` solo tiene destinos del admin. | list_edge_functions, código |
| `pg_cron` | Instalado (1.6.4); no necesario en este diseño. | `pg_extension` |
| Realtime `remittances` | Sí; `MyRemittancesPage`/`UserPanel` ya se refrescan. Un UPDATE a la remesa llega al cliente conectado. | código |

**Único canal confirmado de punta a punta:** estado en BD + página del cliente con Realtime de `remittances`.

### 1.3 Riesgos
1. Consentimiento: el cliente no debe poder pagar (subir comprobante) un importe que no vio. Con el congelamiento, el riesgo se reduce a "no subir comprobante con una subida pendiente".
2. Carrera aceptar vs. re-ajuste (el cliente acepta un valor ya reemplazado) y carrera subir-comprobante vs. ajuste.
3. `_remittance_transition` en prod = cuerpo de **20261025110000** (contiene 'without proof'), no el de 20261024110100. Reemplazarlo con el cuerpo viejo revertiría "comprobante de entrega opcional" => el diseño NO toca el helper.
4. Deriva repo/prod: comparar `prosrc` antes de aplicar; usar `apply_migration`/psql, no `db push`.
5. Reglas a no romper: ND-5 de la ola 4 (motivo oculto al dueño), `guard_remittance_money_columns`, `guard_remittance_owner_update`, `guard_status_via_rpc`.
6. Otro escritor modifica `AdminRemittancesTab`, `AdminRemittancesInbox`, `MyRemittancesPage`, `UserPanel`, `TermsPage`, `legalConfig` (botón ajustar comisión en tarjetas, cancelar con aviso de reembolso). La UI nueva = componentes autocontenidos + inserciones de 1 línea. **Su botón de ajustar comisión debe usar `canAdjustCommission` de `commissionOverrideRules.js`** (que este plan cambia) en vez de listas de estados propias; coordinarlo.

---

## 2. Diseño recomendado

### 2.1 "Paga" y congelamiento (ya decidido; ambigüedad resuelta)
Se consideraron: (a) comprobante subido, (b) pago validado. Decidió el dueño (a). Consecuencia: el cliente ve un importe estable desde el momento en que declara haber pagado; el admin ya no puede cambiarlo mientras revisa el comprobante. Si el admin RECHAZA el comprobante (`payment_rejected`), la comisión se descongela: el cliente debe re-subir, y puede aceptar un nuevo importe antes. Nota: en `payment_rejected` el cliente pudo haber transferido dinero real con un comprobante inválido; si cancela ahí, el aviso de reembolso aplica (ND-6).

### 2.2 Qué se simplifica
Como el ajuste solo ocurre antes de pagar:
- **Aceptar = habilitar el pago con el nuevo importe.** No hay reembolso en `payment_pending` al cancelar (no hay pago); en `payment_rejected` aplica el aviso general.
- Desaparecen: el bloqueo de `remittance_validate_payment`, el caso "bajada en `payment_validated`", la expiración (una propuesta sin respuesta solo deja la remesa sin pagar; no hay dinero detenido), y la necesidad de revisar interacción con validar/procesar.
- La puerta de seguridad se mueve de `validate` a `submit_proof`: **no se puede subir comprobante (entrar a `payment_proof_uploaded`) con una subida pendiente.**
- `remittance_cancel` existente sirve para "cancelar" (matriz sin cambios).

### 2.3 Modelo de datos: tabla `remittance_commission_proposals`
Escrita SOLO por RPC SECURITY DEFINER; legible por el dueño y los admins; **sin motivo**.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid pk default gen_random_uuid() | el cliente acepta ESTE id |
| remittance_id | uuid fk remittances ON DELETE CASCADE | |
| override_id | bigint fk remittance_commission_overrides | enlace de auditoría (el dueño no puede leer esa tabla) |
| direction | text check ('increase','decrease') | respecto a la base |
| baseline_commission | numeric(10,2) | última comisión que el cliente vio/aceptó |
| new_commission | numeric(10,2) | |
| status | text check ('pending','accepted','superseded','reverted','cancelled','informed') | |
| created_at, created_by, responded_at, responded_by | | |

- `UNIQUE (remittance_id) WHERE status='pending'`; índice `(remittance_id, created_at DESC)`.
- RLS ON: SELECT dueño (`EXISTS remittances r WHERE r.id=remittance_id AND r.user_id=(select auth.uid())`), SELECT admin (`(select is_admin_user())`), política de bloqueo de usuarios deshabilitados copiada de `user_alerts` (`NOT current_user_is_blocked()`). Sin políticas de escritura.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` y luego `GRANT SELECT TO authenticated, service_role` (Supabase concede ALL por defecto).
- No se guardan montos a entregar: la UI los calcula de la fila viva con la regla `rate4` de `moneyPure` (así `recalculate_remittance_at_current_rate`, que conserva el override y mueve la tasa, no deja snapshots obsoletos).
- Descartado: nuevo `remittances.status` (rompe matriz, `guard_status_via_rpc` y mapas de UI del otro escritor); columnas en `remittances` (viola ND-5 y listas de auditoría); columnas de respuesta en `remittance_commission_overrides` (admin-only/append-only fijado por tests; abrirlo arriesga filtrar `reason`).

### 2.4 Máquina de estados de la propuesta
```
admin_set sube sobre la base ---------> pending
admin_set baja bajo la base ----------> informed (solo aviso)
admin_set a valor == base ------------> sin fila (si había pending => reverted)
pending --cliente acepta--------------> accepted
pending --admin reajusta otra vez-----> superseded (nace una nueva sobre LA MISMA base)
pending --admin vuelve a <= base------> reverted
pending --remesa cancelada------------> cancelled (trigger)
```
- Base = comisión de la `pending` abierta (su `baseline_commission`) o, si no hay, el `commission_total` previo. Tras `accepted`, la comisión aceptada es la nueva base.
- "Retirar un ajuste" = el admin reajusta al valor base (no hace falta RPC de retiro).
- Bajada: no pide aceptación (solo beneficia y el pago no cambia): aviso informativo.

### 2.5 Migraciones y RPC (SECURITY DEFINER, `search_path = public, pg_temp`)

**M0 - congelamiento (independiente y primera).** `20261028100000_commission_freeze_after_proof.sql`: `CREATE OR REPLACE admin_set_remittance_commission(uuid, numeric, text)` sobre el cuerpo de 20261025100000 con, solo, el cambio de la compuerta de estado:
- Permitido: `payment_pending`, `payment_rejected`. Cualquier otro => 22023 `invalid_status` ("the commission is frozen once the customer uploads the payment proof").
- Se elimina la rama "payment_validated solo baja" (`invalid_commission` por subida en validated). Mismo `FOR UPDATE`, validaciones de monto/motivo, historial, grants y firma.
- **Reemplaza la ventana de 20261025100000** (que fue una decisión previa del dueño, ahora superada). Rollback: `supabase/rollbacks/20261028100000_commission_freeze_after_proof_down.sql` = cuerpo de 20261025100000.
- Es estrictamente restrictiva: segura de aplicar ANTES del front. Con el front viejo, el botón sigue visible en `proof_uploaded/validated` y el RPC responde `invalid_status` (error comprensible, sin pérdida de datos). Aplicable ya, antes de la aceptación (no depende de M1-M3). Comparar `prosrc` de prod antes.
- Los 4 tests/archivos que fijan la ventana ampliada hay que actualizarlos (TDD: primero rojos): `src/tests/concurrency/remittanceCommissionOverride.test.js`, `src/tests/unit/remittanceService.adminOverride.test.js`, y `commissionOverrideRules` (+ su test).

**Botón de UI (admin).** `commissionOverrideRules.js`: `canAdjustCommission` => solo `payment_pending|payment_rejected`; eliminar `LOWER_ONLY_STATUSES`/`isLowerOnlyCommission` y la validación `maxCommission/lowerOnly` si nada más la usa (verificar con rg). `CommissionOverrideModal`: quitar copy "solo bajar". En tarjetas/bandeja: ocultar el botón en los demás estados, o mostrarlo deshabilitado con `title`/texto accesible "Comisión congelada: el cliente ya subió el comprobante" (recomendado deshabilitado + texto visible a 320 px, no solo tooltip). Para la UI del otro escritor: reutilizar `canAdjustCommission`.

**M1** `20261028100100_commission_proposals_table.sql`: tabla 2.3. Rollback: DROP TABLE (exportar filas antes).

**M2** `20261028100200_commission_acceptance_guard.sql`: trigger `guard_commission_acceptance`, BEFORE UPDATE OF status ON remittances, FOR EACH ROW, SECURITY DEFINER, `ENABLE ALWAYS`:
- `NEW.status='payment_proof_uploaded'` y existe `pending` => `RAISE 'commission_pending_acceptance'` (22023). **Bloquea `remittance_submit_proof`** (solo vía donde se entra a ese estado).
- `NEW.status='cancelled'` => propuestas `pending` pasan a `cancelled` y se descarta la alerta.
- Race-safe: `submit_proof`, `cancel`, `accept` y `admin_set` toman todos el mismo `FOR UPDATE` de la fila de la remesa antes de tocar la propuesta.
- Descartado: editar `_remittance_transition` (riesgo 3). Rollback: DROP TRIGGER/FUNCTION.

**M3** `20261028100300_commission_acceptance_rpcs.sql`:
- `admin_set_remittance_commission`: CREATE OR REPLACE sobre el cuerpo de M0, añadiendo tras el UPDATE (misma transacción y lock): resolver base, cerrar la `pending` previa (`superseded`/`reverted`), insertar `pending` (subida) o `informed` (bajada), insertar/descartar `user_alerts` (texto SIN motivo; ver 3.1). Devuelve `remittances` como hoy (contrato admin intacto).
- `remittance_accept_commission(p_remittance_id uuid, p_proposal_id uuid) RETURNS remittance_commission_proposals`; `REVOKE PUBLIC, anon`, `GRANT authenticated`. Orden como el helper: `auth.uid()` => `current_user_is_blocked()` => lectura sin lock del dueño (ajeno/inexistente = 42501) => solo dueño (los admins NO aceptan por el cliente) => `FOR UPDATE` remesa => estado en (`payment_pending`,`payment_rejected`) si no 22023 `invalid_transition` => propuesta por `id`+`remittance_id` `FOR UPDATE` (P0002) => si ya `accepted` devuelve la fila (idempotente); si no `pending` => 22023 `proposal_not_open` (DETAIL=status) => `remittances.commission_total = new_commission` si no 22023 `proposal_stale` => `accepted` + `responded_*` + descartar alerta + `UPDATE remittances SET updated_at=now()` (difunde Realtime; no toca dinero ni status, pasa los 3 guards).
- Cancelar: `remittance_cancel` existente con motivo `commission_declined` (el trigger cierra la propuesta).
- Rollback: restaurar cuerpo de M0, DROP FUNCTION accept.

**M4 (opcional)** `20261028100400_user_alerts_realtime.sql`: añadir `user_alerts` a `supabase_realtime`.

### 2.6 Interacción con el flujo de pago
- Con `pending`, el cliente no puede subir comprobante (DB: M2; UI: control deshabilitado con explicación). Tras aceptar, sube comprobante normalmente y desde ahí la comisión está congelada.
- Descuentos/ofertas: `admin_set` ya fija `discount_amount=0`; la comparación usa `commission_total` neta. `recalculate_remittance_at_current_rate` (solo pending/rejected, cliente) no se toca: conserva el override; la propuesta guarda solo comisiones.
- Si el admin reajusta mientras el cliente está subiendo: serializa por lock; o sube primero el comprobante (queda congelado y el admin recibe `invalid_status`), o gana el ajuste y el submit falla con `commission_pending_acceptance` (UI recarga y muestra la propuesta).

### 2.7 Qué ve el cliente
- Componente `CommissionChangeNotice` (autocontenido; 1 línea en `MyRemittancesPage` y en el detalle de `UserPanel`): `role="alert"`, comisión **anterior -> nueva**, destinatario recibe **anterior -> nuevo**, "tú pagas: sin cambios", botones **Aceptar** / **Cancelar remesa**. Sin el motivo (ND-3).
- Cancelar: en `payment_pending` sin aviso de reembolso (no hay pago); en `payment_rejected` el aviso del otro escritor / TermsPage §9 (`REFUND_BUSINESS_DAYS`).
- Bajada: aviso informativo descartable.

### 2.8 Qué ve el admin
- Insignia `CommissionProposalBadge` en tarjeta/bandeja: "Esperando al cliente" (pending) / "Aceptada" (accepted), con antigüedad solo informativa.
- Botón de comisión según 2.5; tras guardar, mensaje "Se notificó al cliente; debe aceptar antes de subir el comprobante" (subida) o "Se notificó al cliente" (bajada) y botón opcional "Avisar por WhatsApp" (`wa.me` al `payer_phone` si existe; sin motivo).
- `Validar pago` no necesita bloqueo nuevo (no puede existir `pending` en `proof_uploaded`).

---

## 3. Canales de notificación

### 3.1 Mínimo viable (recomendado)
1. Estado en BD + banner `CommissionChangeNotice` con Realtime de `remittances` ya existente (canal confirmado).
2. Alerta persistente en `user_alerts` insertada DENTRO del RPC (no desde el navegador): tipos `commission_change_pending` (warning, `action_required`), `commission_lowered`, `commission_change_reverted` (info); `metadata={remittanceId, proposalId}`; `action_url` a Mis Remesas; descartada dentro de accept/cancel/supersede. Es puntero: la fuente de verdad es la propuesta. Sin motivo en título/mensaje/metadata.
3. `CommissionAlertBanner` global opcional (patrón `ZelleAccountAlert`) en el shell de usuario; sin M4 carga al montar/foco.
4. Manual: "Avisar por WhatsApp" del admin.

### 3.2 Email / WhatsApp automáticos
- Email: confirmar `RESEND_API_KEY`/`FROM_EMAIL` y dominio verificado; Edge Function nueva `notify-commission-change` que reciba solo `proposalId` y lea destino/montos de BD (service role); tratar `success:false` como error visible. Fuera del MVP.
- WhatsApp: requiere proveedor/Business API y teléfono del cliente (no existe en `user_profiles`). Fuera de alcance.

### 3.3 Textos (sin motivo interno)
ES
- Título: "Cambió la comisión de tu remesa {number}"
- Cuerpo: "La comisión pasó de {old} a {new} {currency}. Tu destinatario recibirá {newAmt} {cur} en lugar de {oldAmt} {cur}. Tú pagas lo mismo: {total}. Acepta para poder enviar tu comprobante de pago."
- Botones: "Aceptar nueva comisión" / "Cancelar remesa"
- Cancelar (pending): "¿Cancelar la remesa {number}? Aún no se registró ningún pago." / (rejected): "Si ya enviaste el pago, lo reembolsaremos manualmente en {REFUND_BUSINESS_DAYS} días hábiles."
- Bajada: "Buenas noticias: bajamos la comisión de tu remesa {number}. Tu destinatario recibirá {newAmt} {cur}. No tienes que hacer nada."
- Retirado: "El ajuste de comisión de tu remesa {number} fue retirado; todo sigue como antes."
- Aceptada: "Aceptaste la nueva comisión. Ya puedes subir tu comprobante."
- `proposal_not_open`: "El ajuste cambió mientras lo revisabas. Te mostramos la propuesta actualizada."
- Admin congelado: "Comisión congelada: el cliente ya subió el comprobante."
EN
- "The fee on your remittance {number} changed"
- "The fee went from {old} to {new} {currency}. Your recipient will receive {newAmt} {cur} instead of {oldAmt} {cur}. You pay the same: {total}. Accept to be able to upload your payment proof."
- "Accept new fee" / "Cancel remittance"
- (pending) "Cancel remittance {number}? No payment has been registered yet." / (rejected) "If you already sent the payment, we will refund it manually within {REFUND_BUSINESS_DAYS} business days."
- "Good news: we lowered the fee on remittance {number}. Your recipient will receive {newAmt} {cur}. No action needed."
- "The fee adjustment on remittance {number} was withdrawn; everything stays as before."
- "You accepted the new fee. You can now upload your proof."
- "The adjustment changed while you were reviewing it. We are showing you the updated proposal."
- "Fee frozen: the customer already uploaded the payment proof."

### 3.4 Accesibilidad y mobile-first
`role="alert"` (subida pendiente) / `role="status"` (informativos), sin robar el foco, H1 único por página; botones >= 44x44 px (`min-h-[44px]`), apilados a 320 px y en fila desde `sm`; comparación antes/ahora como lista de definiciones/tabla con encabezados y texto "antes/ahora" (no solo color o flechas); contraste WCAG 2.1 AA; `aria-busy`, errores con `aria-describedby`; probar 320/375/768/1280 sin scroll horizontal; claves `remittances.commissionChange.*` en ES.json/EN.json; botón admin deshabilitado con texto visible (no solo tooltip).

---

## 4. Decisiones pendientes (ND) para el dueño
Ya decididas y retiradas: "paga" = comprobante subido; congelamiento desde `payment_proof_uploaded`; ajuste/aceptación solo en `payment_pending|payment_rejected`.

- **ND-1. Aceptación solo para SUBIDAS (bajadas = solo aviso).** Recomendado: sí. Tradeoff: una bajada nunca perjudica y el pago no cambia; exigir aceptación añade fricción por una mejora.
- **ND-2. Bloquear en BD la subida de comprobante mientras haya subida pendiente (trigger M2).** Recomendado: sí. Tradeoff: sin bloqueo "aceptar" sería decorativo (el cliente podría pagar sin ver el nuevo importe, aunque la UI lo guíe); coste: 1 trigger de ~15 líneas. Alternativa: solo guía de UI.
- **ND-3. Mostrar el motivo del admin al cliente.** Recomendado: NO (ND-5 de la ola 4). Tradeoff: el cliente ve el "qué" pero no el "por qué". Opción: campo opcional separado `customer_message` redactado para el cliente.
- **ND-4. Sin expiración automática.** Con el congelamiento una propuesta sin respuesta solo deja la remesa sin pagar (no hay dinero retenido). Recomendado: sin auto-acción, solo insignia de antigüedad. Alternativa: auto-revertir a la base tras N horas (pg_cron); deshace decisiones del admin sin que lo sepa.
- **ND-5. Canal mínimo.** Recomendado: banner + `user_alerts` (por RPC) + botón manual de WhatsApp del admin; email/Resend como etapa 2 condicionada a confirmar secretos/dominio. Tradeoff: quien no abra la web no se entera hasta que el admin avise.
- **ND-6. Cancelar en `payment_rejected` por rechazar un ajuste.** El cliente pudo transferir con un comprobante inválido. Recomendado: aviso estándar de reembolso (TermsPage §9, `REFUND_BUSINESS_DAYS`). Tradeoff: promesa comercial/legal distinta de la política si el dueño quiere trato especial.
- **ND-7. Tope al ajuste del admin.** Hoy solo `< amount_sent`. Recomendado: sin tope nuevo aquí (la aceptación del cliente es el control). Tradeoff: un tope/doble aprobación es otro feature de política.

---

## 5. Plan por etapas (TDD: test rojo -> implementar -> refactor; correction protocol tras cada archivo)

Orden de despliegue: migraciones primero, luego front. Cada migración idempotente, `SET LOCAL lock_timeout='5s'`, rollback en `supabase/rollbacks/`. Aplicar a prod requiere "dale" explícito del dueño. Verificar con SELECT (`pg_proc.prosrc`, políticas, `pg_trigger`) tras aplicar.

| # | Archivo | Contenido |
|---|---|---|
| M0 | `20261028100000_commission_freeze_after_proof.sql` | compuerta pending/rejected |
| M1 | `20261028100100_commission_proposals_table.sql` | tabla + RLS |
| M2 | `20261028100200_commission_acceptance_guard.sql` | trigger submit_proof/cancel |
| M3 | `20261028100300_commission_acceptance_rpcs.sql` | admin_set con propuesta + accept |
| M4 (opc.) | `20261028100400_user_alerts_realtime.sql` | publicación Realtime |

### Etapa 0 - Congelamiento (entregable independiente, PR 1)
- Rojos: `admin_set` en `payment_proof_uploaded`, `payment_validated`, `processing` y posteriores => 22023 `invalid_status`; en `pending`/`rejected` sigue funcionando; la rama "validated solo baja" ya no existe; historial y audit siguen iguales; regresión de `financialAuditLog.test.js`.
- Unit: `commissionOverrideRules` (`canAdjustCommission` falso en proof_uploaded/validated), `remittanceService.adminOverride`, modal sin copy "solo bajar"; botón deshabilitado con texto en tarjeta/bandeja/tabla.
- Implementar M0 + front. Tamaño: ~60 líneas SQL, ~60 JS, ~120 tests.

### Etapa 1 - BD de aceptación (PR 2; tests en `src/tests/concurrency/commissionAcceptance.test.js`, DB local `papuenvios_test`)
Rojos primero:
- Subida en pending/rejected crea `pending` con base correcta + alerta; bajada crea `informed`; igual sin pendiente no crea nada; consecutivos (`superseded`, misma base; vuelta a <= base => `reverted`).
- `remittance_submit_proof` falla con `commission_pending_acceptance` si hay `pending`; funciona tras aceptar y con `informed`.
- `accept`: dueño ok; otro usuario/admin/deshabilitado 42501; `superseded` => `proposal_not_open`; remesa no pending/rejected => `invalid_transition`; idempotente; `proposal_stale`.
- `remittance_cancel` cierra `pending` como `cancelled` y descarta la alerta.
- **ND-5 (motivo):** con un motivo marcador, nada legible por el dueño por RLS (propuestas, `user_alerts` title/message/metadata, respuesta de `accept`) lo contiene.
- RLS/grants: el dueño ve solo lo suyo; sin INSERT/UPDATE/DELETE para `authenticated`; anon nada; PATCH directo falla; `accept` no dispara `guard_remittance_money_columns`/`guard_status_via_rpc`.
- **Concurrencia (conexiones reales):** (a) accept vs admin_set; (b) submit_proof vs admin_set (o queda congelado y admin_set => `invalid_status`, o submit falla; nunca `proof_uploaded` con `pending`); (c) cancel vs accept; (d) dos admin_set seguidos => un solo `pending`.
- Confirmar que `execute_platform_reset` limpia la tabla nueva (FK `ON DELETE CASCADE`; no encontré lista de tablas en sus migraciones).
Implementar M1-M3. ~250 líneas SQL, ~350 tests.

### Etapa 2 - Servicios (unit)
`commissionProposalService.js` (`getOpenProposals`, `acceptCommission` vía RPC, mapeo de errores a i18n); función pura `commissionDiff` con `moneyPure`; manejo de `commission_pending_acceptance` en el submit de comprobante de `remittanceService` (cambio mínimo); test "solo RPC, sin escritura directa". ~120 líneas + tests.

### Etapa 3 - UI cliente (PR 3)
`CommissionChangeNotice`, hook `useCommissionProposals`, inserciones de 1 línea en `MyRemittancesPage` y `UserPanel`; deshabilitar subida de comprobante con `pending`; claves ES/EN. Tests Testing Library: render por estado, 44 px, `role`, aceptar, cancelar (texto según estado), `proposal_not_open` refresca. ~250 líneas + ~150 tests.

### Etapa 4 - UI admin
`CommissionProposalBadge`, mensaje post-guardado en `CommissionOverrideModal`, botón opcional "Avisar por WhatsApp". ~150 líneas + tests.

### Etapa 5 - Opcionales
E2E Playwright (admin sube -> cliente acepta -> sube comprobante -> congelado); M4 Realtime de `user_alerts`; email por Edge Function; KPI "Esperando al cliente".

Tamaño total: ~800 líneas de producción, ~700 de tests, 3 PR pequeños (BD, cliente, admin) + el PR 0 de congelamiento.

## 6. Riesgos y qué NO cubre
Riesgos
1. M0 con front viejo: el botón visible en estados congelados devuelve `invalid_status` (inofensivo). Mitigación: desplegar el front de la etapa 0 pronto.
2. Conflicto con el otro escritor (botón "ajustar comisión" en tarjetas): debe usar `canAdjustCommission`; si ya mergeó con su propia lista de estados, ajustar en el PR 0.
3. Front viejo + M2: subir comprobante con propuesta pendiente muestra error genérico; las propuestas solo nacen con M3, así que aplicar M3 y el front cliente en la misma ventana.
4. `user_alerts` editable por el dueño (solo puntero).
5. Deriva repo/prod de migraciones: verificar `prosrc` antes de aplicar M0/M3.
6. Las remesas actuales en `proof_uploaded`/`validated` con override previo quedan congeladas sin propuesta (sin backfill).

NO cubre
- Email/WhatsApp automáticos (secretos, proveedor, teléfono de cliente no verificados).
- Reembolsos automáticos (siguen manuales, TermsPage §9).
- Topes o doble aprobación de ajustes (ND-7).
- Correcciones post-pago: ya no se pueden por esta vía (si hay error de comisión tras pagar, habría que cancelar/rechazar el comprobante para descongelar; decisión operativa, no del sistema).
- Re-tarificación por tasa del cliente (`recalculate...`), que no pasa por aceptación.
- Aceptación por el admin en nombre del cliente (prohibido a propósito).
