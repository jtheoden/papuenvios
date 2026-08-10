# Auditoría Frente 3 — Seguridad/Performance/Race-Conditions/Redes

**Fecha**: 2026-08-08 | Parte del plan `.claude/docs/plan_admin-bulk-ops-reset-audit.md`. Re-verifica con evidencia directa (SQL/código real) los hallazgos de `.claude/docs/audit-report-2026-04-20.md` que seguían marcados como abiertos, y audita race conditions específicas de los Frentes 1/2 recién implementados.

**Metodología**: cada fila indica si fue **re-verificado** (evidencia consultada en esta sesión — cita concreta) o **carried-forward sin re-chequear** (se asume el estado de la auditoría previa, no confirmado hoy). No se blanquea ningún hallazgo sin evidencia.

---

## Hallazgos re-verificados con evidencia — estado actualizado

| Hallazgo | Estado 2026-04-20 | Estado real 2026-08-08 | Evidencia |
|---|---|---|---|
| **SEC-02**: clave de cifrado bancario hardcodeada client-side | 🔴 Crítico | ✅ **RESUELTO** | `src/lib/encryption.js` ya no existe. `recipientService.js` llama a la Edge Function `bank-account-crypto` (server-side), que usa `Deno.env.get('BANK_ENCRYPTION_KEY') ?? ''` — sin fallback inseguro hardcodeado. |
| **SEC-03**: autorización dual (`user_metadata` vs `user_profiles.role`) en zelleService.js | 🔴 Alto | 🟡 **Inexacto tal como estaba escrito — corregido esta sesión** | La función `verifyAdminRole()` que leía `user_metadata.role` tenía **0 call sites** en todo el repo (código muerto, nunca exportada). El gate real de `zelle_accounts` siempre fue la RLS policy `zelle_accounts_manage` (`is_admin_user()`, respaldada por `user_profiles.role` — correcta). No era explotable hoy, pero era una trampa para el futuro. **Se eliminó la función muerta** en esta sesión (`src/lib/zelleService.js`). |
| **SEC-04**: CORS wildcard en `notify-order`/`notify-zelle-deactivation` | 🟡 Medio | ✅ **CORREGIDO esta sesión, no desplegado** | Se creó `supabase/functions/_shared/cors.ts` con allowlist explícito (dominio de producción + `.vercel.app` + `localhost` en dev), reemplazando el `'*'` en ambas funciones. Además se corrigió `notification-settings/index.ts`, que ya tenía un `buildCorsHeaders` local pero con un anti-patrón peor: reflejaba el header `Origin` sin validarlo y agregaba `Access-Control-Allow-Credentials: true` — la combinación exacta que la protección del navegador contra wildcard+credentials existe para evitar. Se verificó que ninguna función usa `credentials` (auth es PKCE + localStorage, no cookies), así que se quitó ese header por completo. **No se desplegó** (`supabase functions deploy` no se ejecutó — requiere confirmación explícita, misma categoría que `apply_migration`). |
| **SEC-06**: `order_analytics` expone emails a todo `authenticated` | 🟡 Alto | ✅ **RESUELTO (ya estaba resuelto, no atribuible a esta sesión)** | La vista tiene `reloptions: ["security_invoker=true"]` — respeta la RLS de `orders` (`orders_select`: `user_id = auth.uid() OR is_admin_user()`). Un usuario normal solo ve sus propias filas (y por tanto su propio email), no los de otros. |
| **SEC-09**: race condition en rotación de cuentas Zelle | 🔴 Crítico (no estaba en la auditoría previa) | ✅ **RESUELTO** | Ver sesiones previas — `reserve_zelle_account` atómico, aplicado a Supabase. |

## Hallazgos re-verificados, siguen vigentes

| Hallazgo | Severidad | Evidencia de vigencia | Acción propuesta | Esfuerzo |
|---|---|---|---|---|
| **SEC-01**: secret OAuth de Google en historial de git | Alto | No re-verificado el archivo específico esta sesión (era un `client_secret_*.json` distinto del `PGPASSWORD` ya purgado) — **requiere verificación separada** antes de cerrarlo | Confirmar si el archivo sigue en la historia con `git log --all --full-history -- '*client_secret*'`; si sigue, purgar con `git filter-repo` (mismo procedimiento que SEC-08) tras confirmar revocación en GCloud Console | M |
| **SEC-07**: PII en `activity_logs` sin redacción/TTL | Medio | Confirmado: schema de `activity_logs` no tiene columna de expiración ni mecanismo de TTL; `metadata` es `jsonb` libre sin redacción a nivel de trigger o aplicación | Definir política de retención (ej. `pg_cron` que borre filas > 90 días) y revisar qué campos de `metadata` deberían redactarse antes de loguearse | M |
| **PERF-01**: bundle JS sin code splitting | Medio, crítico para público 3G | Confirmado en esta sesión: build actual pesa **1,607.87 KB** (`dist/assets/index-*.js`), sin lazy-loading de rutas admin | Lazy-load `AdminPage`/`VendorPage`/`UserManagement` con `React.lazy()` — refactor de tamaño medio-grande, requiere prueba manual de que no rompe el bundle de rutas admin (no autónomo en esta sesión, ver razón abajo) | M-L |
| **DATA-01**: sin transacciones atómicas en validar pago / crear remesa / aplicar oferta | Alto | No re-verificado línea por línea esta sesión, pero se confirmó indirectamente al diseñar Frente 2: `orderService.js`/`remittanceService.js` insertan directo desde el cliente sin RPC wrapper — consistente con el hallazgo original | Diseñar RPCs `SECURITY DEFINER` para estos 3 flujos — rewrite del camino de dinero, requiere harness de concurrencia para verificar, no autónomo | L |
| **DATA-02**: `available_quantity` es `DEFAULT` calculado, no `GENERATED ALWAYS AS` | Alto (overselling) | No re-verificado el DDL exacto esta sesión, pero es relevante de nuevo: el reset de plataforma (Frente 2) vacía `inventory` completo, dejando el catálogo en stock 0 — este hallazgo se vuelve más importante para probar el flujo de recarga post-reset | Migrar a columna generada o trigger `BEFORE UPDATE` que la recalcule siempre | M |

