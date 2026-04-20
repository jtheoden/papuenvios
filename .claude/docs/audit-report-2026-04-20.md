# Reporte de Auditoría — PapuEnvios
**Fecha**: 2026-04-20 | **Auditor**: Claude Sonnet 4.6 | **Versión analizada**: rama `main` (HEAD: `0cebb670`)

---

## 1. Executive Summary

PapuEnvios es una plataforma de remesas y eCommerce dirigida a emigrantes cubanos en EE.UU. El proyecto tiene una base técnica sólida con Supabase + React/TypeScript, y ha recibido hardening de seguridad significativo en febrero 2026. Sin embargo, existen **5 bloqueadores críticos** que deben resolverse antes del lanzamiento público.

### Estado por área

| Área | Rating | Resumen |
|------|--------|---------|
| Seguridad | 🔴 CRÍTICO | Secret en git, cifrado con clave hardcoded, autorización dual inconsistente |
| Performance | 🟡 ADVERTENCIA | Bundle 1.5MB sin code splitting, sin lazy loading de rutas |
| Integridad de datos | 🟡 ADVERTENCIA | Sin transacciones atómicas en flujos críticos |
| Lógica de negocio | 🟢 OK | Engine de cálculo correcto, flujos bien definidos |
| UX/Accesibilidad | 🟡 ADVERTENCIA | Aria limitado, no hay tests de accesibilidad |
| Operaciones | 🔴 CRÍTICO | Sin monitoring, sin on-call, sin runbook de incidentes |
| Compliance/Legal | 🔴 CRÍTICO | Sin política de privacidad real, sin análisis OFAC documentado |
| Testing | 🔴 CRÍTICO | **Cero tests automatizados** en toda la base de código |

### Readiness Score para producción: **52/100**

El proyecto **no está listo para lanzamiento público** en el estado actual. Con los P0 resueltos, puede llegar a 75/100 en ~2-3 semanas de trabajo focalizado.

---

## 2. Security Audit 🔴 CRÍTICO

### 2.1 Secret de OAuth de Google comprometido en el repositorio

**Severidad: CRÍTICA — Acción inmediata requerida**

El archivo `client_secret_345880876329-hgq62oc3tj8cbfjgv2ds099q4edu5u4u.apps.googleusercontent.com.json` está **trackeado en git**. Contiene:
- `client_id`: `345880876329-hgq62oc3tj8cbfjgv2ds099q4edu5u4u.apps.googleusercontent.com`
- `client_secret`: comprometido (revocar en Google Cloud Console)

**Acciones requeridas antes de cualquier otro paso**:
1. Revocar el client_secret en Google Cloud Console inmediatamente
2. Generar nuevo credential
3. Limpiar el archivo del historial git con `git filter-repo`
4. Agregar `*.json` con `client_secret` al `.gitignore`

### 2.2 Clave de cifrado hardcoded con fallback inseguro

**Archivo**: `src/lib/encryption.js:7`

```javascript
const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'papuenvios-2025-secure-key-change-in-prod';
```

Esta función cifra números de cuenta bancaria de destinatarios. Si `VITE_ENCRYPTION_KEY` no está definida en Vercel, todos los números de cuenta se cifran con la clave hardcoded pública.

Adicionalmente, la clave es una variable `VITE_*` — se incluye en el bundle JS del cliente y es visible en DevTools. **Esto invalida completamente el propósito del cifrado.**

**Diseño correcto**: el descifrado debe ocurrir server-side (Edge Function con service_role), nunca en el cliente.

### 2.3 Autorización dual inconsistente en zelleService

**Archivo**: `src/lib/zelleService.js:50`

```javascript
if (user.user_metadata?.role !== USER_ROLES.ADMIN && user.user_metadata?.role !== USER_ROLES.SUPER_ADMIN) {
```

El rol se lee de `user_metadata` (JWT claims), pero en el resto de la app se usa `user_profiles.role` (tabla de DB). Un atacante puede manipular sus propios metadatos para bypassear esta verificación.

### 2.4 CORS wildcard en Edge Functions

**Archivos**: `supabase/functions/notify-order/index.ts:94`, `supabase/functions/notify-zelle-deactivation/index.ts:14`

```javascript
'Access-Control-Allow-Origin': '*',
```

Ambas Edge Functions permiten llamadas desde cualquier origen. `notification-settings` tiene implementación correcta (`buildCorsHeaders`) — las otras deben igualarse.

### 2.5 Rate limiting ausente en formularios críticos

No existe rate limiting en login, registro ni subida de comprobantes de pago. Supabase Auth tiene rate limiting básico configurable pero no está customizado.

