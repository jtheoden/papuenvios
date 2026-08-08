# Plan Estratégico: Operaciones Administrativas Destructivas Seguras — Bulk-Delete, Reset de Plataforma y Auditoría de Concurrencia/Red

**Fecha**: 2026-08-07 | **Generado por**: `/strategic-plan-workflow` (recon → 3 frentes → síntesis → crítica adversarial → advisor cross-check) | **Estado**: Validado, pendiente de decisión del usuario en puntos NEEDS-DISCUSSION antes de implementar.

## Resumen ejecutivo

Los tres frentes convergen en una sola pieza de infraestructura nueva —un patrón de "operación administrativa destructiva segura" (autorización server-side re-derivada, advisory lock, confirmación re-validada en servidor, log post-commit)— que Frente 1 (bulk-delete) y Frente 2 (reset) comparten en vez de reimplementarse por separado. Este documento pasó por crítica adversarial y luego por un cross-check independiente (advisor) que corrigió tres errores reales que la crítica había introducido: (1) el "soft-delete vía `activa`" no existe en este proyecto — es una convención de otro repo, confirmado con `grep` (0 resultados); el borrado real de productos/categorías es físico con cascada de 5 pasos en `productService.js`; (2) el lock propuesto para checkout serializaba todos los checkouts entre sí permanentemente — corregido a lock compartido; (3) la restricción "nadie puede escribir el flag de reset" se contradecía a sí misma con el propio mecanismo de auto-desarme — acotada a "nadie puede ponerlo en `true`". Ningún cambio de código se ejecuta todavía.

---

## Orden de ejecución entre frentes

```
FASE 0 — Verificación de evidencia [COMPLETADA 2026-08-07, ambos hallazgos CONFIRMADOS]
└── select_available_zelle_account (SELECT sin FOR UPDATE) + update_zelle_account_usage
    (RPC separado, invocado despues en el flujo, ver CartPage.jsx:678) = ventana TOCTOU
    real: dos ordenes concurrentes pueden pasar el chequeo de limite y reservar la misma
    cuenta, superando daily_limit/security_limit. La auditoria previa (2026-04-20, §5.3)
    calificaba este patron como "✅ evita race conditions" - ESA CONCLUSION QUEDA
    SUPERADA por esta verificacion; no se debe re-citar como valida.
    categories_all_admin usa is_admin_user() (no is_super_admin()) para FOR ALL,
    incluyendo DELETE - confirmado via cita literal de la migracion.

FASE 0.1 — Fixes puntuales de bajo riesgo, alto valor, sin dependencias
├── Fix de locking en select_available_zelle_account/update_zelle_account_usage
│   (bug de dinero confirmado, independiente de Frentes 1/2 - ver nota de prioridad)
├── SEC-03 (zelleService.js lee user_metadata en vez de user_profiles.role)
├── SEC-04 (CORS wildcard en 2 Edge Functions)
├── SEC-08 nuevo: purgar PGPASSWORD de la historia de .claude/settings.json (ya autorizado)
└── Housekeeping TRACKING_PROGRESS.md (sync de estado ya resuelto)

FASE 1 — Decisiones de producto (bloqueante, ver NEEDS-DISCUSSION)
└── Usuario responde los puntos que realmente requieren su criterio (lista recortada abajo)

FASE 2 — Diseño técnico compartido
└── Migración base admin_destructive_ops_base.sql: assert_super_admin(), convención de
    advisory locks (namespace compartido, semántica shared/exclusive), tabla(s) de log
    con RLS/GRANT completos, y modificación de los RPCs de checkout/pago existentes
    para tomar lock COMPARTIDO del mismo namespace que usa el reset (exclusivo).

FASE 3 — Implementación (paralelizable una vez cerrada Fase 2)
├── Frente 1 — bulk-delete (entidades confirmadas en Fase 1)
└── Frente 2 — reset de plataforma

FASE 4 — Auditoría dirigida (después de Frente 1 y 2, sobre el código real)
├── Race conditions específicas de bulk-delete y reset
├── Re-verificación de vigencia de TODOS los hallazgos de la auditoría previa relevantes
│   a red/performance (PERF-01, SEC-05, SEC-07, DATA-01/03/04, OPS-01..03, TEST-01)
└── Comportamiento en 3G: idempotencia ante reintento por timeout, tamaño de payload

FASE 5 — Cierre
└── Tests del guard de flag + guard de operación en curso + housekeeping final de
    TRACKING_PROGRESS.md con IDs nuevos
```

