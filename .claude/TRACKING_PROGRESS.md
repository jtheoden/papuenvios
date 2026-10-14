# PapuEnvios — Tracking de Progreso

## Estado actual: Pre-lanzamiento público
**Readiness Score**: 52/100 | **Fecha activación equipo**: 2026-04-20

---

## ✅ Completado hoy (2026-04-20)
- [x] Limpieza de datos de prueba (remittances, orders, notifications, user_alerts, métricas, offer_usage, zelle stats)
- [x] Activación del equipo multi-agente
- [x] Auditoría completa del codebase

---

## 🔴 P0 — Bloqueadores (no lanzar sin esto)

- [ ] **SEC-01**: Revocar client secret de Google OAuth en GCloud Console + limpiar historial git — **NO re-verificado 2026-08-08, requiere chequeo separado** (ver auditoría Frente 3)
- [x] **SEC-02**: ✅ **Ya resuelto, verificado 2026-08-08** — cifrado bancario migrado a Edge Function `bank-account-crypto` (server-side, sin fallback inseguro). `src/lib/encryption.js` ya no existe.
- [ ] **LEGAL-01**: Consulta legal OFAC/MSB para operación de remesas Cuba-USA
- [ ] **LEGAL-02**: Implementar páginas `/privacy` y `/terms` con contenido legal real
- [ ] **TEST-01**: Premisa parcialmente desactualizada — ya no es "cero tests" (64 tests unitarios en verde tras esta sesión), pero sigue faltando E2E de flujo completo. Ver auditoría Frente 3.

## 🟡 P1 — Alta prioridad (completar antes de lanzamiento)

- [x] **SEC-03**: Corregido 2026-08-08 — `verifyAdminRole()` (leía `user_metadata.role`, 0 call sites) era código muerto, no explotable (el gate real ya era la RLS `zelle_accounts_manage` vía `is_admin_user()`). Eliminado.
- [x] **SEC-04**: Corregido y **desplegado 2026-08-08**. CORS allowlist real (`supabase/functions/_shared/cors.ts`) reemplaza el wildcard `'*'`/reflected-origin en las funciones. Verificado con requests HTTP reales contra el endpoint de producción (origen permitido recibe `Access-Control-Allow-Origin`, origen malicioso no recibe ninguno, sin `Allow-Credentials` en ningún caso). Alcance real del deploy, distinto al asumido inicialmente:
  - `notification-settings`: **ya estaba viva** en producción (v6, `verify_jwt:true`) — redeploy del fix, ahora v7.
  - `notify-zelle-deactivation`: **nunca había sido desplegada** — ver OPS-04 abajo, era un bug de producción preexistente no relacionado con CORS. Desplegada por primera vez (v1, `verify_jwt:true`) tras confirmación explícita del usuario.
  - `notify-order`: **código muerto** — `CartPage.jsx:799` confirma que su invocación fue reemplazada por `notifyAdminNewPayment` (lógica client-side de WhatsApp). Nunca estuvo en producción y no se desplegó (sin caller, YAGNI).
