-- ============================================================================
-- DUAL EXCHANGE RATES FOR ORDERS/COMBOS
-- Created: 2026-11-02
-- Purpose: Add market_rate (internal cost) alongside public rate (customer-facing)
--          Similar to how remittances handle exchange rates
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADD MARKET RATE COLUMN TO EXCHANGE_RATES
-- ============================================================================
-- market_rate = internal cost rate (what super_admin pays)
-- rate = public/sell rate (what customers see) - already exists
ALTER TABLE public.exchange_rates
ADD COLUMN IF NOT EXISTS market_rate numeric(20,6);

-- ============================================================================
-- 2. ADD RATE TYPE COLUMN
-- ============================================================================
-- 'general' = used for all (orders, combos, remittances)
-- 'orders' = specific rate for orders/combos only
-- 'remittances' = specific rate for remittances only
ALTER TABLE public.exchange_rates
ADD COLUMN IF NOT EXISTS rate_type text DEFAULT 'general'
CHECK (rate_type IN ('general', 'orders', 'remittances'));

-- ============================================================================
-- 3. UPDATE EXISTING RATES - SET MARKET_RATE = RATE (no margin initially)
-- ============================================================================
UPDATE public.exchange_rates
SET market_rate = rate
WHERE market_rate IS NULL;

-- ============================================================================
-- 4. ADD CONSTRAINT: MARKET_RATE MUST BE PROVIDED
-- ============================================================================
ALTER TABLE public.exchange_rates
ALTER COLUMN market_rate SET NOT NULL;

-- ============================================================================
-- 5. ADD CONSTRAINT: PUBLIC RATE >= MARKET RATE (profit margin)
-- ============================================================================
ALTER TABLE public.exchange_rates
ADD CONSTRAINT rate_higher_than_market
CHECK (rate >= market_rate);

-- ============================================================================
-- 6. CREATE SYSTEM CONFIG FOR ORDER PRICING MODE
-- ============================================================================
INSERT INTO public.system_config (key, value_json, description, is_public)
VALUES (
  'order_pricing',
  '{
    "use_exchange_rates": true,
    "base_currency": "USD",
    "show_market_rate_to_admin": true,
    "profit_margin_visible": true,
    "min_profit_margin_percent": 5,
    "warn_margin_threshold_percent": 10,
    "last_updated_by": null,
    "last_updated_at": null
  }'::jsonb,
  'Order pricing configuration. Controls how orders and combos calculate prices using exchange rates. Warns when profit margin falls below threshold.',
  false
)
ON CONFLICT (key) DO UPDATE SET
  value_json = COALESCE(system_config.value_json, EXCLUDED.value_json),
  updated_at = now();

