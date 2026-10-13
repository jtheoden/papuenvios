-- ============================================================================
-- Probes: remittances owner UPDATE guard (migration 20261013170000)
-- ============================================================================
-- DOCUMENTATION / VERIFICATION SCRIPT. NOT a migration. Run AFTER applying
-- 20261013170000_remittances_owner_update_guard.sql. Everything runs inside one
-- transaction that ends with ROLLBACK, so no data is changed.
--
-- HOW TO FILL THE PLACEHOLDERS (replace the three literals in the first
-- set_config block; keep the quotes):
--   probe.owner_id  : auth.users.id of a regular (non-admin) user who OWNS the
--                     remittance below.
--   probe.rem_id    : id of one remittance owned by probe.owner_id whose status is
--                     'payment_pending' (the script moves it through the flows
--                     inside the transaction; the final ROLLBACK restores it).
--   probe.admin_id  : auth.users.id of an admin / super_admin user.
-- Find candidates with (as postgres):
--   SELECT id, user_id, status FROM public.remittances WHERE status = 'payment_pending' LIMIT 5;
--   SELECT id FROM public.user_profiles WHERE role IN ('admin', 'super_admin') LIMIT 3;
--
-- Reading the output: every probe ends with a NOTICE "PASS: ..."; any
-- "FAIL: ..." is raised as an EXCEPTION and aborts the script (then ROLLBACK).
-- ============================================================================

BEGIN;

SELECT set_config('probe.owner_id', '00000000-0000-0000-0000-000000000000', true);  -- FILL
SELECT set_config('probe.rem_id',   '00000000-0000-0000-0000-000000000000', true);  -- FILL
SELECT set_config('probe.admin_id', '00000000-0000-0000-0000-000000000000', true);  -- FILL