- [x] **OPS-04** (hallazgo nuevo, 2026-08-08): `sendZelleDeactivationEmails()` en `zelleService.js:1569` invocaba `notify-zelle-deactivation` desde hace tiempo, pero la función **nunca existió en el proyecto Supabase remoto** (`list_edge_functions` solo devolvía `notification-settings` y `bank-account-crypto`) — el `invoke` fallaba silenciosamente en cada desactivación de cuenta Zelle (capturado por `try/catch` + `console.error`, no rompía el flujo porque las alertas en `user_alerts` ya son el canal principal). **Corregido**: función desplegada (ver SEC-04 arriba). **Pendiente de confirmar operativamente**: si el secret `RESEND_API_KEY` está configurado en el proyecto — no hay herramienta MCP para listar secrets; la función maneja su ausencia sin crashear (`200, success:false`) pero el email no se enviará hasta confirmarlo. Verificar en Supabase Dashboard → Edge Functions → Secrets, o esperar al próximo `get_logs` tras una desactivación real.
- [x] **PERF-01**: ✅ Corregido 2026-08-09 — `React.lazy()` + `Suspense` en `App.jsx` para las 4 áreas admin-only: `AdminPage` (incluye `VendorPage` anidado), `UserManagement`, `DashboardPage`, `SettingsPage`. Ninguna es parte del golden path público (home/productos/carrito/remesas siguen eager). Bundle principal: 1,609.43 KB → 1,152.06 KB (-28%, gzip 412.70 KB → 323.59 KB), repartido en 4 chunks separados que solo cargan si un admin navega ahí. Fallback liviano (`RouteLoadingFallback`, spinner) en vez de reusar el splash `LoadingScreen` de carga inicial — evitar pantalla completa en cada cambio de tab admin. Verificado: build limpio, 67/67 tests en verde, y las 4 rutas cargan su chunk y renderizan el gate de auth correctamente en el navegador real (sin sesión admin de prueba disponible, no se pudo verificar el contenido interno post-login). Sigue sin llegar al objetivo de <800KB — requeriría dividir tambien dependencias pesadas compartidas (framer-motion, etc.), fuera del alcance literal de este ítem.
- [ ] **OPS-01**: Integrar Sentry para monitoring de errores en producción
- [ ] **DATA-01**: RPCs PostgreSQL para transacciones atómicas (validate_order_payment, create_remittance, apply_offer)
- [x] **DATA-02**: ✅ Corregido y aplicado 2026-08-09 — `inventory.available_quantity` recreada como `GENERATED ALWAYS AS (quantity - reserved_quantity) STORED` (vivía como `DEFAULT`, que no se recalcula en `UPDATE`; coincide con el diseño original de `20241001000000_complete_schema.sql`, que en algún punto se perdió en la BD remota). Verificado sin ningún código de la app escribiendo esa columna directamente. Índice `idx_inventory_low_stock` recreado. Migración: `20260809000001_data02_data04_backlog_fixes.sql`.
- [ ] **OPS-02**: Configurar alertas en Supabase Dashboard y Vercel

## 🟠 P2 — Importante (puede lanzar, pero resolver pronto)

- [ ] **SEC-05**: Customizar rate limiting en Supabase Auth + hCaptcha en registro
- [ ] **DATA-03**: pg_cron job para reset automático de límites Zelle
- [x] **SEC-06**: ✅ **Ya resuelto, verificado 2026-08-08** — la vista `order_analytics` tiene `security_invoker=true` (confirmado en `pg_class.reloptions`), respeta la RLS de `orders` (`user_id = auth.uid() OR is_admin_user()`). Un usuario normal no puede ver emails de otros clientes.
- [ ] **OPS-03**: Escribir runbook de incidentes
- [x] **DATA-04**: ✅ Corregido y aplicado 2026-08-09 — `orders.estimated_delivery_date` (de `MIGRATIONS_PHASE_2.sql`, sin uso alguno en código, 0 filas non-null) eliminada. `estimated_delivery` (la columna real en uso, `whatsappService.js`) intacta. Migración: `20260809000001_data02_data04_backlog_fixes.sql`.
- [x] **SEC-07**: ✅ Corregido y aplicado 2026-08-09 — trigger `BEFORE INSERT` en `activity_logs` que redacta patrones de email dentro de `metadata` (recursivo, verificado en objetos/arrays anidados) y `description`; `performed_by` queda intacto a propósito (identidad de auditoría). TTL de 90 días vía `pg_cron` (job `purge-old-activity-logs`, diario 3am), extensión antes no instalada. Migraciones: `20260809000002_sec07_activity_logs_pii_ttl.sql` + `20260809000003_fix_sec07_search_path.sql` (fix de `function_search_path_mutable` detectado por `get_advisors` tras el primer apply). Verificado con insert real: email en `metadata.error` y en `description` quedan `[REDACTED_EMAIL]`, `performed_by` sin tocar. Alcance: solo se encontró el patrón email en los ~40 call sites de `logActivity()` revisados (IDs/montos/mensajes de error) — no hay teléfono/dirección/tarjeta viajando en `metadata` hoy.
- [x] **UX-01**: ✅ Corregido 2026-08-09 — `InfoTooltip` nuevo (`src/components/ui/InfoTooltip.jsx`, Radix Tooltip, mismo patrón ya usado en `user-avatar.jsx`), accesible por teclado (abre en focus, no solo hover). Agregado en "Tasa de cambio" y "Comisión" en `SendRemittancePage.jsx` (preview en vivo del paso 1 y resumen del paso 2). TDD: `src/tests/unit/InfoTooltip.test.jsx` (3 tests). Gotcha nuevo documentado: jsdom no implementa `ResizeObserver` (lo usa Radix Popper) — se agregó un stub mínimo en `src/tests/setup.js`. Verificado visualmente con Playwright contra el dev server real: ambos tooltips abren on-focus con el texto correcto. 67/67 tests en verde, build OK.

