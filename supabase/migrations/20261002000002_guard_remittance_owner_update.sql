-- Guard: restrict what a remittance owner can insert and change on their own row.
--
-- Root cause (verified read-only against production on 2026-10-02):
--   * Policy "users can update own remittances" on public.remittances is
--     FOR UPDATE TO authenticated USING (user_id = current_user_id())
--     WITH CHECK (user_id = current_user_id()), with no status or column
--     restriction, and "authenticated" holds table-level UPDATE. A logged-in client
--     could set status = 'completed', payment_validated = true, or rewrite amounts
--     on their own remittance straight through PostgREST.
--   * Policy "users can insert remittances" only checks user_id, so the same client
--     could POST a brand new remittance that is already 'payment_validated',
--     'delivered', etc.
--
-- Why a trigger: an RLS WITH CHECK expression only sees the new row, it cannot
-- compare OLD and NEW. A BEFORE row trigger can, and covers INSERT with the same
-- bypass rules.
--
-- Who is NOT restricted (RETURN NEW untouched):
--   * auth.uid() IS NULL  -> service role, postgres, Edge Functions, pg_cron.
--   * is_admin_user() / is_super_admin() -> staff workflow (validate, reject,
--     process, deliver, complete, delivery proof).
--
-- Everyone else reaching this trigger is the owner (RLS already guarantees it).
--
-- INSERT by the owner (createRemittance in src/lib/remittanceService.js):
--   the row must start as status = 'payment_pending', with payment_validated not
--   true and every validation / rejection / processing / delivery / completion /
--   cancellation column NULL. The client never sends any of those columns.
--
-- UPDATE by the owner, derived from every client write to "remittances"
-- (src/lib/remittanceService.js):
--
--   1. Payment proof upload          (uploadPaymentProof)
--        payment_pending | payment_rejected -> payment_proof_uploaded
--        columns: status, payment_proof_url, payment_reference,
--                 payment_proof_notes, payment_proof_uploaded_at
--   2. Owner cancellation            (cancelRemittance)
--        payment_pending | payment_rejected -> cancelled
--        columns: status, cancelled_at, cancellation_reason
--   3. Rate recalculation            (recalculateRemittanceAtCurrentRate)
--        payment_pending | payment_rejected, status unchanged
--        columns: exchange_rate, commission_percentage, commission_fixed,
--                 commission_total, amount_to_deliver
--
-- updated_at is always allowed. An UPDATE that changes nothing else is a no-op and
-- passes. Any other change raises SQLSTATE 42501.
--
-- RESIDUAL RISK (not closed by this migration): amount_sent, exchange_rate,
-- commissions, discount_amount and amount_to_deliver are computed by the client,
-- both on INSERT and on transition 3. Until a payment proof is uploaded, an owner
-- can still store arbitrary amounts / rates on their own remittance; staff must
-- keep checking them when validating the payment. Closing this requires computing
-- those values server-side (RPC or trigger) from remittance_types / exchange_rates.
--
-- Trigger ordering: BEFORE triggers on the same event fire in name order. On INSERT
-- this guard runs before guard_reset_lock_remittances and
-- trigger_generate_remittance_number; it only reads columns sent by the client or
-- filled by column defaults (defaults are applied before any BEFORE trigger), and
-- none of the later triggers writes a guarded column.
--
-- Existing policies and grants are intentionally left untouched.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS guard_remittance_owner_update ON public.remittances;
--   DROP FUNCTION IF EXISTS public.guard_remittance_owner_update();

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_remittance_owner_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_allowed text[];
BEGIN
  -- Service role / postgres / Edge Functions: no end-user JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Staff workflow is governed by the admin policies.
  IF public.is_admin_user() OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- ── INSERT: a new remittance must start clean and pending ──────────────────
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'payment_pending' THEN
      RAISE EXCEPTION
        'A new remittance must start as "payment_pending" (got "%")', NEW.status
        USING ERRCODE = '42501';
    END IF;

    IF NEW.payment_validated IS TRUE
       OR NEW.payment_validated_at IS NOT NULL
       OR NEW.payment_validated_by IS NOT NULL
       OR NEW.payment_rejection_reason IS NOT NULL
       OR NEW.delivery_proof_url IS NOT NULL
       OR NEW.delivery_notes_admin IS NOT NULL
       OR NEW.delivered_to_name IS NOT NULL
       OR NEW.delivered_to_id IS NOT NULL
       OR NEW.delivered_at IS NOT NULL
       OR NEW.delivered_by IS NOT NULL
       OR NEW.processing_started_at IS NOT NULL
       OR NEW.completed_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL
       OR NEW.cancellation_reason IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL THEN
      RAISE EXCEPTION
        'A new remittance cannot be created with validation, processing, delivery or cancellation data'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- ── UPDATE ─────────────────────────────────────────────────────────────────
  -- No-op update (only updated_at, or nothing at all, changed).
  IF (to_jsonb(NEW) - 'updated_at'::text) IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updated_at'::text) THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('payment_pending', 'payment_rejected')
     AND NEW.status = 'payment_proof_uploaded' THEN
    -- 1. Payment proof upload
    v_allowed := ARRAY[
      'status',
      'payment_proof_url',
      'payment_reference',
      'payment_proof_notes',
      'payment_proof_uploaded_at',
      'updated_at'
    ];
  ELSIF OLD.status IN ('payment_pending', 'payment_rejected')
     AND NEW.status = 'cancelled' THEN
    -- 2. Owner cancellation
    v_allowed := ARRAY[
      'status',
      'cancelled_at',
      'cancellation_reason',
      'updated_at'
    ];
  ELSIF NEW.status = OLD.status
     AND OLD.status IN ('payment_pending', 'payment_rejected') THEN
    -- 3. Rate recalculation before payment
    v_allowed := ARRAY[
      'exchange_rate',
      'commission_percentage',
      'commission_fixed',
      'commission_total',
      'amount_to_deliver',
      'updated_at'
    ];
  ELSE
    RAISE EXCEPTION
      'Remittance owner cannot change status from "%" to "%"', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION
      'Remittance owner update touches columns that are not allowed for this transition (status "%" -> "%")',
      OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_remittance_owner_update() IS
  'BEFORE INSERT OR UPDATE guard on remittances. Non-admin owners may only insert a clean payment_pending remittance and, while it is payment_pending/payment_rejected, upload a payment proof, cancel, or recalculate the rate. Service role and admins bypass.';

DROP TRIGGER IF EXISTS guard_remittance_owner_update ON public.remittances;
CREATE TRIGGER guard_remittance_owner_update
  BEFORE INSERT OR UPDATE ON public.remittances
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_remittance_owner_update();

COMMIT;
