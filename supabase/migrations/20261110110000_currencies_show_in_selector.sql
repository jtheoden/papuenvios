-- ============================================================================
-- Per-currency "show in selector" flag.
--   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the owner almost always wants CUP out of the public currency selector, but CUP must keep converting, pricing and
--   being eligible when authoring prices. Hiding is a display choice, not deactivation.
-- WHAT: currencies.show_in_selector boolean NOT NULL DEFAULT true (every existing row stays visible), plus a CHECK that
--   the base currency can never be hidden. Additive and reversible. GRANT/RLS on currencies are NOT touched: SELECT is
--   public and writes stay admin-only (currencies_manage), so the flag is written by the same role as is_active.
-- ROLLBACK: supabase/rollbacks/20261110110000_currencies_show_in_selector_down.sql
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.currencies
  ADD COLUMN IF NOT EXISTS show_in_selector boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.currencies.show_in_selector IS
  'false hides the currency from the public selector only; it still converts and prices. The base currency is always visible.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'currencies_base_visible_chk' AND conrelid = 'public.currencies'::regclass
  ) THEN
    ALTER TABLE public.currencies
      ADD CONSTRAINT currencies_base_visible_chk CHECK (NOT is_base OR show_in_selector);
  END IF;
END $$;

COMMIT;
