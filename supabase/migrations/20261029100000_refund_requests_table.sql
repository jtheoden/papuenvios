-- ============================================================================
-- Refunds queue (1/4): public.refund_requests.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: an order or remittance cancelled after the customer already paid (or uploaded a proof the admin has not verified yet)
--   creates a manual refund obligation (Zelle). Today nothing records it. "Paid" cannot be derived after the fact (the owner's
--   cancel overwrites orders.payment_status with 'rejected'), so the request is captured at cancellation time (migration 3/4).
--
-- WHAT: one row per refund obligation, written only by SECURITY DEFINER code (trigger + admin_resolve_refund):
--   * exactly one of order_id / remittance_id; both FKs ON DELETE CASCADE so execute_platform_reset keeps working;
--   * eligible_at = cancelled_at + 48 h (no refund before it), due_at = 5 business days after eligible_at (stored: the promise
--     to the customer must not move if the policy changes);
--   * at most ONE open ('pending') request per operation (partial unique indexes); cancel -> reopen -> cancel again = new row;
--   * RLS on, SELECT for admins only, no write grant to any API role.
--
-- Before applying remotely: re-run the count of cancelled orders/remittances (plan_refunds-queue-data.md, section 6 E1). Today
--   it is 0; if it is > 0 a manual backfill is needed. Applying remotely needs the owner's explicit "dale".
-- ROLLBACK: supabase/rollbacks/20261029100000_refund_requests_table_down.sql (export the rows first).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  remittance_id       uuid REFERENCES public.remittances(id) ON DELETE CASCADE,
  operation_type      text GENERATED ALWAYS AS (CASE WHEN order_id IS NOT NULL THEN 'order' ELSE 'remittance' END) STORED,
  -- Snapshot of the customer; no FK so deleting a user never blocks on (or erases) a refund liability.
  user_id             uuid NOT NULL,
  payment_evidence    text NOT NULL CHECK (payment_evidence IN ('validated', 'proof_unverified')),
  amount              numeric(10,2) NOT NULL CHECK (amount > 0),
  currency            text NOT NULL DEFAULT 'USD',
  payment_method      text NOT NULL,
  zelle_account_id    uuid,
  payment_reference   text,
  payer_phone         text,
  cancellation_reason text,
  cancelled_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_by        uuid,
  cancelled_by_role   text CHECK (cancelled_by_role IN ('customer', 'admin', 'system')),
  eligible_at         timestamptz NOT NULL,
  due_at              timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'refunded', 'not_applicable')),
  refund_reference    text,
  refunded_at         timestamptz,
  resolution_reason   text,
  resolved_by         uuid,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_requests_one_operation CHECK ((order_id IS NULL) <> (remittance_id IS NULL)),
  CONSTRAINT refund_requests_window_order CHECK (eligible_at >= cancelled_at AND due_at > eligible_at),
  CONSTRAINT refund_requests_resolved_has_stamp CHECK (status = 'pending' OR resolved_at IS NOT NULL),
  -- The 48 h hold itself is enforced in admin_resolve_refund (now() is not immutable, so not a CHECK).
  CONSTRAINT refund_requests_refunded_has_reference
    CHECK (status <> 'refunded' OR (refund_reference IS NOT NULL AND refunded_at IS NOT NULL)),
  CONSTRAINT refund_requests_not_applicable_has_reason
    CHECK (status <> 'not_applicable' OR char_length(btrim(resolution_reason)) BETWEEN 1 AND 500)
);

COMMENT ON TABLE public.refund_requests IS
  'Manual refund obligations created when a paid (or proof-uploaded) order/remittance is cancelled. Written only by the '
  'refund_request_on_cancel / refund_request_on_reopen triggers and admin_resolve_refund; read by admins.';

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_open_order_uniq
  ON public.refund_requests (order_id) WHERE status = 'pending' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_open_remittance_uniq
  ON public.refund_requests (remittance_id) WHERE status = 'pending' AND remittance_id IS NOT NULL;
-- The ON DELETE CASCADE lookups and the queue.
CREATE INDEX IF NOT EXISTS refund_requests_order_idx ON public.refund_requests (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_requests_remittance_idx ON public.refund_requests (remittance_id) WHERE remittance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_requests_open_queue_idx
  ON public.refund_requests (eligible_at, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS refund_requests_user_idx ON public.refund_requests (user_id);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.refund_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.refund_requests TO authenticated;

DROP POLICY IF EXISTS refund_requests_admin_select ON public.refund_requests;
CREATE POLICY refund_requests_admin_select ON public.refund_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

COMMIT;
