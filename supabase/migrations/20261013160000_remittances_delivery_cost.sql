-- ============================================================================
-- Remittances: delivery cost for cash deliveries (client observation #6, PR-09)
-- ============================================================================
-- Rationale (decision D2):
--   The delivery cost of a CASH remittance is ADDED to what the sender pays
--   (total = amount_sent + delivery_cost). It is never deducted from
--   amount_to_deliver. The application resolves the cost from shipping_zones via
--   shippingService.calculateShippingCost and persists it here together with the
--   zone it came from. Non-cash remittances keep delivery_cost = 0 and a NULL zone.
--
-- Design decisions:
--   * delivery_cost numeric(12,2) NOT NULL DEFAULT 0: existing rows get 0, so no
--     backfill and no behaviour change for historical remittances.
--   * Named CHECK (delivery_cost >= 0), added idempotently.
--   * shipping_zone_id uuid NULL -> shipping_zones(id) ON DELETE SET NULL, so
--     deleting a zone never blocks or destroys a remittance (the cost stays on the
--     row). shipping_zones.id is a uuid primary key (20251007_orders_payment_system.sql).
--   * No generated total column and no trigger recalculating from shipping_zones:
--     the persisted cost is a snapshot that must not move when tariffs change.
--   * No RLS or GRANT changes: new columns inherit the table-level privileges and
--     policies already on public.remittances.
--
-- NOT INCLUDED ON PURPOSE (open finding for the orchestrator):
--   A BEFORE UPDATE guard that blocks client sessions from changing money columns
--   was NOT written. The client flow recalculateRemittanceAtCurrentRate
--   (src/lib/remittanceService.js, called from MyRemittancesPage.jsx) legitimately
--   UPDATEs exchange_rate, commission_percentage, commission_fixed, commission_total
--   and amount_to_deliver from a normal user session. A guard would break it.
--   The owner policy "users can update own remittances" therefore still lets a user
--   change money columns (and status / payment_validated) of their own remittance.
--
-- Deployment order: apply this migration BEFORE shipping the front-end change;
-- createRemittance now inserts delivery_cost and shipping_zone_id.
--
-- Verification:
--   SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'remittances'
--     AND column_name IN ('delivery_cost', 'shipping_zone_id');
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.remittances'::regclass
--     AND conname IN ('remittances_delivery_cost_nonnegative', 'remittances_shipping_zone_id_fkey');
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_delivery_cost_nonnegative;
--   ALTER TABLE public.remittances DROP COLUMN IF EXISTS shipping_zone_id;
--   ALTER TABLE public.remittances DROP COLUMN IF EXISTS delivery_cost;
--   COMMIT;
-- ============================================================================

BEGIN;

ALTER TABLE public.remittances
  ADD COLUMN IF NOT EXISTS delivery_cost numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.remittances
  ADD COLUMN IF NOT EXISTS shipping_zone_id uuid NULL
  REFERENCES public.shipping_zones(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.remittances'::regclass
      AND conname = 'remittances_delivery_cost_nonnegative'
  ) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_delivery_cost_nonnegative CHECK (delivery_cost >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.remittances.delivery_cost IS
  'Cash delivery cost added to what the sender pays (total = amount_sent + delivery_cost). Never deducted from amount_to_deliver. 0 for non-cash.';
COMMENT ON COLUMN public.remittances.shipping_zone_id IS
  'Shipping zone the delivery_cost was resolved from (cash only). NULL for non-cash or when the zone was deleted.';

COMMIT;