### 2.6 Zelle como método de pago: riesgos de fraude

- Comprobantes falsos (screenshots editados) sin validación automática
- Doble validación posible si dos admins actúan simultáneamente (sin locks)
- Pagos Zelle son irreversibles — pérdida total si se valida comprobante falso
- Reset de límites diarios/mensuales es manual — sin job automático

### 2.7 PII en logs sin redacción ni TTL

`activityLogger.js` serializa metadata completa a `activity_logs` sin redacción de campos sensibles (emails, montos, IDs). Sin TTL definido.

### 2.8 `order_analytics` view expone emails

La vista `order_analytics` (SECURITY INVOKER) expone `customer_email` de `user_profiles` a todos los `authenticated`. Cualquier usuario logueado puede consultar emails de otros clientes.

---

## 3. Performance Audit 🟡 ADVERTENCIA

### 3.1 Bundle JS: 1,575,146 bytes sin code splitting

Un único chunk `index-DTP2BRNR.js` de 1.5MB. Todos los imports en `App.jsx` son estáticos — AdminPage, UserManagement y otros componentes de admin se cargan para todos los usuarios.

TTI estimado en 3G (común en móviles de emigrantes): 8-15 segundos.

**Solución**: `React.lazy()` + `Suspense` para rutas de admin. Reducción esperada del bundle inicial: 40-60%.

### 3.2 Sin Content Security Policy

`vercel.json` no define headers de seguridad. Sin CSP, XSS puede ejecutar requests a dominios de terceros. Sin `X-Frame-Options`, la app es vulnerable a clickjacking.

### 3.3 Sin caché de imágenes / CDN optimizado

Imágenes de productos en Supabase Storage sin `Cache-Control` configurado ni uso de transformaciones de imagen. Se sirven en tamaño original.

### 3.4 Consultas N+1 potenciales

AdminPage carga múltiples tabs con queries independientes sin caching compartido. Subscriptions Realtime múltiples por cliente aumentan overhead de WebSocket.

---

## 4. Data Integrity Audit 🟡 ADVERTENCIA

### 4.1 Sin transacciones atómicas en flujos críticos

Supabase JS no expone transacciones explícitas. Los flujos sin atomicidad:

1. **Validar pago de orden**: update orders.payment_status → update inventory → log Zelle transaction
2. **Crear remesa**: insert remittance → reserve Zelle account → log activity
3. **Aplicar oferta**: create order → increment offer_usage.usage_count (puede sobrepasar usage_limit)

**Solución**: RPCs PostgreSQL con `BEGIN/COMMIT` llamadas via `.rpc()`.

### 4.2 `available_quantity` no es columna generada

```sql
available_quantity integer DEFAULT (quantity - reserved_quantity)
```

Es un `DEFAULT` calculado al insertar, no `GENERATED ALWAYS AS`. Actualizaciones directas a `quantity` o `reserved_quantity` dejan `available_quantity` desactualizado → overselling posible.

### 4.3 Reset de límites Zelle no automatizado

No hay pg_cron ni job automático para resetear `current_daily_amount` y `current_monthly_amount`. Si el admin olvida resetear, las cuentas aparecen como "llenas" indefinidamente.

### 4.4 Límite de uso de oferta por usuario solo en cliente

El check de `user_usage_limit` parece implementarse solo en el cliente. Sin constraint o trigger en DB que prevenga aplicar la misma oferta múltiples veces vía requests directos a la API.

### 4.5 Columnas duplicadas en `orders`

Existen tanto `estimated_delivery date` como `estimated_delivery_date date` — inconsistencia de schema generada en Phase 2.

---

## 5. Business Logic Audit 🟢 OK (con observaciones)

### 5.1 Engine de cálculo de remesas ✅

Fórmulas correctamente implementadas y documentadas:
- **Forward**: `commission = (amount * pct/100) + fixed` → `deliver = (amount - commission) * rate`
- **Reverse**: `send = ((desired/rate) + fixed) / (1 - pct/100)`
- **Rate resolution**: `exchange_rates` table > `type.exchange_rate` fallback > 1 si misma moneda

El simulador en frontend refleja las mismas fórmulas del servidor. ✅

**Observación**: el admin puede no saber que `exchange_rates` sobrescribe el rate del tipo de remesa — no hay warning en la UI.

### 5.2 Modo Delivery Rate

Implementación matemáticamente correcta. Riesgo de floating point drift en ediciones sucesivas por la derivación inversa.

### 5.3 Rotación de cuentas Zelle

Delega correctamente a RPC en DB (`getAvailableZelleAccount`) para evitar race conditions. ✅