-- Helpers live in pg_temp (created as the connecting superuser role, before the role switch).
CREATE FUNCTION pg_temp.expect_denied(p_label text, p_stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_stmt;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: % -> denied (%).', p_label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % -> the UPDATE SUCCEEDED but must be denied', p_label;
END;
$$;

CREATE FUNCTION pg_temp.expect_ok(p_label text, p_stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_stmt;
  RAISE NOTICE 'PASS: % -> allowed.', p_label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL: % -> expected success but got: % (%)', p_label, SQLERRM, SQLSTATE;
END;
$$;

-- Impersonate the OWNER (authenticated role + JWT claims)
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.owner_id'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('probe.owner_id'), true);
SET LOCAL ROLE authenticated;

-- Sanity: the impersonation works and the owner sees the row
DO $$
BEGIN
  IF auth.uid()::text <> current_setting('probe.owner_id') THEN
    RAISE EXCEPTION 'FAIL: impersonation did not set auth.uid()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.remittances
                 WHERE id = current_setting('probe.rem_id')::uuid AND status = 'payment_pending') THEN
    RAISE EXCEPTION 'FAIL: probe.rem_id is not a payment_pending remittance owned by probe.owner_id';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- A. EXPECTED DENIED (SQLSTATE 42501 remittance_owner_update_forbidden)
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_denied('self-validate payment (payment_validated=true)',
  format('UPDATE public.remittances SET payment_validated = true WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('set status to payment_validated',
  format('UPDATE public.remittances SET status = %L WHERE id = %L', 'payment_validated', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('set status to completed',
  format('UPDATE public.remittances SET status = %L WHERE id = %L', 'completed', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('change amount_sent',
  format('UPDATE public.remittances SET amount_sent = amount_sent + 1 WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('change amount_to_deliver',
  format('UPDATE public.remittances SET amount_to_deliver = amount_to_deliver * 2 WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('change exchange_rate directly',
  format('UPDATE public.remittances SET exchange_rate = exchange_rate * 2 WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('change commission_total',
  format('UPDATE public.remittances SET commission_total = 0 WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('change delivery_cost',
  format('UPDATE public.remittances SET delivery_cost = 0 WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('change recipient_name',
  format('UPDATE public.remittances SET recipient_name = %L WHERE id = %L', 'Attacker', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('forge cancelled_at without cancelling',
  format('UPDATE public.remittances SET cancelled_at = now() WHERE id = %L', current_setting('probe.rem_id')));

SELECT pg_temp.expect_denied('forge payment_validated_by',
  format('UPDATE public.remittances SET payment_validated_by = %L WHERE id = %L', current_setting('probe.owner_id'), current_setting('probe.rem_id')));

-- ---------------------------------------------------------------------------
-- B. EXPECTED ALLOWED (legitimate owner flows)
--    Order matters: the RPC only works in payment_pending / payment_rejected.
-- ---------------------------------------------------------------------------
-- B1. RPC recalculation (replaces the old client-side money UPDATE)
DO $$
DECLARE r public.remittances;
BEGIN
  r := public.recalculate_remittance_at_current_rate(current_setting('probe.rem_id')::uuid);
  IF r.id IS DISTINCT FROM current_setting('probe.rem_id')::uuid THEN
    RAISE EXCEPTION 'FAIL: RPC did not return the remittance';
  END IF;
  RAISE NOTICE 'PASS: RPC recalculate -> allowed (exchange_rate=%, amount_to_deliver=%).', r.exchange_rate, r.amount_to_deliver;
END $$;

-- B2. Upload-proof style update (uploadPaymentProof)
SELECT pg_temp.expect_ok('upload proof (proof columns + status payment_proof_uploaded)',
  format($q$UPDATE public.remittances
            SET payment_proof_url = %L, payment_reference = %L, payment_proof_notes = %L,
                payer_phone = %L, payment_proof_uploaded_at = now(),
                status = 'payment_proof_uploaded', updated_at = now()
            WHERE id = %L$q$,
         'probe/proof.png', 'PROBE-REF', 'probe', '+15551234567', current_setting('probe.rem_id')));

-- B3. Proof columns are frozen once the proof is uploaded (status no longer open)
SELECT pg_temp.expect_denied('replace proof after upload (status payment_proof_uploaded)',
  format('UPDATE public.remittances SET payment_proof_url = %L WHERE id = %L', 'probe/other.png', current_setting('probe.rem_id')));

-- B4. RPC is refused once the status is no longer payment_pending / payment_rejected
DO $$
BEGIN
  BEGIN
    PERFORM public.recalculate_remittance_at_current_rate(current_setting('probe.rem_id')::uuid);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE NOTICE 'PASS: RPC refused for payment_proof_uploaded status.';
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: RPC accepted a payment_proof_uploaded remittance';
END $$;

-- B5. Cancel style update (cancelRemittance), from payment_proof_uploaded
SELECT pg_temp.expect_ok('cancel (status cancelled + cancelled_* + reason)',
  format($q$UPDATE public.remittances
            SET status = 'cancelled', cancelled_at = now(), cancelled_by = %L,
                cancellation_reason = %L, updated_at = now()
            WHERE id = %L$q$,
         current_setting('probe.owner_id')::uuid, 'probe', current_setting('probe.rem_id')));

-- B6. A cancelled remittance cannot be revived by the owner
SELECT pg_temp.expect_denied('revive cancelled remittance (status payment_pending)',
  format('UPDATE public.remittances SET status = %L WHERE id = %L', 'payment_pending', current_setting('probe.rem_id')));

-- B7. A non-owner authenticated user cannot call the RPC on someone else's remittance
-- (covered by RLS visibility + the explicit owner check; run manually with another user id if desired)

-- ---------------------------------------------------------------------------
-- C. ADMIN session: the guard must not block admin flows
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('probe.admin_id'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', current_setting('probe.admin_id'), true);

SELECT pg_temp.expect_ok('admin changes status and payment_validated',
  format($q$UPDATE public.remittances
            SET status = 'payment_validated', payment_validated = true,
                payment_validated_at = now(), payment_validated_by = %L
            WHERE id = %L$q$,
         current_setting('probe.admin_id')::uuid, current_setting('probe.rem_id')));

RESET ROLE;

ROLLBACK;
