-- ============================================================================
-- USER CATEGORIZATION SYSTEM - CORRECTED FOR ACTUAL SCHEMA
-- Created: 2025-11-12
-- Purpose: Automatic and manual user categorization (REGULAR, PRO, VIP)
-- ADAPTED: Uses user_id from auth.users (matches actual schema relationships)
-- ============================================================================

-- ============================================================================
-- STEP 1: Create user_categories Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  category_name text NOT NULL DEFAULT 'regular', -- 'regular', 'pro', 'vip'
  assigned_at timestamp with time zone DEFAULT now(),
  assigned_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assignment_reason text DEFAULT 'automatic', -- 'automatic', 'manual'
  effective_from timestamp with time zone DEFAULT now(),
  effective_to timestamp with time zone,
  referral_count integer DEFAULT 0,

  -- Metadata
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.user_categories IS
'Tracks user categories (REGULAR, PRO, VIP) with audit trail for both automatic and manual assignments.';

-- Constraints
ALTER TABLE public.user_categories
ADD CONSTRAINT user_categories_category_check
CHECK (category_name IN ('regular', 'pro', 'vip'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_categories_user_id ON public.user_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_categories_category ON public.user_categories(category_name);
CREATE INDEX IF NOT EXISTS idx_user_categories_assigned_by ON public.user_categories(assigned_by);

-- ============================================================================
-- STEP 2: Create user_category_history Table for Audit Trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_category_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_category text NOT NULL DEFAULT 'regular',
  new_category text NOT NULL,
  changed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  change_reason text,
  changed_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.user_category_history IS
'Audit trail for all user category changes (automatic and manual).';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_category_history_user_id ON public.user_category_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_category_history_changed_at ON public.user_category_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_user_category_history_changed_by ON public.user_category_history(changed_by);

-- ============================================================================
-- STEP 3: Create category_rules Table for Configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text NOT NULL UNIQUE, -- 'regular', 'pro', 'vip'
  interaction_threshold integer NOT NULL,
  description text,
  color_code text DEFAULT '#808080', -- CSS color for UI
  enabled boolean DEFAULT true,

  -- Metadata
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.category_rules IS
'Defines thresholds and configuration for automatic categorization.';

-- Constraints
ALTER TABLE public.category_rules
ADD CONSTRAINT category_rules_category_check
CHECK (category_name IN ('regular', 'pro', 'vip'));

ALTER TABLE public.category_rules
ADD CONSTRAINT category_rules_threshold_check
CHECK (interaction_threshold >= 0);

-- Create default rules
INSERT INTO public.category_rules (category_name, interaction_threshold, description, color_code)
VALUES
  ('regular', 0, 'New users (0-4 interactions)', '#808080'),
  ('pro', 5, 'Active users (5-9 interactions)', '#3B82F6'),
  ('vip', 10, 'Premium users (10+ interactions)', '#FFD700')
ON CONFLICT (category_name) DO NOTHING;

-- ============================================================================
-- STEP 4: Create category_discounts Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.category_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text NOT NULL UNIQUE,
  discount_percentage numeric(5,2) NOT NULL DEFAULT 0, -- 0-100%
  discount_description text,
  enabled boolean DEFAULT false,

  -- Metadata
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  FOREIGN KEY (category_name) REFERENCES public.category_rules(category_name) ON DELETE CASCADE
);

COMMENT ON TABLE public.category_discounts IS
'Discount configuration for each user category.';

-- Constraints
ALTER TABLE public.category_discounts
ADD CONSTRAINT category_discounts_percentage_check
CHECK (discount_percentage >= 0 AND discount_percentage <= 100);

-- Create default discounts (all disabled)
INSERT INTO public.category_discounts (category_name, discount_percentage, discount_description, enabled)
VALUES
  ('regular', 0, 'No discount', false),
  ('pro', 5, '5% discount for active users', false),
  ('vip', 10, '10% discount for premium users', false)
ON CONFLICT (category_name) DO NOTHING;

-- ============================================================================
-- STEP 5: Create function to count user interactions
-- Counts: completed orders + validated remittances
-- ============================================================================

CREATE OR REPLACE FUNCTION public.count_user_interactions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_order_count integer := 0;
  v_remittance_count integer := 0;
  v_total integer := 0;
BEGIN
  -- Count completed orders
  SELECT COUNT(*) INTO v_order_count
  FROM public.orders
  WHERE user_id = p_user_id
  AND status = 'completed';

  -- Count validated/delivered remittances (using actual schema columns)
  -- payment_validated = true AND status in various completion states
  SELECT COUNT(*) INTO v_remittance_count
  FROM public.remittances
  WHERE user_id = p_user_id
  AND payment_validated = true
  AND delivered_at IS NOT NULL;

  v_total := COALESCE(v_order_count, 0) + COALESCE(v_remittance_count, 0);

  RETURN v_total;
END;
$$;

-- ============================================================================
-- STEP 6: Create function to determine category based on interactions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_category_from_interactions(p_interactions integer)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_category text := 'regular';
BEGIN
  -- Check VIP first (highest threshold)
  IF p_interactions >= (SELECT interaction_threshold FROM public.category_rules WHERE category_name = 'vip') THEN
    v_category := 'vip';
  -- Check PRO
  ELSIF p_interactions >= (SELECT interaction_threshold FROM public.category_rules WHERE category_name = 'pro') THEN
    v_category := 'pro';
  -- Default to REGULAR
  ELSE
    v_category := 'regular';
  END IF;

  RETURN v_category;
END;
$$;

-- ============================================================================
-- STEP 7: Create function to refresh user category automatically
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_user_category(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_interaction_count integer;
  v_new_category text;
  v_old_category text;
BEGIN
  -- Get current category
  SELECT category_name INTO v_old_category
  FROM public.user_categories
  WHERE user_id = p_user_id;

  -- Default to regular if no category exists
  v_old_category := COALESCE(v_old_category, 'regular');

  -- Count interactions
  v_interaction_count := public.count_user_interactions(p_user_id);

  -- Determine new category
  v_new_category := public.get_category_from_interactions(v_interaction_count);

  -- If category changed, update it
  IF v_new_category != v_old_category THEN
    -- Insert or update user_categories
    INSERT INTO public.user_categories (user_id, category_name, assignment_reason, assigned_by)
    VALUES (p_user_id, v_new_category, 'automatic', NULL)
    ON CONFLICT (user_id) DO UPDATE
    SET category_name = v_new_category,
        updated_at = now();

    -- Record the change in history
    INSERT INTO public.user_category_history (user_id, old_category, new_category, change_reason)
    VALUES (p_user_id, v_old_category, v_new_category, 'Automatic recalculation');

    RETURN json_build_object(
      'success', true,
      'message', 'Category updated automatically',
      'old_category', v_old_category,
      'new_category', v_new_category,
      'interactions', v_interaction_count
    );
  ELSE
    RETURN json_build_object(
      'success', true,
      'message', 'Category unchanged',
      'category', v_new_category,
      'interactions', v_interaction_count
    );
  END IF;
END;
$$;

-- ============================================================================
-- STEP 8: Create function for manual category change
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_user_category_manual(
  p_user_id uuid,
  p_new_category text,
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_old_category text;
BEGIN
  -- Check if requester is admin or manager
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_admin_id
    AND role IN ('admin', 'super_admin', 'manager')
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Only admin or manager can change categories'
    );
  END IF;

  -- Validate new category
  IF p_new_category NOT IN ('regular', 'pro', 'vip') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid category. Must be: regular, pro, or vip'
    );
  END IF;

  -- Get old category
  SELECT category_name INTO v_old_category
  FROM public.user_categories
  WHERE user_id = p_user_id;

  v_old_category := COALESCE(v_old_category, 'regular');

  -- Update or insert category
  INSERT INTO public.user_categories (user_id, category_name, assigned_by, assignment_reason)
  VALUES (p_user_id, p_new_category, v_admin_id, 'manual')
  ON CONFLICT (user_id) DO UPDATE
  SET category_name = p_new_category,
      assigned_by = v_admin_id,
      assignment_reason = 'manual',
      updated_at = now();

  -- Record in history
  INSERT INTO public.user_category_history (user_id, old_category, new_category, changed_by, change_reason)
  VALUES (p_user_id, v_old_category, p_new_category, v_admin_id, COALESCE(p_reason, 'Manual update'));

  RETURN json_build_object(
    'success', true,
    'message', 'Category updated successfully',
    'user_id', p_user_id,
    'old_category', v_old_category,
    'new_category', p_new_category,
    'changed_by', v_admin_id
  );
END;
$$;

-- ============================================================================
-- STEP 9: Enable RLS on category tables
-- ============================================================================

ALTER TABLE public.user_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_category_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_discounts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 10: Add RLS Policies
-- ============================================================================

-- user_categories policies
CREATE POLICY IF NOT EXISTS "users can view own category"
ON public.user_categories
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "admins can view all categories"
ON public.user_categories
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
  )
);

-- user_category_history policies
CREATE POLICY IF NOT EXISTS "users can view own history"
ON public.user_category_history
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
  )
);

-- category_rules: everyone can view (public config)
CREATE POLICY IF NOT EXISTS "anyone can view rules"
ON public.category_rules
FOR SELECT
USING (enabled = true);

CREATE POLICY IF NOT EXISTS "admins can manage rules"
ON public.category_rules
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  )
);

-- category_discounts: admins can manage
CREATE POLICY IF NOT EXISTS "admins can view discounts"
ON public.category_discounts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
  )
);

CREATE POLICY IF NOT EXISTS "super admins can manage discounts"
ON public.category_discounts
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

-- ============================================================================
-- STEP 11: Grant execute permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.count_user_interactions TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_from_interactions TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_category TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_category_manual TO authenticated;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
/*
-- Check tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE '%categor%'
ORDER BY table_name;

-- Check default rules
SELECT * FROM public.category_rules ORDER BY interaction_threshold;

-- Test function
SELECT public.get_category_from_interactions(5);
SELECT public.get_category_from_interactions(12);
*/

-- ============================================================================