### 5.4 Sistema de categorías de usuario

Categorización automática con historial es flexible y bien modelado. Riesgo: recategorización automática puede sorprender al usuario sin notificación.

---

## 6. UX/Accessibility Audit 🟡 ADVERTENCIA

### 6.1 Accesibilidad básica

Solo 63 atributos `aria-*` en ~50 componentes. Problemas probables: sin focus trap en modales, tablas sin `scope` en headers, colores de estado sin indicador alternativo para daltonismo.

### 6.2 Experiencia en móvil

Target primario usa smartphones. Bundle de 1.5MB es crítico en datos móviles. Sin tests E2E en mobile.

### 6.3 i18n ES/EN

Implementación correcta con `t('key.path')`. Riesgos:
- Claves faltantes retornan string crudo si el fallback no está bien implementado
- No hay proceso para mantener ES/EN sincronizados al añadir features
- Default de idioma en emails transaccionales no documentado

### 6.4 Flujo de remesas para usuarios no técnicos

Sin onboarding ni tooltips contextuales. Conceptos de "tasa de entrega" vs. "tasa de mercado" no son intuitivos para usuarios sin experiencia financiera.

---

## 7. Operational Readiness 🔴 CRÍTICO

### 7.1 Sin monitoring de producción

```javascript
// TODO: Send to error tracking service (Sentry, LogRocket, etc.)
```

El TODO en `errorHandler.js` confirma que no hay Sentry ni ningún servicio de observabilidad. Los errores en producción son invisibles.

### 7.2 Sin alertas proactivas

No hay configuración de alertas en Supabase Dashboard, Vercel, ni alertas de negocio (remesa pendiente >24h, etc.).

### 7.3 Sin runbook de incidentes

No existe documentación de: qué hacer si Zelle falla, si Supabase tiene outage, proceso de rollback, contacto de escalamiento.

### 7.4 Backup no verificado

Supabase incluye backups diarios con PITR 7 días, pero no hay evidencia de restore de prueba ejecutado. Sin estrategia documentada de RTO/RPO.

### 7.5 Archivos de seguridad históricos en el repo

>80 archivos `.md` de desarrollo con información sobre vulnerabilidades pasadas (`FIX_403_DEFINITIVO.sql`, `EMERGENCY_RLS_FIX_USER_PROFILES.sql`). Si el repo se hace público accidentalmente, es un leak de información de seguridad.

---

## 8. Compliance & Legal 🔴 CRÍTICO

### 8.1 Regulaciones Cuba-USA (OFAC / CACR) ⚠️ BLOQUEADOR LEGAL

Las remesas a Cuba están reguladas por OFAC (Cuban Assets Control Regulations, 31 CFR Part 515):
- Límites: ~$1,000/trimestre por remitente familiar (sujeto a cambios)
- Plataformas que procesan remesas a Cuba deben mantener registros de cumplimiento
- Posible requerimiento de licencia **Money Services Business (MSB)** ante FinCEN
- Posibles licencias estatales de money transmitter

**No hay evidencia de**: análisis legal documentado, límites implementados a nivel sistema, verificación de listas SDN/OFAC, ni registro de compliance.

> ⚠️ Requiere consulta legal especializada en fintech/remesas Cuba-USA. No lanzar sin opinión legal documentada.

### 8.2 Política de privacidad y ToS inexistentes

`LoginPage.jsx` referencia "terms of service and privacy policy" pero no hay páginas `/privacy` ni `/terms` implementadas. Viola:
- **CCPA** (California Consumer Privacy Act) — aplicable a usuarios en California
- ToS de Supabase — requieren que usuarios finales tengan acceso a política de privacidad

### 8.3 Retención de datos y derecho al olvido

No hay: TTL en logs, proceso de eliminación de cuenta, proceso para solicitudes CCPA de "derecho al olvido".

---

## 9. Action Plan

