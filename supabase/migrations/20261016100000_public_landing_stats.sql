-- ============================================================================
-- get_public_landing_stats(): aggregate-only counters for the public landing page
-- ============================================================================
-- APPLIED to the hosted project (as public_landing_stats, 2026-10-16).
--
-- Problem: the home page computed its counters with direct reads of user_profiles, remittances and
-- orders. anon has no privileges on those tables (401/42501 -> the visitor saw zeros) and a logged-in
-- customer only sees their own rows through RLS (wrong figures).
--
-- Fix: one SECURITY DEFINER function that returns ONLY four integers:
--   users                  count of user_profiles
--   remittances_completed  remittances with status IN ('delivered', 'completed')
--   orders_completed       orders with status = 'completed'
--   first_year             year of the oldest created_at among orders and remittances (NULL if none)
-- The statuses mirror COMPLETED_REMITTANCE_STATUSES / COMPLETED_ORDER_STATUS in HomePage.jsx.
-- No rows, ids, full dates or personal data leave the function.
--
-- This is the ONLY function where anon is granted EXECUTE on purpose: the landing page is public and
-- the output is non-sensitive aggregates. EXECUTE is revoked from PUBLIC and granted explicitly to
-- anon and authenticated; the base tables keep their current (no anon) privileges.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the front end that calls the RPC. Until then
-- the new front hides the counters block (it does not show zeros).
--
-- Idempotent (CREATE OR REPLACE; REVOKE / GRANT are repeatable).
--
-- ROLLBACK (exact inverse)
-- DROP FUNCTION IF EXISTS public.get_public_landing_stats();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_landing_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM public.user_profiles)::int,
    'remittances_completed',
      (SELECT count(*) FROM public.remittances WHERE status IN ('delivered', 'completed'))::int,
    'orders_completed', (SELECT count(*) FROM public.orders WHERE status = 'completed')::int,
    'first_year', (
      SELECT extract(year FROM min(d))::int
        FROM (
          SELECT min(created_at) AS d FROM public.orders
          UNION ALL
          SELECT min(created_at) AS d FROM public.remittances
        ) earliest
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_landing_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_landing_stats() TO anon, authenticated;