## 🟢 P3 — Mejoras (post-lanzamiento)

- [ ] CSP y headers de seguridad en vercel.json
- [ ] Limpiar archivos .md de seguridad históricos del repo
- [ ] Soft-delete usuarios + proceso CCPA
- [ ] Accesibilidad WCAG 2.1 AA (focus trap, aria-live, contraste)
- [ ] Optimización de imágenes en Supabase Storage
- [ ] Onboarding / wizard para nuevos usuarios

---

## Métricas objetivo post-lanzamiento
- Tasa de conversión: > 3%
- Carga de página: < 2s
- Error rate: < 0.1%
- Bundle JS inicial: < 800KB (actualmente 1.5MB)

---

## 🆕 Plan estratégico 2026-08-07 — Bulk-delete, reset de plataforma, auditoría

Plan completo: `.claude/docs/plan_admin-bulk-ops-reset-audit.md` (generado con `/strategic-plan-workflow`, validado con crítica adversarial + cross-check independiente).

- [x] **SEC-08**: Purgado `PGPASSWORD` de la historia con `git filter-repo --replace-text` + `push --force-with-lease` a `origin/main` — completado 2026-08-08. Verificado: 0 ocurrencias de ambos passwords en `git log --all -p`, redacción presente donde correspondía. Solo `main` contenía los commits afectados (de 54 ramas remotas, ninguna otra los incluía — no fue necesario tocarlas).
- [x] **ADMIN-01**: Selección múltiple + borrado masivo de productos y categorías — implementado y **aplicado a Supabase remoto 2026-08-08** (confirmado por el usuario). Verificado: `bulk_delete_products`/`bulk_delete_categories` existen como `SECURITY DEFINER`, policies de `product_categories` correctas (`DELETE` → `is_super_admin()`), `get_advisors(security)` sin hallazgos nuevos fuera del patrón ya existente en todo el proyecto (RPCs `SECURITY DEFINER` listadas como "ejecutables por anon/authenticated" — la protección real es el chequeo de rol interno, igual que el resto de las funciones):
  - `supabase/migrations/20260808000001_bulk_delete_products_categories.sql`: `bulk_delete_products`/`bulk_delete_categories` (`SECURITY DEFINER`, exclusivo `super_admin`, `pg_advisory_xact_lock` por tipo de entidad, reporte parcial por ítem `deleted`/`blocked`/`block_reason`). Incluye el fix de RLS de Fase 0 (`categories_all_admin` → DELETE ahora requiere `is_super_admin()`, no `is_admin_user()`).
  - `src/lib/bulkDeleteService.js` — capa JS, TDD (tests en rojo antes de implementar).
  - `src/components/tables/ResponsiveTableWrapper.jsx` — soporte de selección genérico y reusable (checkbox por fila + "seleccionar todo" de la página actual), en las 3 vistas responsive.
  - `src/components/tables/BulkDeleteBar.jsx` — barra flotante + modal de confirmación (requiere escribir "ELIMINAR").
  - Conectado en `VendorInventoryTab.jsx` (productos) y `VendorCategoriesTab.jsx` (categorías, checkbox en su layout de tarjetas propio), ambos gateados a `isSuperAdmin` — completado 2026-08-08.
  - Ofertas/combos: fuera de esta iteración, sigue condicional a confirmar volumen (NEEDS-DISCUSSION del plan).
  - Sin `p_idempotency_token` en esta primera versión — evaluado y descartado explícitamente (ver plan doc) para no sobre-ingenierizar el primer pase.
  - Tests: 59/59 verdes, incluye un test de componente nuevo (`ResponsiveTableWrapper.selection.test.jsx`, primer test de UI en este proyecto — hasta ahora solo había tests de funciones puras). Gotcha documentado en el test: jsdom no aplica CSS real, las 3 vistas responsive (mobile/tablet/desktop) coexisten en el DOM simultáneamente, hay que scopear queries con `within(table)`.