-- ============================================================================
-- 7. CREATE HELPER FUNCTION TO GET PUBLIC RATE FOR ORDERS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_order_exchange_rate(
  p_from_currency text,
  p_to_currency text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_rate numeric;
  v_from_id uuid;
  v_to_id uuid;
BEGIN
  -- Get currency IDs
  SELECT id INTO v_from_id FROM currencies WHERE code = p_from_currency AND is_active = true;
  SELECT id INTO v_to_id FROM currencies WHERE code = p_to_currency AND is_active = true;

  IF v_from_id IS NULL OR v_to_id IS NULL THEN
    RETURN 1.0;
  END IF;

  -- Get the public rate (rate column) for orders
  SELECT rate INTO v_rate
  FROM exchange_rates
  WHERE from_currency_id = v_from_id
    AND to_currency_id = v_to_id
    AND is_active = true
    AND (rate_type = 'orders' OR rate_type = 'general')
  ORDER BY
    CASE WHEN rate_type = 'orders' THEN 0 ELSE 1 END,
    effective_date DESC
  LIMIT 1;

  RETURN COALESCE(v_rate, 1.0);
END;
$$;

-- ============================================================================
-- 8. CREATE HELPER FUNCTION TO GET MARKET RATE (ADMIN ONLY)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_market_exchange_rate(
  p_from_currency text,
  p_to_currency text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_rate numeric;
  v_from_id uuid;
  v_to_id uuid;
BEGIN
  -- Only super_admin can see market rates
  IF NOT is_super_admin() THEN
    RETURN NULL;
  END IF;

  -- Get currency IDs
  SELECT id INTO v_from_id FROM currencies WHERE code = p_from_currency AND is_active = true;
  SELECT id INTO v_to_id FROM currencies WHERE code = p_to_currency AND is_active = true;

  IF v_from_id IS NULL OR v_to_id IS NULL THEN
    RETURN 1.0;
  END IF;

  -- Get the market rate for orders
  SELECT market_rate INTO v_rate
  FROM exchange_rates
  WHERE from_currency_id = v_from_id
    AND to_currency_id = v_to_id
    AND is_active = true
    AND (rate_type = 'orders' OR rate_type = 'general')
  ORDER BY
    CASE WHEN rate_type = 'orders' THEN 0 ELSE 1 END,
    effective_date DESC
  LIMIT 1;

  RETURN COALESCE(v_rate, 1.0);
END;
$$;

-- ============================================================================
-- 9. CREATE FUNCTION TO GET RATE SPREAD (PROFIT MARGIN)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_rate_spread(
  p_from_currency text,
  p_to_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_market_rate numeric;
  v_public_rate numeric;
  v_spread_percent numeric;
BEGIN
  -- Only super_admin can see spread info
  IF NOT is_super_admin() THEN
    RETURN NULL;
  END IF;

  v_market_rate := get_market_exchange_rate(p_from_currency, p_to_currency);
  v_public_rate := get_order_exchange_rate(p_from_currency, p_to_currency);

  IF v_market_rate IS NULL OR v_market_rate = 0 THEN
    v_spread_percent := 0;
  ELSE
    v_spread_percent := ((v_public_rate - v_market_rate) / v_market_rate) * 100;
  END IF;

  RETURN jsonb_build_object(
    'market_rate', v_market_rate,
    'public_rate', v_public_rate,
    'spread_amount', v_public_rate - v_market_rate,
    'spread_percent', ROUND(v_spread_percent, 2)
  );
END;
$$;

-- ============================================================================
-- 10. CREATE FUNCTION TO CHECK PROFIT MARGIN WARNINGS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_rate_profit_warnings()
RETURNS TABLE (
  from_currency text,
  to_currency text,
  market_rate numeric,
  public_rate numeric,
  spread_percent numeric,
  warning_level text,
  warning_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_min_margin numeric;
  v_warn_threshold numeric;
BEGIN
  -- Only super_admin can see warnings
  IF NOT is_super_admin() THEN
    RETURN;
  END IF;

  -- Get thresholds from config
  SELECT
    COALESCE((value_json->>'min_profit_margin_percent')::numeric, 5),
    COALESCE((value_json->>'warn_margin_threshold_percent')::numeric, 10)
  INTO v_min_margin, v_warn_threshold
  FROM system_config
  WHERE key = 'order_pricing';

  -- Return rates with warnings
  RETURN QUERY
  SELECT
    fc.code as from_currency,
    tc.code as to_currency,
    er.market_rate,
    er.rate as public_rate,
    CASE
      WHEN er.market_rate = 0 THEN 0
      ELSE ROUND(((er.rate - er.market_rate) / er.market_rate) * 100, 2)
    END as spread_percent,
    CASE
      WHEN er.rate < er.market_rate THEN 'critical'
      WHEN er.rate = er.market_rate THEN 'danger'
      WHEN ((er.rate - er.market_rate) / NULLIF(er.market_rate, 0)) * 100 < v_min_margin THEN 'danger'
      WHEN ((er.rate - er.market_rate) / NULLIF(er.market_rate, 0)) * 100 < v_warn_threshold THEN 'warning'
      ELSE 'ok'
    END as warning_level,
    CASE
      WHEN er.rate < er.market_rate THEN 'LOSS: Public rate below market rate!'
      WHEN er.rate = er.market_rate THEN 'No profit margin!'
      WHEN ((er.rate - er.market_rate) / NULLIF(er.market_rate, 0)) * 100 < v_min_margin THEN 'Profit margin below minimum!'
      WHEN ((er.rate - er.market_rate) / NULLIF(er.market_rate, 0)) * 100 < v_warn_threshold THEN 'Low profit margin'
      ELSE NULL
    END as warning_message
  FROM exchange_rates er
  JOIN currencies fc ON er.from_currency_id = fc.id
  JOIN currencies tc ON er.to_currency_id = tc.id
  WHERE er.is_active = true
    AND (
      er.rate <= er.market_rate
      OR ((er.rate - er.market_rate) / NULLIF(er.market_rate, 0)) * 100 < v_warn_threshold
    )
  ORDER BY
    CASE
      WHEN er.rate < er.market_rate THEN 1
      WHEN er.rate = er.market_rate THEN 2
      ELSE 3
    END,
    spread_percent ASC;
END;
$$;

-- ============================================================================
-- 11. GRANT PERMISSIONS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_order_exchange_rate(text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_market_exchange_rate(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rate_spread(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_profit_warnings() TO authenticated;

COMMIT;
