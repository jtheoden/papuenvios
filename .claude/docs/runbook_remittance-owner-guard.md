# Runbook: guard de actualización de remesas por el propietario + fix de activity_logs

Verificación manual y rollback de las migraciones:

- `supabase/migrations/20261002000001_fix_activity_logs_redact_pii_definer.sql`
- `supabase/migrations/20261002000002_guard_remittance_owner_update.sql`

**Estado**: migraciones escritas, **NO aplicadas a Supabase remoto**. Aplicarlas requiere confirmación explícita del propietario del proyecto. Los scripts de este documento se ejecutan **después** de aplicarlas, en el SQL Editor de Supabase o con `psql` como `postgres`.

Todos los bloques de verificación van envueltos en `BEGIN … ROLLBACK`: no dejan cambios en la base de datos.

> **Cómo leer los resultados**: en los bloques "bloqueados" el resultado válido es un `ERROR` con SQLSTATE `42501` emitido por el guard. Si un `UPDATE` devuelve **`UPDATE 0`** en lugar de un error (o de la fila esperada en los bloques permitidos), los UUID no coinciden: RLS filtró la fila antes de que el trigger se ejecutara (la remesa no pertenece al `sub` indicado, o el id no existe). En ese caso **la comprobación no es válida** y hay que repetirla con identificadores correctos.

## Riesgo residual (no cubierto por estas migraciones)

Los montos y la tasa (`amount_sent`, `exchange_rate`, comisiones, `discount_amount`, `amount_to_deliver`) los calcula el cliente, tanto al crear la remesa (INSERT) como en la transición de recálculo de tasa. Mientras la remesa esté en `payment_pending` o `payment_rejected`, el propietario puede seguir guardando montos o tasas arbitrarios en su propia remesa. El guard solo impide modificarlos una vez subido el comprobante. Cerrar este riesgo requiere calcular esos valores en el servidor (RPC o trigger a partir de `remittance_types` / `exchange_rates`); hasta entonces, el personal debe seguir contrastando los montos al validar el pago.

## Qué permite el guard a un propietario no-admin

**INSERT**: la remesa debe nacer con `status = 'payment_pending'`, `payment_validated` distinto de `true`, y con `NULL` en `payment_validated_at`, `payment_validated_by`, `payment_rejection_reason`, `delivery_proof_url`, `delivery_notes_admin`, `delivered_to_name`, `delivered_to_id`, `delivered_at`, `delivered_by`, `processing_started_at`, `completed_at`, `cancelled_at`, `cancellation_reason`, `cancelled_by`.

**UPDATE**:

| # | Transición | Estado origen | Estado destino | Columnas permitidas (además de `updated_at`) |
|---|------------|---------------|----------------|-----------------------------------------------|
| 1 | Subida de comprobante de pago | `payment_pending`, `payment_rejected` | `payment_proof_uploaded` | `status`, `payment_proof_url`, `payment_reference`, `payment_proof_notes`, `payment_proof_uploaded_at` |
| 2 | Cancelación | `payment_pending`, `payment_rejected` | `cancelled` | `status`, `cancelled_at`, `cancellation_reason` |
| 3 | Recalcular tasa | `payment_pending`, `payment_rejected` | (sin cambio) | `exchange_rate`, `commission_percentage`, `commission_fixed`, `commission_total`, `amount_to_deliver` |

Cualquier otro cambio hecho por un propietario no-admin falla con SQLSTATE `42501`. Service role (`auth.uid() IS NULL`), `admin` y `super_admin` no están restringidos por el guard.

## Preparación

Elegir los identificadores a usar en las pruebas (solo lectura):