- [x] **ADMIN-02**: Mecanismo de reset a estado inicial — implementado 2026-08-08, **migración NO aplicada a Supabase, el flag NUNCA debe activarse sin decisión explícita del usuario**:
  - `supabase/migrations/20260808000002_platform_reset.sql`: tabla `platform_reset_control` (sin GRANT de escritura a ningún rol de app), `admin_destructive_ops_log` compartido con Frente 1, RPC `execute_platform_reset(p_confirmation)` (`SECURITY DEFINER`, lock exclusivo **antes** de leer el flag, borra 17 tablas en orden verificado contra FKs reales, resetea contadores de `zelle_accounts`, deshabilita usuarios no-superadmin — Opción A confirmada, no borra `auth.users`), auto-desarme al terminar.
  - **Desviación del plan original, mejor solución encontrada**: el plan asumía RPCs de checkout existentes para agregar el lock compartido — no existen, `orderService.js`/`remittanceService.js` insertan directo desde el cliente. Se implementó en su lugar un trigger `BEFORE INSERT` en `orders`/`remittances` que toma el lock compartido — cubre cualquier vía de inserción sin tocar código de aplicación.
  - **Exclusiones deliberadas** (no pedidas explícitamente, protegidas por la misma lógica que products/categories): `activity_logs` (es el rastro de auditoría de todo lo hecho durante pruebas, incluidos los propios bulk-delete — borrarlo contradice que `admin_destructive_ops_log` nunca se limpia) y `admin_messages` (correspondencia, no métrica).
  - **⚠️ `inventory` se borra completo** — los 38 productos del catálogo quedan en stock 0 tras el reset. Requiere recarga manual; `available_quantity` sigue siendo `DEFAULT` calculado (DATA-02 abierto) — probar el flujo antes de confiar en él.
  - UI: pestaña "Sistema" en Configuración, visible solo para `super_admin` (`SettingsSystemTab.jsx`), botón deshabilitado hasta que el flag esté activo en BD, confirmación exige escribir "RESETEAR".
  - Runbook operativo: `.claude/docs/runbook_platform_reset.md` (backup/PITR previo, cómo activar el flag, qué hacer después).
  - Tests TDD: `src/tests/unit/platformResetService.test.js`, 64/64 tests totales en verde.
- [x] **DATA-05** (nuevo) — resuelto de forma distinta a la prevista: no existen RPCs de checkout/pago (orderService.js/remittanceService.js insertan directo). Se implementó como trigger `BEFORE INSERT` en `orders`/`remittances` (`guard_platform_reset_lock()`, en `20260808000002_platform_reset.sql`) — cubre cualquier vía de inserción sin depender de que exista un RPC.
- [x] Fase 0 del plan — **completada 2026-08-07, ambos hallazgos CONFIRMADOS con evidencia** (ver `.claude/docs/plan_admin-bulk-ops-reset-audit.md`)

### ✅ SEC-09 (CRÍTICO — dinero real, independiente de Frentes 1/2) — implementado 2026-08-07, pendiente de aplicar a Supabase remoto

`select_available_zelle_account` (SELECT sin `FOR UPDATE`) + `update_zelle_account_usage` (RPC separado, invocado después en el flujo) tenían una ventana TOCTOU real: dos órdenes/remesas concurrentes podían pasar el chequeo de límite y reservar la misma cuenta Zelle, superando `daily_limit`/`security_limit`. **Corrige la conclusión de la auditoría previa (2026-04-20, §5.3), que calificaba este patrón como "✅ evita race conditions" — esa conclusión queda superada.**

