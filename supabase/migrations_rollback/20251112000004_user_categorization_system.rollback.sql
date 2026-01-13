-- ============================================================================
-- ROLLBACK: USER CATEGORIZATION SYSTEM
-- Created: 2025-11-12
-- Purpose: Remove user categorization tables, functions, and policies
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop functions
-- ============================================================================

DROP FUNCTION IF EXISTS public.update_user_category_manual CASCADE;
DROP FUNCTION IF EXISTS public.refresh_user_category CASCADE;
DROP FUNCTION IF EXISTS public.get_category_from_interactions CASCADE;
DROP FUNCTION IF EXISTS public.count_user_interactions CASCADE;

-- ============================================================================
-- STEP 2: Drop RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own category" ON public.user_categories;
DROP POLICY IF EXISTS "admins can view all categories" ON public.user_categories;
DROP POLICY IF EXISTS "users can view own history" ON public.user_category_history;
DROP POLICY IF EXISTS "anyone can view rules" ON public.category_rules;
DROP POLICY IF EXISTS "admins can manage rules" ON public.category_rules;
DROP POLICY IF EXISTS "admins can view discounts" ON public.category_discounts;
DROP POLICY IF EXISTS "super admins can manage discounts" ON public.category_discounts;

-- ============================================================================
-- STEP 3: Drop tables (in correct order due to foreign keys)
-- ============================================================================

DROP TABLE IF EXISTS public.category_discounts CASCADE;
DROP TABLE IF EXISTS public.category_rules CASCADE;
DROP TABLE IF EXISTS public.user_category_history CASCADE;
DROP TABLE IF EXISTS public.user_categories CASCADE;

-- ============================================================================
