-- ============================================================================
-- CHECK + NOT NULL on the state columns (W5b / E1).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: orders.status, orders.payment_status, remittances.status, zelle_transaction_history.status and
--   offers.discount_type accept any text today. A typo or a direct PATCH ('shipped', NULL) leaves a row no
--   screen or RPC knows how to move. The transition RPCs of E4/E5 assume the sets below.
--
-- WHAT: orders.status / payment_status SET NOT NULL + CHECK, remittances.status CHECK (already NOT NULL),
--   zelle_transaction_history.status SET NOT NULL + CHECK, offers.discount_type CHECK.
--   The literals are the JS constants ORDER_STATUS, PAYMENT_STATUS, REMITTANCE_STATUS, ZELLE_STATUS and the two
--   types AdminOffersTab writes (src/tests/unit/statusChecks.migration.test.js fails if they drift).
--
-- Constraints are added validated (not NOT VALID + VALIDATE): production has 31, 27, 42 and 3 rows, so the table
--   scan under ACCESS EXCLUSIVE is instantaneous. The DO block aborts with a readable message if a row outside
--   the sets exists (data may have changed since the analysis); lock_timeout makes the migration fail fast
--   instead of queueing behind a long transaction.
--
-- Safe order: can be applied BEFORE any front deploy (no writer, JS or SQL, uses a value outside the sets).
-- Idempotent (constraints dropped first). Needs the owner's "dale" to apply remotely.
-- ROLLBACK: supabase/rollbacks/20261024100000_status_check_constraints_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad FROM public.orders
   WHERE status IS NULL OR status NOT IN ('pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled')
      OR payment_status IS NULL OR payment_status NOT IN ('pending', 'proof_uploaded', 'validated', 'rejected');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'status_check_constraints: % orders rows outside the allowed status sets', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.remittances
   WHERE status NOT IN ('payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
                        'processing', 'delivered', 'completed', 'cancelled');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'status_check_constraints: % remittances rows outside the allowed status set', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.zelle_transaction_history
   WHERE status IS NULL OR status NOT IN ('pending', 'validated', 'rejected');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'status_check_constraints: % zelle_transaction_history rows outside the allowed status set', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.offers WHERE discount_type NOT IN ('percentage', 'fixed_amount');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'status_check_constraints: % offers rows outside the allowed discount_type set', v_bad;
  END IF;
END
$guard$;

ALTER TABLE public.orders ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN payment_status SET NOT NULL;
ALTER TABLE public.zelle_transaction_history ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'proof_uploaded', 'validated', 'rejected'));

ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_status_check;
ALTER TABLE public.remittances ADD CONSTRAINT remittances_status_check
  CHECK (status IN ('payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
                    'processing', 'delivered', 'completed', 'cancelled'));

ALTER TABLE public.zelle_transaction_history DROP CONSTRAINT IF EXISTS zelle_transaction_history_status_check;
ALTER TABLE public.zelle_transaction_history ADD CONSTRAINT zelle_transaction_history_status_check
  CHECK (status IN ('pending', 'validated', 'rejected'));

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_discount_type_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_discount_type_check
  CHECK (discount_type IN ('percentage', 'fixed_amount'));

COMMIT;
