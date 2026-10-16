-- ============================================================================
-- Bizum S5a (part 2): CHECK constraints on orders, NOT VALID + VALIDATE
-- ============================================================================
-- Context: design_bizum_p2p_v2 section 3.1 (M5). APPLIED to the hosted project (version 20261016183529, 2026-10-16).
-- Split from 20261015150000 so the live-table constraint step can be reviewed and applied on its own.
-- Requires 20261015150000_bizum_s5a_quotes_and_order_sealing.sql (the columns) first.
--
-- LIVE-TABLE IMPACT. These constraints are evaluated on EVERY orders write once VALIDATE runs:
--   orders_payment_method_chk  payment_method IN ('zelle', 'bizum') (NULL passes). The design records 28/28
--                              hosted rows as 'zelle'. Re-count before applying: if any other value exists,
--                              VALIDATE fails and the whole file rolls back (the transaction protects you).
--   orders_zelle_clean         a non-bizum row has NO bizum_account_id / payment_* sealed values. Closes
--                              "client inserts a Zelle row with forged amounts"; replaces a trigger.
--   orders_bizum_coherence     a bizum row is fully sealed: account, EUR, amount > 0, rate > 0, USD reference
--                              > 0, concept code, quote, and no zelle_account_id.
--   orders_bizum_proof_path    a bizum proof lives under {uuid}/quotes/ (Bizum's own path; Zelle untouched).
-- ADD CONSTRAINT ... NOT VALID takes a brief lock without scanning; VALIDATE scans with a lighter lock.
-- Pre-flight (expect 0 rows): SELECT payment_method, count(*) FROM public.orders
--   WHERE payment_method IS NOT NULL AND payment_method NOT IN ('zelle', 'bizum') GROUP BY 1;
--
-- Idempotent: each constraint is added only when missing; VALIDATE on a valid constraint is a no-op.
--
-- ROLLBACK (exact inverse)
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_bizum_proof_path;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_zelle_clean;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_bizum_coherence;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_chk;
-- ============================================================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'orders_payment_method_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payment_method_chk CHECK (payment_method IN ('zelle', 'bizum')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'orders_zelle_clean' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_zelle_clean CHECK (
        COALESCE(payment_method, '') = 'bizum'
        OR (bizum_account_id IS NULL AND payment_currency IS NULL AND payment_amount IS NULL
            AND payment_usd_reference IS NULL AND payment_fx_rate IS NULL AND payment_fx_rate_id IS NULL
            AND payment_quote_id IS NULL AND payment_concept_code IS NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'orders_bizum_coherence' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_bizum_coherence CHECK (
        COALESCE(payment_method, '') <> 'bizum'
        OR (bizum_account_id IS NOT NULL AND payment_currency = 'EUR' AND payment_amount > 0
            AND payment_fx_rate > 0 AND payment_usd_reference > 0 AND payment_concept_code IS NOT NULL
            AND payment_quote_id IS NOT NULL AND zelle_account_id IS NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'orders_bizum_proof_path' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_bizum_proof_path CHECK (
        COALESCE(payment_method, '') <> 'bizum'
        OR payment_proof_url IS NULL
        OR payment_proof_url ~ '^[0-9a-f-]{36}/quotes/'
      ) NOT VALID;
  END IF;
END
$mig$;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_payment_method_chk;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_zelle_clean;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_bizum_coherence;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_bizum_proof_path;