---

## Frente 1: Selección múltiple + borrado masivo

### Entidades donde SÍ aplica

| Entidad | Componente | Justificación |
|---|---|---|
| Productos | `src/components/vendor/ProductTableConfig.jsx` | 38 productos hoy, ciclo de vida de catálogo, pedido explícito del usuario. |
| Categorías | (config a crear/ubicar junto a productos) | 8 categorías hoy, pedido explícito, operación recurrente al reorganizar catálogo. |
| Ofertas/combos | sin config dedicada conocida | Condicional — mismo ciclo de vida que productos, confirmar volumen en Fase 1. |

### Entidades donde NO aplica

| Entidad | Por qué NO |
|---|---|
| Órdenes | Riesgo contable/legal — historial de transacciones, fuera de alcance. |
| Inventario | Estado derivado de productos/movimientos, no una entidad "borrable" independiente. |
| Cuentas Zelle | Baja cardinalidad, alto impacto si se borra la equivocada; desactivación individual ya cubre el caso de uso real. |
| Usuarios | Irreversible, riesgo legal/contable, se superpone con Frente 2 — **NEEDS-DISCUSSION**, no descartado unilateralmente. |

### Diseño técnico

- **UI**: extender `src/components/tables/ResponsiveTableWrapper.jsx` (o `DataTable.jsx`, que ya tiene TODOs explícitos de "bulk actions" sin implementar, líneas 96-99) con columna de checkbox + barra de acción flotante "N seleccionados → Eliminar". Visible solo si `role === 'super_admin'` (gate de UX; la seguridad real vive en el RPC).
- **Confirmación**: modal con conteo explícito; el RPC re-valida ese conteo contra `SELECT COUNT(*)` real de los IDs recibidos antes de ejecutar — no confía en el conteo del cliente.
- **RPC** `bulk_delete_entity(p_entity_type text, p_ids uuid[], p_idempotency_token uuid)`, `SECURITY DEFINER`:
  - `PERFORM assert_super_admin();`
  - `PERFORM pg_advisory_xact_lock(hashtext('bulk_delete:' || p_entity_type));`
  - Reutiliza la **misma cascada de borrado físico que ya existe** en `deleteProduct`/`deleteCategory` (`productService.js:526-771` y `943-1039`), portada a SQL o invocada en loop dentro de una única transacción — no soft-delete inventado, porque `is_active` no es un mecanismo de borrado en este proyecto (verificado: 0 usos de `activa` en todo el repo).
  - Retorna `{deleted: uuid[], blocked: uuid[], reason: text[]}` — reporte parcial, no todo-o-nada (una orden bloqueante en un ítem no debe abortar el resto del batch).
  - Idempotente vía `p_idempotency_token`: reintento tras timeout de red devuelve el resultado cacheado del log, no re-ejecuta.
- **RLS a corregir como prerequisito** (sujeto a verificación de Fase 0): si se confirma que `categories_all_admin` usa `is_admin_user()` en vez de `is_super_admin()` para DELETE, se endurece en la misma migración.

### Límite YAGNI

- No se construye una interfaz genérica `execute_admin_destructive_op`. Cada entidad tiene su RPC delgado reusando el helper común.
- No se implementa bulk-delete de ofertas/combos hasta confirmar volumen con el usuario.
- No se implementa "deshacer" — el borrado físico no es reversible por diseño (igual que hoy en single-row).

### Tamaño estimado

Migración SQL (~150-180 líneas), componente de selección (~150-200 líneas), modal de confirmación (~80 líneas), hook `useBulkDelete` (~60 líneas). **~500-550 líneas**, PR único salvo que se agregue ofertas/combos.

---

## Frente 2: Mecanismo de reset a estado inicial

### Estrategia elegida para el flag habilitador

Tabla dedicada `platform_reset_control` (una sola fila) con columna `enabled boolean DEFAULT false`. Botón **siempre visible pero deshabilitado** en el menú de super_admin cuando `enabled = false` (evita seguridad-por-oscuridad).