**Implementado** (rama `feat/admin-bulk-ops-reset-audit`, TDD — tests en rojo antes, 51/51 verdes ahora, build OK):
- `supabase/migrations/20260807000001_atomic_zelle_account_reservation.sql`: RPC `reserve_zelle_account` — selección + reserva atómica con `FOR UPDATE SKIP LOCKED` (no bloquea checkouts concurrentes entre sí, favorece redes de alto tráfico). **Aplicada a Supabase remoto 2026-08-07** (`apply_migration`, confirmado por el usuario) — verificada con `pg_proc` (`SECURITY INVOKER`, `SKIP LOCKED` presente) y `get_advisors(security)` sin hallazgos nuevos.
- `src/lib/zelleService.js`: `getAvailableZelleAccount` → `reserveZelleAccount`, usa el nuevo RPC; `registerZelleTransaction` ya no llama a `update_zelle_account_usage` (evita doble conteo).
- `src/tests/unit/zelleService.test.js`: cobertura de la capa JS (llamada única al RPC atómico, no a los dos viejos). **La atomicidad en sí la garantiza el lock de Postgres, no hay harness de concurrencia real en este proyecto (vitest+jsdom) — no se reclama cobertura de concurrencia que no existe.**

**Dos bugs adicionales encontrados y corregidos en el mismo cambio** (no eran parte del hallazgo original, se descubrieron auditando estos call sites):
1. `CartPage.jsx:678` llamaba con `transactionType='order'`, valor inválido (el enum solo acepta `remittance`/`product`/`combo`) — la asignación automática de cuenta Zelle para **órdenes de producto fallaba siempre**, silenciosamente, dejando `zelle_account_id = null`.
2. Ambos call sites (`CartPage.jsx`, `remittanceService.js:885`) leían `zelleResult.success`/`zelleResult.account`, pero la función siempre devolvió el registro de cuenta directamente o lanzó una excepción — ese shape nunca existió. En remesas esto hacía fallar la creación cuando no se pasaba `zelle_account_id` explícito; en órdenes fallaba en silencio.

**Resuelto con la lógica dada por el usuario 2026-08-07**: alcance de bulk-delete (ofertas/combos SÍ, resto según Frente 1) y qué limpia el reset (orders, remittances, recipient_bank_accounts/remittance_bank_transfers, ofertas, combos, inventario, stats de cuentas Zelle, todos los usuarios no-superadmin; `publications` queda fuera por ser contenido editorial, no operacional).

**Decidido por el usuario 2026-08-07**:
- SEC-09 (bug de concurrencia Zelle) se implementa **primero**, antes que Frentes 1/2.
- Borrado de usuarios de prueba: **Opción A** — `is_enabled=false` en `user_profiles` + purga de actividad transaccional, sin tocar `auth.users`.
- Reset también limpia métricas/estadísticas de actividad de prueba: `order_status_history`, `zelle_payment_stats`, `site_visits`, `user_category_history` (no `user_categories`/`category_rules`/`category_discounts` — esas son configuración, no datos generados por uso).

**Pendiente**: confirmar PITR activo en Supabase Dashboard → Database → Backups.

### 🆕 Auditoría Frente 3 completada 2026-08-08

Documento completo: `.claude/docs/audit-frente3-2026-08-08.md`. Re-verificó con evidencia directa (no solo carried-forward) los hallazgos de seguridad de 2026-04-20 que seguían "abiertos": **SEC-02 y SEC-06 resultaron ya resueltos** (sin atribuirse a esta sesión), **SEC-03 y SEC-04 corregidos** en esta sesión (código listo, SEC-04 pendiente de `supabase functions deploy`), race conditions de Frentes 1/2 auditadas y confirmadas mitigadas. Deja explícito qué NO se re-verificó (SEC-01, SEC-05, LEGAL, OPS, DATA-01/03/04, UX-01) para no blanquear nada por omisión.


### 🆕 SEC-10 / SEC-11 — logging de actividad muerto desde SEC-07 y remesas reescribibles por su propietario (2026-10-02)

Rama `fix/activity-logs-zelle-remittance-guard`. **Migraciones NO aplicadas a remoto — requieren confirmación explícita.** Sin commit ni push.

