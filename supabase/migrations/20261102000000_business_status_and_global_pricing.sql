-- ============================================================================
-- BUSINESS STATUS & GLOBAL PRICING CONFIGURATION
-- Created: 2026-11-02
-- Purpose: Allow super_admin to close the business and manage global pricing
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. INSERT BUSINESS STATUS CONFIG
-- ============================================================================
-- Business open/closed status with customizable messages
INSERT INTO public.system_config (key, value_json, description, is_public)
VALUES (
  'business_status',
  '{
    "is_open": true,
    "closed_message_es": "Estamos temporalmente cerrados. Tu solicitud será procesada cuando abramos nuevamente.",
    "closed_message_en": "We are temporarily closed. Your request will be processed when we reopen.",
    "closed_by": null,
    "closed_at": null,
    "expected_reopen_at": null,
    "auto_reopen": false
  }'::jsonb,
  'Business open/closed status. When closed, users see a message and cannot place orders/remittances.',
  true
)
ON CONFLICT (key) DO UPDATE SET
  value_json = COALESCE(system_config.value_json, EXCLUDED.value_json),
  updated_at = now();

-- ============================================================================
-- 2. INSERT GLOBAL PRICE MULTIPLIER CONFIG
-- ============================================================================
-- Global price multiplier that affects all product prices in orders
INSERT INTO public.system_config (key, value_json, description, is_public)
VALUES (
  'global_pricing',
  '{
    "price_multiplier": 1.0,
    "applies_to_orders": true,
    "applies_to_combos": true,
    "last_updated_by": null,
    "last_updated_at": null,
    "history": []
  }'::jsonb,
  'Global pricing configuration. Multiplier affects all product prices in orders (remittances use their own rates).',
  true
)
ON CONFLICT (key) DO UPDATE SET
  value_json = COALESCE(system_config.value_json, EXCLUDED.value_json),
  updated_at = now();

-- ============================================================================
-- 3. CREATE HELPER FUNCTION TO CHECK BUSINESS STATUS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_business_open()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (value_json->>'is_open')::boolean,
    true
  )
  FROM public.system_config
  WHERE key = 'business_status'
  LIMIT 1;
$$;

-- ============================================================================
-- 4. CREATE HELPER FUNCTION TO GET GLOBAL PRICE MULTIPLIER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_global_price_multiplier()
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (value_json->>'price_multiplier')::numeric,
    1.0
  )
  FROM public.system_config
  WHERE key = 'global_pricing'
  LIMIT 1;
$$;

-- ============================================================================
-- 5. CREATE FUNCTION TO UPDATE BUSINESS STATUS (SUPER_ADMIN ONLY)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_business_status(
  p_is_open boolean,
  p_message_es text DEFAULT NULL,
  p_message_en text DEFAULT NULL,
  p_expected_reopen_at timestamptz DEFAULT NULL,
  p_auto_reopen boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status jsonb;
  v_new_status jsonb;
  v_user_id uuid;
BEGIN
  -- Check if caller is super_admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super_admin can change business status';
  END IF;

  v_user_id := auth.uid();

  -- Get current status
  SELECT value_json INTO v_current_status
  FROM public.system_config
  WHERE key = 'business_status';

  -- Build new status
  -- auto_reopen is true only if closing AND a reopen time is set
  v_new_status := jsonb_build_object(
    'is_open', p_is_open,
    'closed_message_es', COALESCE(p_message_es, v_current_status->>'closed_message_es'),
    'closed_message_en', COALESCE(p_message_en, v_current_status->>'closed_message_en'),
    'closed_by', CASE WHEN p_is_open THEN NULL ELSE v_user_id::text END,
    'closed_at', CASE WHEN p_is_open THEN NULL ELSE now()::text END,
    'expected_reopen_at', CASE WHEN p_is_open THEN NULL ELSE p_expected_reopen_at::text END,
    'auto_reopen', CASE
      WHEN p_is_open THEN false
      WHEN p_expected_reopen_at IS NOT NULL THEN p_auto_reopen
      ELSE false
    END
  );

  -- Update the config
  UPDATE public.system_config
  SET value_json = v_new_status, updated_at = now()
  WHERE key = 'business_status';

  RETURN v_new_status;
END;
$$;

-- ============================================================================
-- 6. CREATE FUNCTION TO UPDATE GLOBAL PRICE MULTIPLIER (SUPER_ADMIN ONLY)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_global_price_multiplier(
  p_multiplier numeric,
  p_applies_to_orders boolean DEFAULT true,
  p_applies_to_combos boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_pricing jsonb;
  v_new_pricing jsonb;
  v_user_id uuid;
  v_history jsonb;
BEGIN
  -- Check if caller is super_admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super_admin can change global pricing';
  END IF;

  -- Validate multiplier (must be positive)
  IF p_multiplier <= 0 THEN
    RAISE EXCEPTION 'Price multiplier must be greater than 0';
  END IF;

  v_user_id := auth.uid();

  -- Get current pricing
  SELECT value_json INTO v_current_pricing
  FROM public.system_config
  WHERE key = 'global_pricing';

  -- Build history entry
  v_history := COALESCE(v_current_pricing->'history', '[]'::jsonb);

  -- Add current values to history (keep last 10 entries)
  IF v_current_pricing IS NOT NULL THEN
    v_history := (
      SELECT jsonb_agg(h)
      FROM (
        SELECT h FROM jsonb_array_elements(v_history) h
        UNION ALL
        SELECT jsonb_build_object(
          'multiplier', v_current_pricing->>'price_multiplier',
          'changed_at', v_current_pricing->>'last_updated_at',
          'changed_by', v_current_pricing->>'last_updated_by'
        )
        ORDER BY (h->>'changed_at') DESC NULLS LAST
        LIMIT 10
      ) sub
    );
  END IF;

  -- Build new pricing config
  v_new_pricing := jsonb_build_object(
    'price_multiplier', p_multiplier,
    'applies_to_orders', p_applies_to_orders,
    'applies_to_combos', p_applies_to_combos,
    'last_updated_by', v_user_id::text,
    'last_updated_at', now()::text,
    'history', COALESCE(v_history, '[]'::jsonb)
  );

  -- Update the config
  UPDATE public.system_config
  SET value_json = v_new_pricing, updated_at = now()
  WHERE key = 'global_pricing';

  RETURN v_new_pricing;
END;
$$;

-- ============================================================================
-- 7. GRANT EXECUTE PERMISSIONS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.is_business_open() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_global_price_multiplier() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_business_status(boolean, text, text, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_global_price_multiplier(numeric, boolean, boolean) TO authenticated;

COMMIT;
