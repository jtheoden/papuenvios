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
