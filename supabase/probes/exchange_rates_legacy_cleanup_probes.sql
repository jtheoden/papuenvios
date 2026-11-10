-- ============================================================================
-- Probes + proposed cleanup: legacy rows in public.exchange_rates
-- ============================================================================
-- DOCUMENTATION / VERIFICATION SCRIPT. NOT a migration. Companion of
-- 20261016140000_fix_rate_functions_and_exchange_rates_constraints.sql.
--
-- Section A is read-only and safe to run any time.
-- Section B is a PROPOSAL: REQUIERE DALE DEL DUEÑO. It is fully commented out, is never executed by the
-- migrations or the test harness, and must be reviewed and uncommented by hand.
-- ============================================================================

-- A1. Rows that violate the new constraints (expected today: only the inactive USD->USD row).
SELECT er.id, fc.code AS from_code, tc.code AS to_code, er.rate, er.is_active, er.effective_date,
       (er.rate <= 0)                               AS violates_rate_positive,
       (er.from_currency_id = er.to_currency_id)    AS violates_distinct_currencies
FROM public.exchange_rates er
JOIN public.currencies fc ON fc.id = er.from_currency_id
JOIN public.currencies tc ON tc.id = er.to_currency_id
WHERE er.rate <= 0 OR er.from_currency_id = er.to_currency_id;

-- A2. Directed pairs with more than one ACTIVE row (must be empty before the unique index can exist).
SELECT from_currency_id, to_currency_id, count(*) AS active_rows
FROM public.exchange_rates
WHERE is_active
GROUP BY 1, 2
HAVING count(*) > 1;

-- A3. Inactive history that looks wrong (inverted or absurd magnitudes). Informational: these rows do not
--     violate any constraint and never conflict with the partial unique index (they are inactive).
SELECT er.id, fc.code AS from_code, tc.code AS to_code, er.rate, er.effective_date
FROM public.exchange_rates er
JOIN public.currencies fc ON fc.id = er.from_currency_id
JOIN public.currencies tc ON tc.id = er.to_currency_id
WHERE NOT er.is_active
ORDER BY fc.code, tc.code, er.effective_date;

-- ============================================================================
-- Section B. PROPOSED CLEANUP. REQUIERE DALE DEL DUEÑO. NEVER EXECUTED AUTOMATICALLY.
-- ============================================================================
-- B1. Remove the inactive self-pair so the distinct-currencies constraint can be validated.
--     Row as read on 2026-10-16: id 614182fb-2fc3-4c6d-9154-449fc28f6c93, USD->USD, rate 1, inactive.
--
-- BEGIN;
--   DELETE FROM public.exchange_rates
--    WHERE id = '614182fb-2fc3-4c6d-9154-449fc28f6c93'
--      AND from_currency_id = to_currency_id
--      AND is_active = false;                       -- expect: DELETE 1
--   ALTER TABLE public.exchange_rates VALIDATE CONSTRAINT exchange_rates_distinct_currencies_chk;
-- COMMIT;
--
-- B2. (Optional, separate decision.) The other inactive rows with inverted / absurd values (A3) can stay: they
--     are history, do not block anything and are not read by any function (all readers filter is_active).
--     Delete them only if the owner wants the history trimmed; prefer keeping an audit trail.