**Hard constraint** (corregida tras cross-check): **ninguna vía invocable desde la aplicación puede poner `enabled = true`.** El RPC de reset es la única excepción autorizada a escribir la columna, y únicamente para ponerla en `false` (auto-desarme post-ejecución) — nunca para activarla. Se garantiza con:
1. `GRANT`: sin `UPDATE`/`INSERT` sobre la tabla a `authenticated`/`anon`/`service_role`.
2. Auditoría en Fase 4 de todo RPC `SECURITY DEFINER` y Edge Function existente, confirmando que ninguno hace `enabled = true` (un `SECURITY DEFINER` corre con privilegios del owner, no del caller — el GRANT solo no alcanza).
3. Activación exclusivamente vía SQL directo (dashboard Supabase o `psql` como `postgres`), documentado como procedimiento operativo.

Se descarta `system_config` genérica porque ya es escribible por `super_admin` vía RLS existente — la haría falsificable desde la UI, justo lo que el usuario prohibió.

### Tablas que limpia / no toca

**NEEDS-DISCUSSION** (no se resuelve en este plan): propuesta de trabajo — `orders`, `cart_items`, `shopping_carts`, `notification_logs`, `offer_usage`, `user_alerts`, `zelle_payment_stats`, `inventory_movements`, `site_visits`, `user_category_history`. Explícitamente sin decidir: usuarios, `recipient_bank_accounts`/`remittance_bank_transfers`, `publications`. El log de la propia operación (`admin_destructive_ops_log`) nunca se limpia con el reset.

### Diseño técnico

- **RPC** `execute_platform_reset(p_confirmation text)`, `SECURITY DEFINER`:
  - `PERFORM assert_super_admin();`
  - `IF NOT (SELECT enabled FROM platform_reset_control) THEN RAISE EXCEPTION ...;` — re-valida server-side, no confía en el estado del botón en el cliente.
  - `IF p_confirmation != 'RESETEAR' THEN RAISE EXCEPTION ...;`
  - `PERFORM pg_advisory_xact_lock(hashtext('platform_reset'));` — **exclusivo**. Los RPCs de checkout/pago toman `pg_advisory_xact_lock_shared` del mismo namespace (corregido tras cross-check: la versión exclusiva-contra-exclusiva serializaba todos los checkouts entre sí para siempre; shared-vs-exclusive permite que los checkouts sigan concurrentes entre sí y solo esperen cuando el reset realmente está corriendo).
  - Ejecuta los DELETE/TRUNCATE confirmados en Fase 1, en una única transacción todo-o-nada.
  - Al final, dentro de la misma transacción: `UPDATE platform_reset_control SET enabled = false` (auto-desarme — cierra la ventana de doble-ejecución) e inserta en `admin_destructive_ops_log` (post-commit).
- **Backup obligatorio, no opcional**: antes de permitir `enabled = true`, el procedimiento operativo exige verificar PITR activo en Supabase o ejecutar `supabase db dump --linked` con evidencia registrada. Se documenta en un runbook en `.claude/docs/`.
- **UI**: botón deshabilitado + tooltip "Requiere activación desde base de datos" cuando `enabled = false`; al habilitarse, exige escribir `'RESETEAR'` antes de confirmar.

### Límite YAGNI

- No se construye sistema de "snapshots restaurables desde la UI" — backup es paso operativo documentado.
- No se soporta reset parcial por módulo — todo-o-nada según lo pedido.

### Tamaño estimado

Migración SQL (~180-220 líneas), modificación de RPCs de checkout existentes (variable, a inventariar en Fase 2), UI (~100 líneas), runbook de backup (documentación). **~400-500 líneas + 1 documento operativo**, PR separado del Frente 1.

---

## Frente 3: Auditoría seguridad/performance/race-conditions/redes

