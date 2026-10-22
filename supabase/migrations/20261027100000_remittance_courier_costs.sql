-- Courier (transport) cost per remittance: an admin-only snapshot taken when a cash-delivery remittance is created.
--
-- WHY: the owner decided that remittances.delivery_cost (the cash delivery charge the sender pays on top of
--   amount_sent) is INCOME and that the courier transport cost (driver, fuel; shipping_zones.transport_cost) is a
--   COST. Nothing recorded that cost per remittance, and changing a tariff later would rewrite history if the
--   Dashboard joined the live zone. Same design as order_courier_costs (20261019140000): copy ONCE, at creation.
--
-- WHAT:
--   1. public.remittance_courier_costs(remittance_id PK -> remittances ON DELETE CASCADE, shipping_zone_id,
--      amount_usd, created_at). amount_usd NULL = "the zone had no courier tariff configured" (unknown), not 0.
--   2. AFTER INSERT trigger on public.remittances -> snapshot_remittance_courier_cost() (SECURITY DEFINER) inserts the
--      row for remittances that carry a shipping_zone_id (cash deliveries). NULL amount when the zone is missing or
--      transport_cost is NULL/<=0. The function swallows its own errors (WARNING only): this is accounting, it must
--      never break the creation of a remittance. It only writes to its own table.
--   3. Visibility: RLS ON, one SELECT policy on (SELECT is_admin_user()); no INSERT/UPDATE/DELETE privilege for any API
--      role (only the definer trigger writes). Customers and anon read nothing.
--
-- DESIGN NOTES
--   * No backfill: the only remittance with delivery_cost today (REM-2026-001127) stays "not recorded"; the Dashboard
--     counts it as a cash delivery without a recorded courier tariff. The current tariff is not the historical one.
--   * Not added to supabase_realtime (the Dashboard refetches on the remittances event it already has).
--   * No extra index: the Dashboard reads the table whole and the PK covers the join.
--   * The money-column guards on remittances (20261023110000) act on UPDATE of remittances; this trigger is AFTER INSERT
--     and only inserts into its own table, so it does not interact with them.
--   * The source tariff shipping_zones.transport_cost is still readable by anon/authenticated (finding C1) and stays
--     public until contract B (pending); this migration does not change that.
--
-- TRANSACTION: explicit BEGIN/COMMIT (same pattern as 20261019140000) so SET LOCAL lock_timeout takes effect whether the
--   runner opens a transaction or not. Every statement is idempotent.
--
-- DEPLOY ORDER: apply this migration BEFORE merging the Dashboard change (the Dashboard reads the table; if it is
--   missing the Dashboard degrades to "remittance courier cost unavailable" instead of failing). Not applied to prod by
--   the author: it needs its own explicit approval.
--
-- ROLLBACK: supabase/rollbacks/20261027100000_remittance_courier_costs_down.sql
--   DROP TRIGGER IF EXISTS remittance_courier_cost_snapshot ON public.remittances;
--   DROP FUNCTION IF EXISTS public.snapshot_remittance_courier_cost();
--   DROP TABLE IF EXISTS public.remittance_courier_costs;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.remittance_courier_costs (
  remittance_id    uuid PRIMARY KEY REFERENCES public.remittances(id) ON DELETE CASCADE,
  shipping_zone_id uuid,
  amount_usd       numeric(12,2) CHECK (amount_usd IS NULL OR amount_usd >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.remittance_courier_costs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.remittance_courier_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.remittance_courier_costs TO authenticated;

DROP POLICY IF EXISTS remittance_courier_costs_select_admin ON public.remittance_courier_costs;
CREATE POLICY remittance_courier_costs_select_admin ON public.remittance_courier_costs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

CREATE OR REPLACE FUNCTION public.snapshot_remittance_courier_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.shipping_zone_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.remittance_courier_costs (remittance_id, shipping_zone_id, amount_usd)
  SELECT NEW.id,
         NEW.shipping_zone_id,
         (SELECT CASE WHEN z.transport_cost > 0 THEN round(z.transport_cost, 2) END
            FROM public.shipping_zones z WHERE z.id = NEW.shipping_zone_id)
  ON CONFLICT (remittance_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Accounting data must never break the creation of a remittance.
  RAISE WARNING 'snapshot_remittance_courier_cost failed for remittance %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.snapshot_remittance_courier_cost() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS remittance_courier_cost_snapshot ON public.remittances;
CREATE TRIGGER remittance_courier_cost_snapshot
  AFTER INSERT ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_remittance_courier_cost();

COMMIT;
