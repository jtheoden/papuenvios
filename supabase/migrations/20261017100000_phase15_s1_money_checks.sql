-- ============================================================================
-- Phase 1.5 / S1 (audit_phase1_price_tamper.md, patch P1): arithmetic money CHECKs
-- on public.orders and public.remittances.                PREPARED, NOT APPLIED
-- ============================================================================
-- Closes (matrix): T-02 (negative / zero / inconsistent order totals, negative or oversized
-- discount, negative shipping or tax), T-07 / T-08 / T-09 arithmetic part (non-positive amounts and
-- rates, negative commissions, commission percentage out of range, negative remittance discount).
-- It does NOT validate prices against the catalogue or rates against the remittance type: that is
-- S2 (remittances) and the order_items patches (P2, out of scope here). order_items is NOT touched.
--
-- Additive and reversible: 13 CHECK constraints, nothing else. No data is read or changed besides
-- the VALIDATE scan. Idempotent (each ADD is guarded by pg_constraint).
--
-- NULL safety (audit 3.1b): orders.discount_amount / shipping_cost / tax_amount and
-- remittances.discount_amount are NULLable. Every predicate uses COALESCE(col, 0), so a NULL counts as
-- 0 inside the identity (a total that only adds up with a hidden tax is rejected) instead of making
-- the CHECK evaluate to NULL (which PostgreSQL treats as PASS). Columns are NOT set to NOT NULL on
-- purpose: that would break any writer that sends an explicit NULL and needs a table rewrite lock.
--
-- Total identity tolerance: abs(total - (subtotal - discount + shipping + tax)) <= 0.01. The client
-- (priceCalculationService.calculateOrderTotal) rounds every component to cents before combining, so
-- the identity is exact today (unit test: src/tests/unit/orderTotalsCentIdentity.test.js sweeps
-- category %, offers and shipping); the 0.01 slack only protects against a stacked-discount cent drift
-- turning a legitimate checkout into a failure. The attacker's gain is capped at one cent.
-- total_amount > 0 also rejects a legitimate 100%-discount + free-shipping order (no such offer is
-- active in production; see plan_phase15_s1_s2.md, objection D-3).
--
-- Production verification (read-only SELECTs via MCP, 2026-10-17, project qcwnlbpultscerwdnzbm):
--   orders:      31 rows, 0 violate any of the predicates below, 0 rows with NULL discount_amount /
--                shipping_cost / tax_amount.
--   remittances: 27 rows (the audit counted 24; 3 were created since), 0 violate any predicate,
--                0 rows with NULL discount_amount, 0 with commission_total < 0.
--   Predicates were run verbatim, including the 0.01 identity tolerance.
--
-- VALIDATION: each constraint is added NOT VALID (instant) and then VALIDATEd in the final block.
-- If a historical row violates one of them at apply time, VALIDATE raises a WARNING for that
-- constraint and leaves it NOT VALID: it still rejects every new INSERT and every UPDATE of any
-- row, but legacy rows are not scanned. Find leftovers with:
--   SELECT conrelid::regclass, conname FROM pg_constraint WHERE conname LIKE '%\_money\_%' AND NOT convalidated;
-- Re-run the 'ALTER TABLE ... VALIDATE CONSTRAINT <name>' after cleaning the data (owner decision).
--
-- Locks: lock_timeout 5s so the file fails fast instead of queueing behind a long transaction;
-- ADD ... NOT VALID takes a brief ACCESS EXCLUSIVE lock, VALIDATE only SHARE UPDATE EXCLUSIVE.
-- Tables are tiny (31 / 27 rows).
--
-- Preconditions: none beyond the existing orders / remittances tables. Independent of Bizum S5a
-- (orders_bizum_coherence and the sealing trigger are untouched and compatible: the sealed total is
-- a positive USD amount that the client already made consistent).
-- Apply order: S1 first, then S2 (20261017110000). Needs the owner's "dale" to apply remotely.
--
-- ROLLBACK (exact inverse, any subset can be dropped independently):
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_money_total_positive_chk;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_money_subtotal_positive_chk;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_money_tax_nonneg_chk;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_money_shipping_nonneg_chk;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_money_discount_range_chk;
-- ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_money_total_identity_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_amount_sent_positive_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_amount_to_deliver_positive_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_rate_positive_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_commission_total_nonneg_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_commission_fixed_nonneg_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_commission_pct_range_chk;
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_money_discount_nonneg_chk;
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_total_positive_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_money_total_positive_chk CHECK (total_amount > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_subtotal_positive_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_money_subtotal_positive_chk CHECK (subtotal > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_tax_nonneg_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_money_tax_nonneg_chk CHECK (COALESCE(tax_amount, 0) >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_shipping_nonneg_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_money_shipping_nonneg_chk CHECK (COALESCE(shipping_cost, 0) >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_discount_range_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_money_discount_range_chk CHECK (COALESCE(discount_amount, 0) >= 0 AND COALESCE(discount_amount, 0) <= subtotal) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_total_identity_chk' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_money_total_identity_chk CHECK (abs(total_amount - (subtotal - COALESCE(discount_amount, 0) + COALESCE(shipping_cost, 0) + COALESCE(tax_amount, 0))) <= 0.01) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_amount_sent_positive_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_amount_sent_positive_chk CHECK (amount_sent > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_amount_to_deliver_positive_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_amount_to_deliver_positive_chk CHECK (amount_to_deliver > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_rate_positive_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_rate_positive_chk CHECK (exchange_rate > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_commission_total_nonneg_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_commission_total_nonneg_chk CHECK (commission_total >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_commission_fixed_nonneg_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_commission_fixed_nonneg_chk CHECK (commission_fixed >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_commission_pct_range_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_commission_pct_range_chk CHECK (commission_percentage >= 0 AND commission_percentage <= 100) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remittances_money_discount_nonneg_chk' AND conrelid = 'public.remittances'::regclass) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_money_discount_nonneg_chk CHECK (COALESCE(discount_amount, 0) >= 0) NOT VALID;
  END IF;
END $$;

-- Validate everything that can be validated; leave a violated constraint NOT VALID (see header).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('orders', 'orders_money_total_positive_chk'),
    ('orders', 'orders_money_subtotal_positive_chk'),
    ('orders', 'orders_money_tax_nonneg_chk'),
    ('orders', 'orders_money_shipping_nonneg_chk'),
    ('orders', 'orders_money_discount_range_chk'),
    ('orders', 'orders_money_total_identity_chk'),
    ('remittances', 'remittances_money_amount_sent_positive_chk'),
    ('remittances', 'remittances_money_amount_to_deliver_positive_chk'),
    ('remittances', 'remittances_money_rate_positive_chk'),
    ('remittances', 'remittances_money_commission_total_nonneg_chk'),
    ('remittances', 'remittances_money_commission_fixed_nonneg_chk'),
    ('remittances', 'remittances_money_commission_pct_range_chk'),
    ('remittances', 'remittances_money_discount_nonneg_chk')
    ) AS v(tbl, cname)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r.tbl, r.cname);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'phase15 S1: % left NOT VALID (legacy rows violate it)', r.cname;
    END;
  END LOOP;
END $$;