| Prioridad | Área | Issue | Acción recomendada | Esfuerzo (h) | Owner |
|-----------|------|-------|-------------------|--------------|-------|
| **P0** | Seguridad | Client secret de Google en git | Revocar en GCloud Console → `git filter-repo` → nuevo credential | 2h | Lead Eng |
| **P0** | Seguridad | Clave cifrado bancario en cliente | Edge Function para descifrado server-side. Rotar claves y re-cifrar datos | 8h | Lead Eng |
| **P0** | Compliance | Análisis OFAC/MSB | Consulta legal especializada en fintech/remesas Cuba-USA | 40h+ (externo) | Fundador |
| **P0** | Legal | Privacidad y ToS | Redactar e implementar `/privacy` y `/terms` con contenido legal real | 8h legal + 2h dev | Fundador |
| **P0** | Testing | Cero tests automatizados | Suite mínima E2E para flujo remesa completo + unit tests calculation engine | 24h | QA + Lead Eng |
| **P1** | Seguridad | Autorización dual en zelleService | Reemplazar `user_metadata?.role` por query a `user_profiles.role` | 2h | Lead Eng |
| **P1** | Seguridad | CORS wildcard en Edge Functions | Restringir `Access-Control-Allow-Origin` a dominio de producción | 1h | Lead Eng |
| **P1** | Performance | Bundle 1.5MB sin code splitting | `React.lazy()` + `Suspense` para AdminPage, UserManagement, VendorPage | 4h | Frontend Dev |
| **P1** | Operaciones | Sin monitoring de errores | Integrar Sentry (tier gratuito) en frontend y reemplazar TODO en errorHandler.js | 3h | Lead Eng |
| **P1** | Integridad | Sin transacciones atómicas | RPCs PostgreSQL para validate_order_payment, create_remittance, apply_offer | 12h | Backend Dev |
| **P1** | Integridad | `available_quantity` no generada | `GENERATED ALWAYS AS (quantity - reserved_quantity) STORED` o trigger BEFORE UPDATE | 2h | DBA |
| **P1** | Operaciones | Sin alertas | Configurar alertas en Supabase Dashboard + Vercel error rate | 4h | DevOps |
| **P2** | Seguridad | Rate limiting | Customizar rate limiting en Supabase Auth. Añadir hCaptcha en registro | 3h | Lead Eng |
| **P2** | Integridad | Reset automático límites Zelle | pg_cron job para reset diario/mensual de contadores | 2h | DBA |
| **P2** | Seguridad | order_analytics expone emails | Restringir vista a rol admin o eliminar customer_email para no-admin | 1h | DBA |
| **P2** | Operaciones | Sin runbook | Documentar procedimientos: Supabase outage, Zelle fallo masivo, remesa atascada, rollback | 8h | Lead Eng |
| **P2** | Data | Columnas duplicadas en orders | Deprecar `estimated_delivery`, migrar a `estimated_delivery_date`, eliminar | 2h | DBA |
| **P2** | Seguridad | PII en activity_logs | Redactar campos sensibles antes de insert. TTL 90 días | 4h | Backend Dev |
| **P2** | UX | Tooltips conceptos financieros | Tooltips en "tasa de entrega", "tasa de mercado", "comisión" en flujo remesa | 3h | Frontend Dev |
| **P3** | Performance | CSP y headers de seguridad | `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` en vercel.json | 2h | DevOps |
| **P3** | Seguridad | Archivos .md sensibles en repo | Mover documentos de seguridad históricos fuera del repo. Revisar .gitignore | 2h | Lead Eng |
| **P3** | Compliance | Retención de datos | Soft-delete para usuarios, TTL en logs, proceso CCPA documentado | 8h | Lead Eng |
| **P3** | UX | Accesibilidad WCAG 2.1 AA | Focus trap en modales, `aria-live` para toasts, review de contraste | 8h | Frontend Dev |
| **P3** | Performance | Optimización de imágenes | Cache-Control en Supabase Storage. Supabase Image Transformations para thumbnails | 3h | DevOps |
| **P3** | UX | Onboarding nuevos usuarios | Wizard de primer paso o tooltips contextuales en SendRemittancePage | 6h | Frontend Dev |

### Resumen de esfuerzo

| Nivel | Issues | Esfuerzo técnico estimado |
|-------|--------|--------------------------|
| P0 | 5 | ~36h técnicas + consulta legal externa |
| P1 | 7 | ~28h |
| P2 | 8 | ~23h |
| P3 | 6 | ~29h |

**Ruta crítica para lanzamiento**: P0 completo + P1 completo ≈ 64h de trabajo técnico + decisión legal sobre OFAC/MSB.

---

*Archivos clave referenciados*:
- [src/lib/encryption.js](src/lib/encryption.js) — clave hardcoded en cliente
- [src/lib/zelleService.js](src/lib/zelleService.js) — autorización dual (línea ~50)
- [supabase/functions/notify-order/index.ts](supabase/functions/notify-order/index.ts) — CORS wildcard
- [src/App.jsx](src/App.jsx) — sin lazy loading
- [src/lib/orderService.js](src/lib/orderService.js) — sin transacciones atómicas
- [supabase/currentDBSchema.sql](supabase/currentDBSchema.sql) — `available_quantity` no generada
