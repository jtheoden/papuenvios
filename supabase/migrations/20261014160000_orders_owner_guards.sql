-- ============================================================================
-- F-1: Owner write guards for public.orders
-- ============================================================================
-- Problem
--   orders_update is USING (user_id = auth.uid() OR is_admin_user()) with no
--   WITH CHECK and `authenticated` holds UPDATE, so an owner can PATCH any
--   column (payment_status, status, total_amount, payment_method,
--   zelle_account_id, user_id, ...). orders_insert only checks
--   user_id = auth.uid(), so an owner can also insert a pre-validated order.
--
-- Approach (same pattern as guard_remittance_owner_update / _insert)
--   BEFORE UPDATE / BEFORE INSERT row triggers, SECURITY INVOKER, with
--   whitelist semantics for owners. Bypassed for:
--     - postgres / service_role / supabase_admin (edge functions, migrations,
--       and any definer-owned RPC / trigger, where current_user is the owner)
--     - auth.uid() IS NULL (no end-user JWT: cron, server-side jobs)
--     - admins / super admins (public.is_admin_user(), public.is_super_admin())
--
-- Owner write paths that must keep working (evidence from the frontend)
--   INSERT  src/lib/orderService.js createOrder (insert at ~L324), called from
--           src/components/CartPage.jsx (~L722). status/payment_status = pending.
--   UPDATE  uploadPaymentProof (orderService.js ~L1591-1606): payment_proof_url,
--           payment_reference, payment_status -> proof_uploaded,
--           rejection_reason -> NULL, updated_at. Requires status = pending.
--   UPDATE  cancelOrderByUser (orderService.js ~L2147-2152): status
--           pending -> cancelled, payment_status -> rejected, rejection_reason,
--           updated_at.
--   UPDATE  reopenOrder (orderService.js ~L2266-2272): status
--           cancelled -> pending, payment_status -> pending, updated_at.
--           (The same call also sends cancelled_by / cancelled_at /
--           cancellation_reason, which are NOT columns of public.orders; that
--           request already fails at PostgREST today, independent of this guard.)
--   No SQL function updates public.orders (checked against pg_proc), and the
--   edge functions never touch the table.
--
-- Trigger ordering (BEFORE row triggers fire in alphabetical order by name)
--   INSERT : guard_orders_owner_insert  (this migration, fires first)
--            guard_reset_lock_orders    (platform reset advisory lock)
--            trigger_set_order_number
--   UPDATE : guard_orders_owner_update  (this migration, fires first)
--            trigger_update_orders_updated_at
--   AFTER  : audit_order_status (unchanged; only runs if the guard allowed it)
--   The guards deliberately sort before the existing triggers so that a
--   rejected write never takes the platform-reset shared lock nor consumes
--   side effects, and they see the exact payload the client sent.
--
-- Known limit (documented, not solved here)
--   total_amount / subtotal / prices are still client-supplied on INSERT;
--   proper fix needs server-side recomputation from order_items.
--
-- ROLLBACK (exact inverse; safe to run at any time)
-- DROP TRIGGER IF EXISTS guard_orders_owner_update ON public.orders;
-- DROP TRIGGER IF EXISTS guard_orders_owner_insert ON public.orders;
-- DROP FUNCTION IF EXISTS public.guard_orders_owner_update();
-- DROP FUNCTION IF EXISTS public.guard_orders_owner_insert();
-- ============================================================================

-- ----------------------------------------------------------------------------
-- UPDATE guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_orders_owner_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  c_allowed constant text[] := ARRAY[
    'payment_proof_url', 'payment_reference', 'payment_status',
    'rejection_reason', 'status', 'updated_at'
  ];
  c_proof constant text[] := ARRAY['payment_proof_url', 'payment_reference'];
  v_new jsonb;
  v_old jsonb;
  v_key text;
  v_cancel boolean := false;
  v_reopen boolean := false;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);

  -- 1. Any column outside the whitelist must stay untouched.
  FOR v_key IN
    SELECT k FROM jsonb_object_keys(v_new) AS k WHERE k <> ALL (c_allowed)
  LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
      RAISE EXCEPTION 'orders_owner_update_forbidden: column %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- 2. status: only pending -> cancelled and cancelled -> pending (reopen).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'cancelled'
       AND OLD.payment_status IS DISTINCT FROM 'validated' THEN
      v_cancel := true;
    ELSIF OLD.status = 'cancelled' AND NEW.status = 'pending'
       AND OLD.payment_status IN ('pending', 'rejected', 'proof_uploaded') THEN
      v_reopen := true;
    ELSE
      RAISE EXCEPTION 'orders_owner_update_forbidden: column status' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. payment_status: owners can only move to proof_uploaded (proof upload),
  --    rejected (together with cancelling) or pending (together with reopening).
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF v_cancel AND NEW.payment_status = 'rejected' THEN
      NULL;
    ELSIF v_reopen AND NEW.payment_status = 'pending' THEN
      NULL;
    ELSIF NOT v_cancel AND NOT v_reopen
       AND OLD.status = 'pending'
       AND OLD.payment_status IN ('pending', 'rejected')
       AND NEW.payment_status = 'proof_uploaded' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'orders_owner_update_forbidden: column payment_status' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Proof fields: only while the order is pending and the update leaves it
  --    in proof_uploaded.
  FOREACH v_key IN ARRAY c_proof LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key)
       AND NOT (
         OLD.status = 'pending' AND NEW.status = 'pending'
         AND OLD.payment_status IN ('pending', 'rejected', 'proof_uploaded')
         AND NEW.payment_status = 'proof_uploaded'
       ) THEN
      RAISE EXCEPTION 'orders_owner_update_forbidden: column %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- 5. rejection_reason: free text on cancel, or cleared by a proof upload.
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     AND NOT (
       v_cancel
       OR (
         NEW.rejection_reason IS NULL
         AND OLD.status = 'pending' AND NEW.status = 'pending'
         AND NEW.payment_status = 'proof_uploaded'
       )
     ) THEN
    RAISE EXCEPTION 'orders_owner_update_forbidden: column rejection_reason' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_owner_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_orders_owner_update ON public.orders;
CREATE TRIGGER guard_orders_owner_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_orders_owner_update();

-- ----------------------------------------------------------------------------
-- INSERT guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_orders_owner_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  c_staff_only constant text[] := ARRAY[
    'validated_by', 'validated_at', 'rejection_reason',
    'delivered_at', 'delivery_notes', 'delivery_proof_url',
    'processing_started_at', 'shipped_at', 'completed_at',
    'dispatched_by', 'dispatched_at', 'actual_delivery',
    'tracking_number', 'admin_notes'
  ];
  v_new jsonb;
  v_key text;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'orders_owner_insert_forbidden: user_id' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'orders_owner_insert_forbidden: status' USING ERRCODE = '42501';
  END IF;

  IF NEW.payment_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'orders_owner_insert_forbidden: payment_status' USING ERRCODE = '42501';
  END IF;

  v_new := to_jsonb(NEW);
  FOREACH v_key IN ARRAY c_staff_only LOOP
    IF (v_new -> v_key) IS NOT NULL AND (v_new -> v_key) <> 'null'::jsonb THEN
      RAISE EXCEPTION 'orders_owner_insert_forbidden: %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_owner_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_orders_owner_insert ON public.orders;
CREATE TRIGGER guard_orders_owner_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_orders_owner_insert();