**Hallazgo 1 (SEC-10) — el logging de actividad desde el cliente no funciona desde SEC-07.** `activity_logs_redact_pii()` (trigger `BEFORE INSERT` de `activity_logs`) es `SECURITY INVOKER` y llama a `redact_pii_jsonb(jsonb)`, cuyo ACL quedó en `{postgres=X/postgres}`. Todo INSERT del rol `authenticated` falla con `42501`; las últimas filas originadas en cliente son de 2026-08-07. Efecto colateral: `validatePayment`/`rejectPayment` de remesas solo sincronizaban `zelle_transaction_history` si el log devolvía `status === 'inserted'` (acoplamiento introducido en el commit `a5750a21`), por lo que el estado Zelle no se sincronizaba nunca.
- `supabase/migrations/20261002000001_fix_activity_logs_redact_pii_definer.sql`: `ALTER FUNCTION ... SECURITY DEFINER` + `SET search_path = public`, sin ampliar el ACL de `redact_pii_jsonb`; incluye una comprobación que aborta la migración si el owner no puede ejecutar el helper.
- `src/lib/remittanceService.js`: la sincronización Zelle en `validatePayment`/`rejectPayment` depende solo de `zelle_account_id` (mismo patrón que ya usaba `orderService.js`). `upsertZelleTransactionStatus` solo actualiza/crea la fila de historial, no toca contadores de uso: desacoplar no produce doble conteo.
- Corrección adicional en las mismas líneas: el monto enviado al historial Zelle era `remittance.amount || remittance.amount_to_deliver` (`amount` no existe como columna, por lo que se sobrescribía el monto en USD con el monto a entregar en moneda destino). Ahora se envía `amount_sent`, igual que en `createRemittance`.

**Hallazgo 2 (SEC-11) — el propietario puede reescribir su propia remesa.** La policy `"users can update own remittances"` no restringe estado ni columnas: un cliente autenticado podía poner `status='completed'`, `payment_validated=true` o cambiar montos vía PostgREST. Sin evidencia de abuso en el historial de producción.
- `supabase/migrations/20261002000002_guard_remittance_owner_update.sql`: trigger `BEFORE UPDATE` `guard_remittance_owner_update`. Omite el control si `auth.uid() IS NULL` (service role) o si el usuario es admin/super_admin. Para el propietario solo permite: (1) subida de comprobante `payment_pending|payment_rejected → payment_proof_uploaded`; (2) cancelación `payment_pending|payment_rejected → cancelled`; (3) recálculo de tasa en `payment_pending|payment_rejected` sin cambio de estado. Cada transición tiene lista cerrada de columnas; el resto falla con `42501`. Policies y GRANTs sin cambios.
- Riesgo residual documentado: en la transición (3) los montos los calcula el cliente (igual que en el INSERT); el guard cierra la ventana a partir de la subida del comprobante. Mover el cálculo a un RPC queda como endurecimiento posterior.
- Comportamiento que cambia: `cancelRemittance` (servicio) aceptaba cancelar desde `payment_proof_uploaded`/`payment_validated`/`processing`; la UI solo ofrece cancelar en `payment_pending`. Tras el guard, la cancelación por el propietario desde esos estados posteriores queda bloqueada en BD.
- Código muerto detectado (no modificado): el botón "subir evidencia de entrega" de `MyRemittancesPage.jsx` llama a `confirmDelivery`, que exige estado `processing` mientras el botón solo aparece en `delivered`; ya fallaba antes del guard.

**Verificación**: TDD (rojo 19 fallos → verde). `npx vitest run`: 10 archivos, 96/96 tests (base previa: 73). Build de prueba OK (fuera de `dist`). Tests nuevos: `src/tests/unit/remittancePaymentZelleSync.test.js`, `src/tests/unit/securityMigrations.test.js` (estático sobre los `.sql`). Los `.sql` no se ejecutaron contra ninguna base de datos.

**Pendiente**: aplicar ambas migraciones a remoto (con confirmación) y ejecutar `.claude/docs/runbook_remittance-owner-guard.md` (verificación en `BEGIN … ROLLBACK` + rollback). Confirmar en remoto si `audit_remittance_status` es `BEFORE` o `AFTER UPDATE` (su definición no está en el repositorio).

