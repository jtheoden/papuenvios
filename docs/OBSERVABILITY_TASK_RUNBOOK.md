# Runbook: Ejecución secuencial para la observabilidad

Este runbook define una tarea independiente para ejecutar, paso a paso, el plan de observabilidad ya documentado. Se alinea con los estándares del proyecto y exige que cada agente revise el código antes de intervenir y trabaje en una rama paralela.

## Preparación obligatoria (antes de tocar código)
1. **Revisar el proyecto**: leer `DEVELOPMENT_STANDARDS.md`, `ERROR_HANDLING_STANDARD.md`, `OBSERVABILITY_PLAN.md` y `PAYMENT_VALIDATION_DIAGNOSTIC.md` para entender convenciones, flujos y diagnósticos vigentes.
2. **Sincronizar rama base**: actualizar `work` desde `origin/work` y crear una rama paralela `feature/observability-task-<n>` para aislar cambios.
3. **Mapa rápido**: inspeccionar `src/lib/activityLogger.js`, `src/lib/notificationSettingsService.js`, `src/lib/orderService.js`, y los contextos (`src/contexts/*Context.jsx`) para conocer puntos de logging y carga de configuración.

## Pasos de la tarea
1. **Diagnóstico inicial en Supabase**
   - Ejecutar los SQL de `PAYMENT_VALIDATION_DIAGNOSTIC.md` y añadir consultas de `activity_logs` y `system_config` (RLS, privilegios, triggers, datos clave) antes de modificar código.
   - Guardar resultados relevantes en notas de la rama para rastreabilidad.
2. **Cobertura de logging**
   - Revisar flujos CRUD críticos (órdenes, inventario, ajustes de configuración) y llamar a `logActivity` donde falte, usando la semántica definida en `OBSERVABILITY_PLAN.md`.
   - Verificar que `entity_id` se valide (UUID) y que `metadata` sea JSON serializable.
3. **Resiliencia y cola**
   - Confirmar que la cola de `activityLogger` se vacíe al tener sesión y que los reintentos manejen fallos de red/UUID sin perder eventos.
   - Añadir métricas/contadores mínimos (logs de consola estructurados) para detectar reintentos fallidos reiterados.
4. **Configuración y notificaciones**
   - Asegurar que `notificationSettingsService` lee/escribe directamente en `system_config` con `upsert` autenticado y que las claves requeridas existen (`whatsapp_admin_phone`, `whatsapp_group`, `admin_email`).
   - Documentar en la PR cómo se validó la carga de valores reales.
5. **Revisión de RLS y permisos**
   - Si se requiere logging de sistema sin usuario, planificar (o crear) políticas RLS y, si procede, una Edge Function con `service_role`, manteniendo la lógica del cliente alineada con la futura migración.
6. **Pruebas y validación**
   - Ejecutar las pruebas/lints definidos en `DEVELOPMENT_STANDARDS.md` (o especificar si no aplican) y validar manualmente una transición de pago desde `pending` a `validated` registrando la actividad.

## Entregables
- Commits en la rama paralela con mensajes claros, seguidos de PR que referencie este runbook y resuma diagnósticos ejecutados y resultados.
- Evidencia (consultas, logs de consola, capturas si aplica) que demuestre que cada paso fue completado y que los valores de configuración se cargan desde la tabla fuente.

## Flujo global a respetar
- Mantener el flujo general definido en los planes existentes: diagnóstico → refuerzo de logging → validación de RLS → pruebas → documentación en PR.
- No fusionar sin revisión: siempre abrir PR desde la rama paralela siguiendo el checklist de estándares.
