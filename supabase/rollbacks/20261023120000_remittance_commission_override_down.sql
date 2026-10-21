-- Rollback of 20261023120000_remittance_commission_override.sql.
-- DROPS table remittance_commission_overrides: export it first if it has rows (financial_audit_log rows are kept).
-- Leaves 20261023100000 / 20261023110000 in place (the re-pricing RPC goes back to the 20261023100000 body).
BEGIN;

DROP FUNCTION IF EXISTS public.admin_set_remittance_commission(uuid, numeric, text);

-- 20261023100000 body of the re-pricing RPC (no override branch)
CREATE OR REPLACE FUNCTION public.recalculate_remittance_at_current_rate(p_remittance_id uuid)
 RETURNS remittances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rem          public.remittances%ROWTYPE;
  v_type         public.remittance_types%ROWTYPE;
  v_from_id      uuid;
  v_to_id        uuid;
  v_rate         numeric;
  v_comm_pct     numeric;
  v_comm_fixed   numeric;
  v_disc         record;
  v_quote        record;
BEGIN
  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    v_rem.user_id = public.current_user_id()
    OR public.is_admin_user()
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege: not the owner of this remittance' USING ERRCODE = '42501';
  END IF;
  IF v_rem.status NOT IN ('payment_pending', 'payment_rejected') THEN
    RAISE EXCEPTION 'invalid_status: only payment_pending or payment_rejected remittances can be recalculated'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_type FROM public.remittance_types WHERE id = v_rem.remittance_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_rem.currency_sent = v_rem.currency_delivered THEN
    v_rate := 1;
  ELSIF v_type.exchange_rate IS NOT NULL AND v_type.exchange_rate > 0 THEN
    v_rate := v_type.exchange_rate;
  ELSE
    -- Central rate: the ACTIVE DIRECT pair (sent -> delivered) of exchange_rates. No inverse, no default.
    SELECT id INTO v_from_id FROM public.currencies
      WHERE code = v_rem.currency_sent AND is_active = true LIMIT 1;
    SELECT id INTO v_to_id FROM public.currencies
      WHERE code = v_rem.currency_delivered AND is_active = true LIMIT 1;
    IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
      SELECT er.rate INTO v_rate
      FROM public.exchange_rates er
      WHERE er.from_currency_id = v_from_id
        AND er.to_currency_id = v_to_id
        AND er.is_active = true
        AND er.rate > 0
      ORDER BY er.effective_date DESC, er.updated_at DESC, er.id DESC
      LIMIT 1;
    END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'exchange_rate_unavailable: no active % -> % rate in exchange_rates',
        v_rem.currency_sent, v_rem.currency_delivered
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_comm_pct   := COALESCE(v_type.commission_percentage, 0);
  v_comm_fixed := COALESCE(v_type.commission_fixed, 0);

  SELECT * INTO v_disc FROM public._remittance_discount_source(v_rem.offer_id, v_rem.discount_amount);

  SELECT * INTO v_quote
  FROM public._remittance_quote(v_rem.amount_sent, v_comm_pct, v_comm_fixed, v_rate, v_disc.discount_type, v_disc.discount_value);

  UPDATE public.remittances
  SET exchange_rate         = v_quote.rate4,
      commission_percentage = v_comm_pct,
      commission_fixed      = v_comm_fixed,
      commission_total      = v_quote.commission_total,
      discount_amount       = v_quote.discount,
      amount_to_deliver     = v_quote.amount_to_deliver,
      updated_at            = now()
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;
  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) TO authenticated, service_role;

-- Original audit list and trigger (20261020100000)
CREATE OR REPLACE FUNCTION public.financial_audit_columns(p_table text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_table
    WHEN 'remittances' THEN ARRAY['commission_percentage', 'commission_fixed', 'commission_total', 'exchange_rate',
                                  'amount_sent', 'amount_to_deliver', 'discount_amount', 'delivery_cost', 'shipping_zone_id',
                                  'remittance_type_id', 'currency_sent', 'currency_delivered']
    WHEN 'orders' THEN ARRAY['subtotal', 'discount_amount', 'shipping_cost', 'tax_amount', 'total_amount',
                             'shipping_zone_id', 'payment_amount', 'payment_usd_reference', 'payment_fx_rate',
                             'currency_id', 'payment_currency']
    WHEN 'remittance_types' THEN ARRAY['exchange_rate', 'commission_percentage', 'commission_fixed', 'min_amount',
                                       'max_amount', 'is_active', 'currency_code', 'delivery_currency']
    WHEN 'shipping_zones' THEN ARRAY['shipping_cost', 'transport_cost', 'free_shipping', 'is_active']
    WHEN 'exchange_rates' THEN ARRAY['rate', 'is_active', 'effective_date', 'from_currency_id', 'to_currency_id']
    ELSE ARRAY[]::text[]
  END;
$function$;

REVOKE ALL ON FUNCTION public.financial_audit_columns(text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_cols text[] := public.financial_audit_columns('remittances');
  v_when text;
BEGIN
  SELECT string_agg(format('OLD.%1$I IS DISTINCT FROM NEW.%1$I', c), ' OR ' ORDER BY ord) INTO v_when
    FROM unnest(v_cols) WITH ORDINALITY AS u(c, ord);
  DROP TRIGGER IF EXISTS audit_financial_update ON public.remittances;
  EXECUTE format('CREATE TRIGGER audit_financial_update AFTER UPDATE OF %s ON public.remittances '
                 'FOR EACH ROW WHEN (%s) EXECUTE FUNCTION public.audit_financial_changes()',
                 (SELECT string_agg(quote_ident(c), ', ' ORDER BY ord) FROM unnest(v_cols) WITH ORDINALITY AS u(c, ord)), v_when);
  ALTER TABLE public.remittances ENABLE ALWAYS TRIGGER audit_financial_update;
END $$;

-- The history table (and with it every stored reason / author)
DROP TABLE IF EXISTS public.remittance_commission_overrides;

COMMIT;