| Hallazgo | Severidad | Estado | Archivo | Acción | Esfuerzo |
|---|---|---|---|---|---|
| PGPASSWORD hardcodeado en `.claude/settings.json` | **Crítico** | Confirmado esta sesión, commits `4b7f21dd`/`75e2b1f2` | `.claude/settings.json` | `git filter-repo` + force-push (ya autorizado por el usuario) | M |
| **Bug de concurrencia real en rotación Zelle** | **Crítico (dinero real)** | **CONFIRMADO 2026-08-07** — ver evidencia abajo | `supabase/migrations/20260210000001_security_hardening.sql:793-815` (`select_available_zelle_account`), `:914-928` (`update_zelle_account_usage`), invocación en `src/components/CartPage.jsx:678` y `src/lib/zelleService.js:152-280` | Combinar selección + reserva en un único RPC `SECURITY DEFINER` con `SELECT ... FOR UPDATE` (o `pg_advisory_xact_lock` por cuenta), atómico, para eliminar la ventana TOCTOU | S — pero prioridad alta, independiente de Frentes 1/2 |
| `categories_all_admin` permite DELETE a admin no-super | **CONFIRMADO 2026-08-07** | `supabase/migrations/20260210000002_rls_initplan_optimization.sql:81` — `CREATE POLICY "categories_all_admin" ON public.product_categories FOR ALL USING ((select is_admin_user()));` | Endurecer a `is_super_admin()` para `DELETE`/`UPDATE` (mantener `is_admin_user()` para `SELECT`/`INSERT` si corresponde) | XS |
| Secret OAuth Google en historial git | Alto | Vigente (solo removido de HEAD) | historial git | `git filter-repo`/BFG, confirmar revocación en GCloud | M |
| Clave de cifrado bancario con fallback hardcoded | Alto | Vigente (SEC-01) | `src/lib/encryption.js` | Eliminar fallback, forzar env var | S |
| Autorización dual inconsistente | Alto | Vigente (SEC-03) | `src/lib/zelleService.js:50` | Migrar a `user_profiles.role` | S |
| CORS wildcard en 2 Edge Functions | Medio | Vigente (SEC-04) | `supabase/functions/*` | Restringir origen | S |
| `available_quantity` no es `GENERATED ALWAYS AS` | Alto (overselling) | Vigente (DATA-01) | schema inventory | Migrar a columna generada | M |
| Límite de oferta solo validado en cliente | Alto | Vigente | flujo de ofertas | Constraint/trigger en DB | M |
| Cero tests automatizados | Alto (bloqueante para confianza en F1/F2) | Vigente (TEST-01) | toda la base | Mínimo: tests de bulk-delete y reset (guard de flag + operación en curso) | M |
| Bundle JS 1.5MB sin code splitting | Medio, crítico para público 3G | Vigente (PERF-01) | build/rutas admin | Lazy-load rutas admin | M |
| Sin rate limiting login/registro, PII en activity_logs, `order_analytics` expone emails, sin CSP, sin cache imágenes | Medio | Re-verificar vigencia en Fase 4 | varios | Ver auditoría 2026-04-20 | Ver ahí |

### Race conditions específicas de Frentes 1 y 2

1. **Bulk-delete concurrente entre superadmins**: `pg_advisory_xact_lock(hashtext('bulk_delete:' || entity_type))` serializa por tipo de entidad.
2. **Reset con orden/pago en curso**: solo mitigado si Fase 2 modifica efectivamente los RPCs de checkout para tomar el lock compartido del mismo namespace — requisito de diseño, no verificación posterior.
3. **Doble ejecución en la ventana entre transacciones encoladas**: mitigado por auto-desarme (`enabled = false`) dentro de la misma transacción del reset — una segunda invocación sin reactivación manual falla de inmediato.
4. **Doble-click en bulk-delete**: mitigado por `p_idempotency_token`, no por soft-delete (que no existe en este proyecto).
5. **Colisión con edición unitaria existente**: riesgo residual aceptado — ambas operaciones requieren `super_admin` y son de baja frecuencia; forzar locking en todo el CRUD unitario es un cambio de alcance mayor no pedido. Re-evaluar si se observan colisiones reales.

### Redes de alto tráfico/latencia/3G

- Idempotencia vía `p_idempotency_token` en ambos RPCs destructivos.
- Modal de confirmación de bulk-delete solo envía IDs + conteo, no el detalle completo de cada ítem.
- Re-verificación de PERF-01 (bundle 1.5MB) es parte obligatoria de Fase 4, no opcional — el público objetivo mobile-3G lo hace tan prioritario como los hallazgos de seguridad.

### Límite YAGNI

- No se implementa retry automático del lado del cliente para operaciones destructivas.
- No se construye dashboard de monitoreo de race conditions.

### Tamaño estimado

Fase 0: ~30 min. Fase 4: revisión de ~15 archivos/RPCs + tests de concurrencia dirigidos, **2-3 días de auditoría**, más ~100-150 líneas de fixes puntuales de Fase 0.1.

---

## Riesgos NEEDS-DISCUSSION (recortado — solo lo que realmente requiere decisión del usuario)