## Hallazgos NO re-verificados esta sesión (carried-forward de 2026-04-20, sin evidencia nueva)

Se listan explícitamente para no blanquearlos por omisión: **SEC-05** (rate limiting/hCaptcha), **LEGAL-01/02**, **TEST-01** (cero tests automatizados — parcialmente desactualizado, ver nota abajo), **OPS-01/02/03**, **DATA-03/04**, **UX-01**, ítems P3.

*Nota sobre TEST-01*: la auditoría original decía "cero tests automatizados en toda la base de código" — esto ya no es exacto. Esta sesión agregó 5 archivos de test (`zelleService.test.js`, `bulkDeleteService.test.js`, `ResponsiveTableWrapper.selection.test.jsx`, `platformResetService.test.js`, más los 2 preexistentes de cálculo), 64 tests en verde. Sigue siendo una cobertura mínima (nada de E2E de flujo completo, nada de los servicios de órdenes/remesas/productos existentes) — el hallazgo P0 sigue siendo válido en espíritu, pero la premisa literal ("cero tests") ya no es cierta.

---

## Race conditions específicas de Frentes 1 y 2 (auditoría del código propio)

| Riesgo | Mitigación implementada | Verificado |
|---|---|---|
| Bulk-delete concurrente entre superadmins (mismo tipo de entidad) | `pg_advisory_xact_lock(hashtext('bulk_delete:' || entity_type))` | Código revisado — el lock se toma antes del loop, dentro de la transacción del RPC |
| Reset ejecutándose con checkout en curso | Trigger `guard_platform_reset_lock()` (`BEFORE INSERT` en `orders`/`remittances`) toma lock compartido; `execute_platform_reset` toma el exclusivo **antes** de leer el flag `enabled` | Confirmado el orden correcto en el archivo fuente: `pg_advisory_xact_lock` (línea 137) precede a `SELECT enabled ... FOR UPDATE` (línea 139) — cierra la ventana TOCTOU que el advisor había señalado en una iteración anterior del diseño |
| Doble-ejecución del reset en la ventana entre transacciones encoladas | Auto-desarme (`enabled = false`) dentro de la misma transacción del reset, antes del commit | Código revisado |
| Doble-click en bulk-delete | Idempotencia natural del `DELETE`/`UPDATE` sobre los mismos IDs (ejecutar dos veces no causa daño adicional) — sin `p_idempotency_token` explícito, decisión documentada en el plan | Aceptado como riesgo residual bajo, YAGNI |

## Redes de alto tráfico/latencia/3G

- Ninguno de los 2 RPCs nuevos (`bulk_delete_*`, `execute_platform_reset`) hace N requests secuenciales desde el cliente — ambos son una sola llamada RPC transaccional, resiliente a que se corte la conexión a mitad de una operación cliente-side (el servidor completa o revierte, no queda a medio camino por un timeout del navegador).
- **PERF-01 sigue siendo el hallazgo de mayor impacto para el público objetivo** (mobile 3G) y no se tocó esta sesión — ver tabla arriba.

---

## Qué se implementó vs. qué requiere decisión separada

**Implementado y committeado esta sesión** (código, sin deploy/apply):
- Eliminado código muerto de SEC-03.
- CORS allowlist real (SEC-04) en 3 Edge Functions — **no desplegado**.

**Confirmado ya resuelto sin cambios** (verificado, no atribuible a esta sesión): SEC-02, SEC-06.

**Requieren decisión/acción separada del usuario, no ejecutados autónomamente**:
- Desplegar las 3 Edge Functions (`supabase functions deploy notify-order notify-zelle-deactivation notification-settings`) — mismo nivel de riesgo que `apply_migration`.
- SEC-01: verificar si el secret de Google OAuth sigue en la historia de git.
- DATA-01 (RPCs atómicos de pago) y PERF-01 (code splitting): refactors de tamaño medio-grande sobre el camino de dinero o sobre el bundle principal, sin harness de verificación adecuado para hacerlos sin supervisión directa.
- PITR de Supabase: **sigue sin confirmar** (Dashboard → Database → Backups) — bloqueante para habilitar el flag de reset alguna vez.