**Ampliación tras revisión independiente (2026-10-02, misma rama, migraciones siguen SIN aplicar)**:
- El guard pasa a `BEFORE INSERT OR UPDATE`: la policy de INSERT solo comprobaba `user_id`, por lo que un propietario podía crear una remesa ya validada o entregada. En INSERT de un no-admin se exige `status = 'payment_pending'`, `payment_validated` no verdadero y `NULL` en las columnas de validación, rechazo, procesamiento, entrega, finalización y cancelación. `createRemittance` no envía ninguna de esas columnas (verificado en `remittanceService.js`, objeto `insertData`).
- `cancelRemittance` alineado con el guard y con su propio docstring: solo desde `payment_pending` / `payment_rejected`. Su único llamador es `MyRemittancesPage.jsx` (propietario); no existe flujo de cancelación para administradores a través de esta función.
- `activity_logs_redact_pii()` usa `search_path = public, pg_temp`.
- Test anti-deriva: compara las listas de columnas del guard (parseadas del `.sql`) con las claves de los `.update({...})` de `uploadPaymentProof`, `cancelRemittance` y `recalculateRemittanceAtCurrentRate`, y verifica que `createRemittance` no envía columnas vetadas en INSERT.
- **Riesgo residual declarado**: montos y tasa siguen calculándose en el cliente en el INSERT y en el recálculo; cerrarlo requiere cálculo en servidor.
- `npx vitest run`: 11 archivos, 126/126 tests. Build de prueba OK.

### 🆕 UX/NOTIF — WhatsApp guiado al admin tras comprobante (2026-09-30)