1. **¿Bulk-delete de ofertas/combos entra en "productos, categorías, etc."?**
2. **¿Bulk-delete/desactivación de usuarios entra en alcance?** ¿Se unifica con la limpieza de usuarios de prueba del Frente 2, o se mantienen separados?
3. **¿Reset borra `user_profiles`/`auth.users` de prueba, o solo su actividad transaccional?** (default propuesto: NO borrar usuarios).
4. **¿Reset limpia `recipient_bank_accounts`/`remittance_bank_transfers` (PII bancaria de prueba)?**
5. **¿`publications` es contenido editorial a preservar o dato de prueba a limpiar?**
6. **¿El plan de Supabase tiene PITR habilitado hoy?** Determina si el backup obligatorio es "verificar PITR" o "exigir dump manual cada vez".

*(Se resolvieron sin necesidad de preguntar, con evidencia: soft vs. hard delete → hard delete, es la convención real del proyecto. Límite por operación → no urgente, catálogo actual es de 38 productos / 8 categorías. Autorización de `git filter-repo` → ya la diste. Nombre y comportamiento exacto de la rotación de cuentas Zelle → confirmado en Fase 0: `select_available_zelle_account` y `update_zelle_account_usage` son dos funciones reales y distintas, no una confusión de nombres — el problema es que no son atómicas entre sí (ver Frente 3).)*

**Respuesta a tu mensaje 2026-08-07** — resueltas con la lógica que diste ("todo lo que implique operación existente corresponde al período de pruebas") + evidencia adicional:

- **Reset (Frente 2) limpia**: `orders`, `remittances` (+ `recipient_bank_accounts`/`remittance_bank_transfers` — son datos generados 1:1 al crear remesas de prueba, aplico tu misma lógica), `offer_usage`/ofertas, `combos`, movimientos de inventario (no el catálogo de productos), estadísticas/historial de uso de cuentas Zelle (no la configuración de las cuentas en sí — borrar la cuenta rompería la configuración del vendor), y todos los usuarios no-superadmin.
- **`publications` queda FUERA del reset** (no estaba en tu lista, y verifiqué que es contenido editorial de blog —`src/components/BlogPage.jsx`—, no datos generados por operación/uso; aplica la misma lógica que protege a `products`/`categories` como catálogo).
- **Borrado de usuarios no-superadmin — más complejo de lo que el plan original asumía, necesita tu decisión**: `auth.users` es una tabla gestionada por Supabase Auth, no se puede `DELETE` con SQL directo — requiere la Admin API (`supabase.auth.admin.deleteUser`, con `service_role`, fuera de la transacción de Postgres). Eso significa que el reset ya no puede ser "todo-o-nada" en una sola transacción si incluye borrar usuarios de verdad — un fallo a mitad de camino entre el purgado SQL y las llamadas a la Admin API deja un estado parcial. Dos caminos:
  - **(A) Recomendado**: no borrar usuarios de `auth.users`. En su lugar, `is_enabled = false` en `user_profiles` (columna que ya existe según el schema) + purgar toda su actividad transaccional (órdenes, remesas, logs). Logra el "estado limpio" para pruebas sin el problema de atomicidad cross-sistema, y es reversible si te equivocás de usuario.
  - **(B)** Si necesitás borrado real de `auth.users`: se implementa como Edge Function (no RPC de Postgres) que orquesta purga SQL → loop de `admin.deleteUser()` por usuario, documentando explícitamente que puede quedar en estado parcial si falla a mitad de camino, con reintento idempotente por usuario.
  - Faltan por confirmar además: si algún FK de `orders`/`remittances`/`activity_logs`/`user_alerts` hacia `auth.users`/`user_profiles` es `ON DELETE RESTRICT` (como ya vimos en `recipient_bank_account_id`) — si lo es, el orden de borrado es obligatorio y se audita en Fase 2, no se asume ahora.
- **PITR**: no hay forma de verificarlo por API/MCP. Confirmalo vos en **Supabase Dashboard → Database → Backups** (requiere plan Pro o superior). Es prerequisito documentado antes de habilitar el flag de reset por primera vez.

---

## Crítica descartada y por qué

Ningún hallazgo de la crítica adversarial se descarta por completo. El hallazgo sobre lock de bulk-delete vs. edición unitaria se acepta parcialmente: se documenta como riesgo residual explícito en vez de forzar locking en todo el CRUD unitario existente — cambio de alcance mayor al pedido original (que fue específicamente sobre borrado masivo), riesgo real bajo dado que ambas operaciones requieren `super_admin` y son de baja frecuencia (YAGNI).

Se descartó (no se implementó) la propuesta original de soft-delete vía `activa=false` — verificado con `grep` que esa convención no existe en este repo (0 resultados), viene de un CLAUDE.md de otro proyecto en un directorio padre. Corregido tras cross-check independiente.