```sql
-- Una remesa en payment_pending y su propietario (usuario no-admin)
SELECT r.id AS remittance_id, r.user_id AS owner_id, r.status
FROM public.remittances r
JOIN public.user_profiles p ON p.id = r.user_id
WHERE r.status = 'payment_pending' AND p.role = 'user'
ORDER BY r.created_at DESC
LIMIT 5;

-- Una remesa en payment_proof_uploaded (o posterior) de un usuario no-admin
SELECT r.id AS remittance_id, r.user_id AS owner_id, r.status
FROM public.remittances r
JOIN public.user_profiles p ON p.id = r.user_id
WHERE r.status NOT IN ('payment_pending', 'payment_rejected', 'cancelled') AND p.role = 'user'
ORDER BY r.created_at DESC
LIMIT 5;

-- Un administrador
SELECT id AS admin_id, role FROM public.user_profiles WHERE role IN ('admin', 'super_admin') LIMIT 5;
```

Si no existe ninguna remesa en `payment_pending`, se puede preparar una dentro de la misma transacción de prueba (como `postgres`, antes del `SET LOCAL role`) con `UPDATE public.remittances SET status = 'payment_pending' WHERE id = '<remittance uuid>';` — el `ROLLBACK` final lo revierte.

Reemplazar `<owner uuid>`, `<pending remittance uuid>`, `<later remittance uuid>`, `<later owner uuid>` y `<admin uuid>` en los bloques siguientes.

## 1. Verificar que los objetos existen

```sql
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.remittances'::regclass AND NOT tgisinternal
ORDER BY tgname;
-- Debe incluir guard_remittance_owner_update ... BEFORE INSERT OR UPDATE ... FOR EACH ROW

SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE oid IN (
  'public.guard_remittance_owner_update()'::regprocedure,
  'public.activity_logs_redact_pii()'::regprocedure
);
-- guard_remittance_owner_update: prosecdef = false, proconfig = {search_path=public}
-- activity_logs_redact_pii:      prosecdef = true,  proconfig = {"search_path=public, pg_temp"}
```

## 2. Propietario: actualización permitida (subida de comprobante)

```sql
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';

UPDATE public.remittances
SET payment_proof_url = 'runbook/test-proof.jpg',
    payment_reference = 'RUNBOOK-TEST',
    payment_proof_notes = 'runbook verification',
    payment_proof_uploaded_at = now(),
    status = 'payment_proof_uploaded',
    updated_at = now()
WHERE id = '<pending remittance uuid>'
RETURNING id, status, payment_reference;
-- Esperado: 1 fila, status = payment_proof_uploaded

ROLLBACK;
```

## 3. Propietario: actualizaciones bloqueadas

Cada bloque debe terminar con `ERROR: ... (SQLSTATE 42501)`. Tras un error la transacción queda abortada; ejecutar el `ROLLBACK` igualmente.

```sql
-- 3a. Saltar directamente a completed
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';
UPDATE public.remittances SET status = 'completed' WHERE id = '<pending remittance uuid>';
ROLLBACK;

-- 3b. Auto-validarse el pago
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';
UPDATE public.remittances SET payment_validated = true WHERE id = '<pending remittance uuid>';
ROLLBACK;

-- 3c. Colar un cambio de monto dentro de una subida de comprobante
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';
UPDATE public.remittances
SET status = 'payment_proof_uploaded',
    payment_proof_url = 'runbook/test-proof.jpg',
    amount_to_deliver = amount_to_deliver * 10
WHERE id = '<pending remittance uuid>';
ROLLBACK;

-- 3d. Cambiar amount_to_deliver cuando ya hay comprobante (o estado posterior)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<later owner uuid>","role":"authenticated"}';
UPDATE public.remittances
SET amount_to_deliver = amount_to_deliver * 10
WHERE id = '<later remittance uuid>';
ROLLBACK;

-- 3e. Cambiar amount_sent en payment_pending (no forma parte del recálculo de tasa)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';
UPDATE public.remittances SET amount_sent = amount_sent + 1 WHERE id = '<pending remittance uuid>';
ROLLBACK;
```

Nota: cambiar **solo** `amount_to_deliver` / `exchange_rate` / comisiones en una remesa `payment_pending` o `payment_rejected` está permitido (transición 3, usada por "Recalcular tasa" en Mis Remesas). Esos valores ya los calcula el cliente al crear la remesa; el guard cierra la ventana a partir de la subida del comprobante.

## 3-bis. Propietario: INSERT bloqueado

