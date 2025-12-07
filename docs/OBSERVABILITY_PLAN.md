# Plan estratégico de observabilidad y bitácora de actividades

Este plan detalla los pasos para garantizar que cada acción relevante del sistema quede registrada en `activity_logs` y que los operadores puedan auditar el historial de cambios sin depender de recursos ausentes (por ejemplo, una Edge Function no desplegada).

## Objetivos
- Asegurar que ningún evento crítico se pierda por falta de sesión, errores de red o discrepancias de UUID.
- Centralizar la lógica de logging en el cliente mientras se habilita una ruta clara para moverla a una función Edge/Supabase si se requiere más adelante.
- Mantener la trazabilidad de las configuraciones de notificación en la tabla `system_config` mientras se valida el acceso autenticado.

## Tareas prioritarias
1. **Robustecer el logger de actividades en el cliente**
   - Persistir en cola local los eventos cuando no haya sesión activa o falle la inserción, y reintentar en cuanto exista sesión.
   - Validar y sanear los datos antes de insertarlos (UUID, metadata JSON) para evitar errores de RLS o tipos.
   - Unificar la construcción del payload para que la semántica sea consistente entre insertos inmediatos y reintentos.
2. **Gatillar el vaciado de la cola tras la autenticación**
   - Detectar sesiones recién creadas y forzar un `flush` para que los eventos almacenados localmente se escriban en `activity_logs`.
   - Registrar resultados y dejar trazas para depuración en caso de fallos repetidos.
3. **Revisar cobertura de logging en flujos críticos**
   - Auditar puntos de creación/actualización/borrado de entidades clave (ofertas, productos, pedidos, ajustes de configuración) y añadir llamadas a `logActivity` donde falten.
   - Documentar el mapa de eventos y su semántica (acción, entidad, metadata mínima requerida).
4. **RLS y permisos de soporte**
   - Verificar que el cliente siempre opera con sesiones `authenticated` al registrar eventos.
   - Si se requiere logging de sistema (acciones automáticas o sin usuario), planificar una Edge Function o servicio con clave `service_role` y políticas RLS dedicadas.
5. **Monitoreo y alertas**
   - Incorporar métricas básicas: conteo de eventos por acción y por entidad.
   - Definir alertas cuando el `flush` falle repetidamente o la cola crezca más allá de un umbral.

## Futuras iteraciones
- Migrar el logging a una función Edge para centralizar reglas de negocio y evitar exponer claves adicionales en el cliente.
- Añadir exportaciones auditables (CSV/JSON) y vistas filtradas para equipos de soporte.
- Integrar dashboards (p. ej., Supabase Logs/ClickHouse) para consultas rápidas de actividad.
