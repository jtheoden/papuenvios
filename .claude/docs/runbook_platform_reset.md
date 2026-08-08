# Runbook: Reset de plataforma (Frente 2)

Procedimiento operativo para habilitar y ejecutar `execute_platform_reset()`. Este documento es el prerequisito de seguridad que el plan (`plan_admin-bulk-ops-reset-audit.md`) exige antes de tocar el flag — no es opcional.

## Antes de la primera vez

1. **Confirmar PITR activo**: Supabase Dashboard → Database → Backups. Point-in-Time Recovery requiere plan Pro o superior. Si no está activo, ejecutar un dump manual (paso 2) es obligatorio, no opcional.
2. **Backup manual de respaldo** (recomendado incluso con PITR activo, es la única evidencia verificable sin depender del dashboard):
   ```bash
   supabase db dump --linked -f backup_pre_reset_$(date +%Y%m%d_%H%M%S).sql
   ```
   Registrar el path del dump generado en este mismo archivo o en `TRACKING_PROGRESS.md` antes de continuar.
3. **Confirmar que no hay checkouts en curso**: el trigger `guard_reset_lock_orders`/`guard_reset_lock_remittances` hace que el reset espere a que terminen las transacciones de checkout activas (lock compartido vs. exclusivo), pero igual conviene evitar correr el reset en horario de tráfico activo si el sitio ya está en uso real.

## Qué borra (y qué NO)

Ver la migración `supabase/migrations/20260808000002_platform_reset.sql` (comentario de cabecera) para la lista completa y su justificación. Resumen:

- **Se borra**: orders, remittances, recipients (+ direcciones y cuentas bancarias asociadas), carritos, ofertas, combos, inventario (⚠️ deja todos los productos en stock 0), historial/estadísticas de uso de cuentas Zelle, notification_logs, user_alerts, site_visits, user_category_history.
- **Se conserva**: products, product_categories, remittance_types, shipping_zones, exchange_rates, currencies, publications, configuración de cuentas Zelle (solo se resetean sus contadores a 0), reglas/descuentos de categorización, `activity_logs` (rastro de auditoría — deliberadamente NO se borra, incluye el registro de este mismo reset), `admin_messages`.
- **Usuarios no-superadmin**: se deshabilitan (`user_profiles.is_enabled = false`), **no se borran** de `auth.users` (Opción A, decisión del usuario 2026-08-07).

## Activar el flag (el único paso que la app no puede hacer)

Ejecutar contra la base de datos directamente — dashboard de Supabase (SQL Editor) o `psql` conectado como `postgres`. **Nunca** desde la aplicación:

```sql
UPDATE platform_reset_control SET enabled = true, enabled_at = now(), enabled_by = '<tu email o identificador>' WHERE id = 1;
```

Una vez activado, el botón "Resetear plataforma" en Configuración → Sistema (solo visible para `super_admin`) queda habilitado.

## Ejecutar el reset

Desde la UI: Configuración → Sistema → "Resetear plataforma" → escribir `RESETEAR` → confirmar.

El RPC se auto-desarma (`enabled` vuelve a `false`) al terminar exitosamente — una segunda ejecución requiere volver a activar el flag manualmente. Esto es intencional: cierra la ventana de doble-ejecución.

## Después de ejecutar

1. Verificar el resultado en `admin_destructive_ops_log` (conteo de filas borradas por tabla, quedó en la respuesta del RPC y queda registrado ahí permanentemente).
2. **Re-cargar inventario**: como `inventory` queda vacío, los productos del catálogo muestran stock 0 hasta que se vuelvan a cargar cantidades. `available_quantity` es un `DEFAULT` calculado, no una columna generada (`DATA-02`, todavía abierto en `TRACKING_PROGRESS.md`) — probar este flujo de recarga antes de confiar en él para un lanzamiento real.
3. Confirmar que los usuarios no-superadmin quedaron deshabilitados como se esperaba.

## Antes del lanzamiento público real

Este mecanismo fue diseñado para el período de pruebas pre-lanzamiento. Antes de abrir la plataforma a usuarios reales, evaluar si:
- El flag debe quedar permanentemente en `false` con un procedimiento adicional para removerlo del todo (no solo el flag, sino remover la capacidad `execute_platform_reset` en sí), o
- Se mantiene como herramienta de soporte/emergencia, documentando explícitamente quién tiene acceso de `postgres`/dashboard para activarlo.

Esta decisión es del usuario, no la toma este runbook.