- [x] **UX/NOTIF** — WhatsApp guiado al admin tras comprobante (cart + remesa): botón explícito en `ConfirmationModal` con número configurado; eliminado doble `window.open` en `SendRemittancePage`.
  - Causa raíz: `notifyAdminNewPayment`/`notifyAdminNewPaymentProof` llamaban `window.open` tras varios `await` (fuera del gesto de usuario) → popup bloqueado silenciosamente, sobre todo en móvil; el admin nunca recibía el mensaje. En remesas además se abría dos veces (servicio + página).
  - `src/lib/whatsappService.js`: builders puros `buildAdminNewPaymentMessage`/`buildAdminNewPaymentWhatsAppUrl` (orden) y `buildAdminNewPaymentProofMessage`/`buildAdminNewPaymentProofWhatsAppUrl` (remesa, conserva signed URL). Los `notify*` siguen exportados y delegan en los builders (compat).
  - `src/components/ui/ConfirmationModal.jsx`: props `whatsappUrl`/`whatsappNumber`/`whatsappLoading`; enlace `<a target="_blank">` verde WhatsApp arriba de "Ver Mis Pedidos/Remesas", paso nuevo al inicio de "¿Qué sigue?", estados cargando / no configurado.
  - `CartPage.jsx`: URL calculada en `postCreationTasks` y volcada al estado del modal (`whatsappLoading: true` → `false` siempre). `SendRemittancePage.jsx`: sin la segunda llamada a `notifyAdminNewPaymentProof`; URL guiada pasada al modal.
  - Tests TDD nuevos: `src/tests/unit/whatsappService.test.js` (6) y `src/tests/unit/ConfirmationModal.test.jsx` (5) — 84/84 verdes, build OK. No hay config de ESLint en el repo (solo devDependency), lint no ejecutable.
  - Seguimiento 2026-10-01 (remesa sin comprobante, caso REM-2026-001101): "subir después" en `SendRemittancePage.jsx` ya no navega directo; abre `ConfirmationModal` con `proofPending` (título "¡Remesa Registrada!", botón "Avisar al administrador por WhatsApp") usando el nuevo builder síncrono `buildAdminNewRemittanceMessage`/`buildAdminNewRemittanceWhatsAppUrl` (mensaje "Comprobante de pago: PENDIENTE"). La subida posterior desde `MyRemittancesPage.jsx` (`handleSubmitProof`) muestra el mismo modal guiado con `buildAdminNewPaymentProofWhatsAppUrl`. Tests ampliados en `whatsappService.test.js` y `ConfirmationModal.test.jsx`. Sin cambios en servicios, Edge Functions ni BD.
  - Correcciones de revisión 2026-10-01: el destinatario del paso guiado se resuelve desde configuración fresca con `getGuidedWhatsappPhone`/`getFreshGuidedWhatsappPhone` (`notificationSettingsService.js`; si el destino activo es un grupo se usa el teléfono del administrador) en `CartPage.jsx`, `SendRemittancePage.jsx` y `MyRemittancesPage.jsx`; eliminados los auto-open heredados (`notifyAdminNewPayment` en `CartPage.jsx` y `notifyAdminNewPaymentProof` en `remittanceService.uploadPaymentProof`) para evitar mensajes duplicados; `buildAdminNewRemittanceMessage` muestra `N/A` cuando falta el monto (0 es válido) y en el id del enlace; `SendRemittancePage.jsx` conserva `amount_to_deliver` de la BD y el total del modal nunca es `NaN`; `ConfirmationModal.jsx` sube a `z-[60]` y en `proofPending` indica "Procesaremos tu remesa cuando validemos el pago". Tests: nuevo `notificationSettingsService.test.js` y ampliados los existentes — 111/111 verdes, build OK.
  - Endurecimiento 2026-10-02 (sin commit, sin cambios en BD ni Edge Functions): (B1) el mensaje de comprobante se construye con la fila que devuelve `uploadPaymentProof` mediante el helper puro `buildRemittanceNotificationPayload(remittanceRow, user)` en `SendRemittancePage.jsx` y `MyRemittancesPage.jsx`, en lugar del estado del asistente. (B3a) `ConfirmationModal.jsx`: con `whatsappUrl` el enlace de WhatsApp es la acción principal y "Ver Mis Pedidos/Remesas" pasa a estilo secundario; el primer intento de salir (X, fondo, "Cerrar" o "Ver Mis…") sin haber pulsado el enlace muestra un aviso `role="alert"` y el segundo intento cierra; sin `whatsappUrl` se cierra como antes. (B3b) Reenvío persistente en `MyRemittancesPage.jsx`: acción "Notificar al administrador por WhatsApp" (`remittances.user.notifyAdminWhatsapp` en ES/EN) en la tarjeta de cada remesa en `payment_pending` o `payment_proof_uploaded`, apoyada en `openAdminNotification` (`whatsappService.js`), que abre la pestaña de forma síncrona dentro del clic y la navega tras resolver teléfono y URL; si no hay teléfono se cierra la pestaña y se muestra `cart.payment.whatsappNotConfigured`; si el navegador bloquea la ventana se ofrece el mismo enlace en el `ConfirmationModal`. (B3c) Los mensajes al administrador en remesas se generan siempre en español (`ADMIN_NOTIFICATION_LANGUAGE`); el pedido en `CartPage.jsx` no cambia. (B4) Eliminados `notifyAdminNewPayment`, `notifyAdminNewPaymentProof` y `getFreshWhatsappRecipient` (sin llamadores). Tests: 129/129 verdes, build OK. Pendiente de decisión de producto: formato/longitud del mensaje y enlace firmado del comprobante.
    - Correcciones de revisión 2026-10-02: el aviso de salida del `ConfirmationModal` también aplica mientras `whatsappLoading` y un clic central (`onAuxClick`) cuenta como enlace abierto; nueva `variant="resend"` (sin lista de pasos ni aviso de salida) para el reenvío con ventana bloqueada; `openAdminNotification` nunca rechaza: límite de espera `ADMIN_NOTIFICATION_TIMEOUT_MS` (10000 ms), `{ error: true }` ante fallo/tiempo agotado/navegación fallida y `blocked` si la pestaña se cerró durante la espera; `getAdminNotificationUrlBuilder(remittance)` decide builder y visibilidad del botón; `MyRemittancesPage.jsx` evita reentradas con `notifyingId` y distingue error (`remittances.user.notifyAdminError`, ES/EN) de "no configurado"; `buildAdminNewPaymentProofMessage` tolera montos numéricos como texto (`N/A` si falta); `TooltipButton.jsx` usa `type="button"` por defecto y reenvía `aria-label`. Tests: 150/150 verdes (nuevo `TooltipButton.test.jsx`), build OK.