El bloque copia una remesa existente del propio usuario cambiando solo los campos bajo prueba, para no depender de los valores obligatorios de cada columna. `remittance_number` se deja en `NULL` para que lo genere su trigger. Cada bloque debe terminar con `ERROR ... (SQLSTATE 42501)` emitido por el guard. Si el error es otro (NOT NULL, FK, RLS), la comprobación no es válida.

```sql
-- 3f. Crear una remesa ya validada
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';
INSERT INTO public.remittances
SELECT (jsonb_populate_record(
  NULL::public.remittances,
  to_jsonb(r)
    - 'id' - 'remittance_number' - 'created_at' - 'updated_at'
    || jsonb_build_object('id', gen_random_uuid(), 'status', 'payment_validated', 'payment_validated', true)
)).*
FROM public.remittances r
WHERE r.id = '<pending remittance uuid>';
ROLLBACK;

-- 3g. Crear una remesa pendiente pero con datos de entrega ya rellenados
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<owner uuid>","role":"authenticated"}';
INSERT INTO public.remittances
SELECT (jsonb_populate_record(
  NULL::public.remittances,
  to_jsonb(r)
    - 'id' - 'remittance_number' - 'created_at' - 'updated_at'
    || jsonb_build_object('id', gen_random_uuid(), 'status', 'payment_pending', 'delivered_at', now())
)).*
FROM public.remittances r
WHERE r.id = '<pending remittance uuid>';
ROLLBACK;
```

Si alguno de estos `INSERT` devuelve `INSERT 0 0`, el `SELECT` origen no encontró la fila (UUID incorrecto o filtrada por RLS): la comprobación no es válida.

Comprobación positiva (INSERT permitido): crear una remesa de prueba desde la aplicación con un usuario no-admin y confirmar que el flujo de envío sigue funcionando de extremo a extremo; es la única prueba que ejercita exactamente las columnas que envía `createRemittance`.

## 4. Administrador: actualización permitida

```sql
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<admin uuid>","role":"authenticated"}';

UPDATE public.remittances
SET status = 'payment_validated',
    payment_validated = true,
    payment_validated_at = now(),
    payment_validated_by = '<admin uuid>',
    updated_at = now()
WHERE id = '<later remittance uuid>'
RETURNING id, status, payment_validated;
-- Esperado: 1 fila actualizada, sin error

ROLLBACK;
```

## 5. activity_logs: el INSERT de un usuario autenticado vuelve a funcionar

```sql
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<admin uuid>","role":"authenticated"}';

INSERT INTO public.activity_logs (action, entity_type, performed_by, description, metadata)
VALUES ('runbook_check', 'remittance', 'runbook', 'contact someone@example.com',
        '{"note":"mail someone@example.com"}'::jsonb)
RETURNING action, description, metadata;
-- Esperado: 1 fila, con [REDACTED_EMAIL] en description y metadata.
-- Antes del fix: ERROR permission denied for function redact_pii_jsonb (42501).

ROLLBACK;
```

Si el INSERT falla por una policy de RLS (y no por `redact_pii_jsonb`), revisar las policies de `activity_logs` para el rol usado; ese sería un problema distinto al que corrige esta migración.

## Efectos esperados tras aplicar

- Los navegadores de administradores pueden tener eventos de auditoría encolados localmente desde 2026-08-07 (`activityLogger` encola los rechazos `42501`). Tras el fix, el siguiente evento registrado con éxito dispara el reenvío de esa cola: pueden aparecer filas antiguas con `created_at` actual.
- La sincronización de `zelle_transaction_history` al validar/rechazar remesas vuelve a ejecutarse (cambio de código, no depende de la migración).

## Rollback

```sql
BEGIN;

-- Fix 2
DROP TRIGGER IF EXISTS guard_remittance_owner_update ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_remittance_owner_update();

-- Fix 1 (vuelve a dejar roto el logging desde cliente; usar solo si SECURITY DEFINER causa un problema)
ALTER FUNCTION public.activity_logs_redact_pii() SECURITY INVOKER;

COMMIT;
```
