-- ============================================================================
-- Remittances: an owner may only INSERT a clean, pending remittance
-- ============================================================================
-- Problem (live DB, verified read-only 2026-10-14):
--   * Policy "users can insert remittances" only checks user_id = current_user_id().
--   * The existing guard (guard_remittance_owner_update, 20261013170000) is
--     BEFORE UPDATE only.
--   => An authenticated customer could POST a brand new remittance that is born
--      'payment_validated', 'delivered', 'completed', etc., or with validation /
--      delivery / cancellation data already filled in, skipping the payment flow.
--
-- Fix: a separate BEFORE INSERT trigger (own function, so the UPDATE guard that is
-- already in production is not touched).
--
-- Who is NOT restricted (same bypass as the UPDATE guard):
--   * privileged DB roles (postgres, service_role, supabase_admin)
--   * auth.uid() IS NULL (service role, Edge Functions, pg_cron)
--   * admins / super admins (staff workflow)
--
-- Rules for everyone else (the owner):
--   * status must be 'payment_pending'
--   * payment_validated must be false/NULL
--   * the validation / rejection / processing / delivery / completion /
--     cancellation columns must be NULL
-- createRemittance() in src/lib/remittanceService.js only sends status =
-- 'payment_pending' and none of those columns, so the legitimate flow is unchanged.
--
-- Residual risk (NOT closed here, same as before): amounts, rates and commissions
-- are still computed by the client on INSERT; staff must keep checking them when
-- validating the payment.
--
-- Trigger ordering: BEFORE triggers fire in name order; this one
-- ('guard_remittance_owner_insert') runs before 'guard_reset_lock_remittances' and
-- 'trigger_generate_remittance_number'. It only reads client-sent columns or column
-- defaults and none of the later triggers writes a guarded column.
--
-- No data is read or changed. Idempotent.
--
-- Error: SQLSTATE 42501, message 'remittance_owner_insert_forbidden: ...'.
--
-- Verification (read-only):
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid = 'public.remittances'::regclass AND tgname = 'guard_remittance_owner_insert';
--
-- Rollback:
--   DROP TRIGGER IF EXISTS guard_remittance_owner_insert ON public.remittances;
--   DROP FUNCTION IF EXISTS public.guard_remittance_owner_insert();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_remittance_owner_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  -- Columns an owner can never create pre-filled: they belong to the staff workflow
  c_staff_only constant text[] := ARRAY[
    'payment_validated_at', 'payment_validated_by', 'payment_rejection_reason',
    'delivery_proof_url', 'delivery_notes_admin', 'delivered_to_name',
    'delivered_to_id', 'delivered_at', 'delivered_by',
    'processing_started_at', 'completed_at',
    'cancelled_at', 'cancellation_reason', 'cancelled_by'
  ];
  v_new jsonb;
  v_key text;
BEGIN
  -- Trusted contexts: privileged DB roles, no end-user JWT, admins
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'payment_pending' THEN
    RAISE EXCEPTION 'remittance_owner_insert_forbidden: status' USING ERRCODE = '42501';
  END IF;

  IF NEW.payment_validated IS TRUE THEN
    RAISE EXCEPTION 'remittance_owner_insert_forbidden: payment_validated' USING ERRCODE = '42501';
  END IF;

  v_new := to_jsonb(NEW);
  FOREACH v_key IN ARRAY c_staff_only LOOP
    IF (v_new -> v_key) IS NOT NULL AND (v_new -> v_key) <> 'null'::jsonb THEN
      RAISE EXCEPTION 'remittance_owner_insert_forbidden: %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_remittance_owner_insert ON public.remittances;
CREATE TRIGGER guard_remittance_owner_insert
  BEFORE INSERT ON public.remittances
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_remittance_owner_insert();
