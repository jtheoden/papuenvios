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

- [ ] **SEC-01**: Revocar client secret de Google OAuth en GCloud Console + limpiar historial git
- [ ] **SEC-02**: Migrar cifrado bancario a Edge Function server-side (src/lib/encryption.js)
- [ ] **LEGAL-01**: Consulta legal OFAC/MSB para operación de remesas Cuba-USA
- [ ] **LEGAL-02**: Implementar páginas `/privacy` y `/terms` con contenido legal real
- [ ] **TEST-01**: Suite mínima E2E para flujo remesa completo + unit tests calculation engine

## 🟡 P1 — Alta prioridad (completar antes de lanzamiento)

- [ ] **SEC-03**: Corregir autorización dual en zelleService.js (usar user_profiles.role)
- [ ] **SEC-04**: Restringir CORS wildcard en notify-order y notify-zelle-deactivation
- [ ] **PERF-01**: Code splitting con React.lazy() para AdminPage, UserManagement, VendorPage
- [ ] **OPS-01**: Integrar Sentry para monitoring de errores en producción
- [ ] **DATA-01**: RPCs PostgreSQL para transacciones atómicas (validate_order_payment, create_remittance, apply_offer)
- [ ] **DATA-02**: Convertir available_quantity a GENERATED ALWAYS AS o trigger BEFORE UPDATE
- [ ] **OPS-02**: Configurar alertas en Supabase Dashboard y Vercel

## 🟠 P2 — Importante (puede lanzar, pero resolver pronto)

- [ ] **SEC-05**: Customizar rate limiting en Supabase Auth + hCaptcha en registro
- [ ] **DATA-03**: pg_cron job para reset automático de límites Zelle
- [ ] **SEC-06**: Restringir order_analytics para no exponer emails a usuarios normales
- [ ] **OPS-03**: Escribir runbook de incidentes
- [ ] **DATA-04**: Deprecar columna `estimated_delivery` duplicada en orders
- [ ] **SEC-07**: Redacción de PII en activity_logs + TTL 90 días
- [ ] **UX-01**: Tooltips en conceptos financieros del flujo de remesa

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
  - Conectado en `VendorInventoryTab.jsx` (productos), gateado a `isSuperAdmin` — **Categorías queda para un siguiente incremento** (su tab usa un layout de tarjetas propio, no `ResponsiveTableWrapper`; requiere wiring distinto, no técnica nueva).
  - Ofertas/combos: fuera de esta iteración, sigue condicional a confirmar volumen (NEEDS-DISCUSSION del plan).
  - Sin `p_idempotency_token` en esta primera versión — evaluado y descartado explícitamente (ver plan doc) para no sobre-ingenierizar el primer pase.
  - Tests: 59/59 verdes, incluye un test de componente nuevo (`ResponsiveTableWrapper.selection.test.jsx`, primer test de UI en este proyecto — hasta ahora solo había tests de funciones puras). Gotcha documentado en el test: jsdom no aplica CSS real, las 3 vistas responsive (mobile/tablet/desktop) coexisten en el DOM simultáneamente, hay que scopear queries con `within(table)`.
- [ ] **ADMIN-02**: Mecanismo de reset a estado inicial — flag en tabla `platform_reset_control` activable únicamente vía SQL directo, RPC `SECURITY DEFINER` con advisory lock exclusivo + auto-desarme, backup obligatorio previo
- [ ] **DATA-05** (nuevo): Auditar y modificar RPCs de checkout/pago para tomar `pg_advisory_xact_lock_shared` del namespace `platform_reset`, sin lo cual el lock del reset no serializa nada
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
