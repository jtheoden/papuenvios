-- ============================================================================
-- CATEGORIZATION FEATURE - RLS POLICIES SETUP
-- ============================================================================
-- This SQL script sets up Row-Level Security (RLS) policies for the
-- user categorization system, allowing authenticated users to:
-- 1. Read category rules and discounts (public data)
-- 2. Read their own category information
-- 3. Admins can manage all categorizations
--
-- Execute this in your Supabase SQL Editor after deploying the categorization feature
-- ============================================================================

-- ============================================================================
-- 1. CATEGORY_RULES TABLE - RLS
-- ============================================================================
-- Allow authenticated users to read category rules (public configuration)
ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "category_rules_read_authenticated"
  ON category_rules
  FOR SELECT
  TO authenticated
  USING (enabled = true);

-- Allow admins to manage all rules
CREATE POLICY "category_rules_admin_all"
  ON category_rules
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- ============================================================================
-- 2. CATEGORY_DISCOUNTS TABLE - RLS
-- ============================================================================
-- Allow authenticated users to read discounts (public data)
ALTER TABLE category_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "category_discounts_read_authenticated"
  ON category_discounts
  FOR SELECT
  TO authenticated
  USING (enabled = true);

-- Allow admins to manage all discounts
CREATE POLICY "category_discounts_admin_all"
  ON category_discounts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- ============================================================================
-- 3. USER_CATEGORIES TABLE - RLS
-- ============================================================================
-- Users can read their own category
ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_categories_read_own"
  ON user_categories
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update their own category (though typically done by admin)
CREATE POLICY "user_categories_update_own"
  ON user_categories
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admins can read and manage all categories
CREATE POLICY "user_categories_admin_all"
  ON user_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- ============================================================================
-- 4. USER_CATEGORY_HISTORY TABLE - RLS
-- ============================================================================
-- Users can read their own history
ALTER TABLE user_category_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_category_history_read_own"
  ON user_category_history
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can read all history
CREATE POLICY "user_category_history_admin_read"
  ON user_category_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- System can insert history records
CREATE POLICY "user_category_history_insert"
  ON user_category_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- After running the above policies, verify they were created:
/*
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN ('category_rules', 'category_discounts', 'user_categories', 'user_category_history')
ORDER BY tablename, policyname;
*/

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. These policies assume user_profiles has a 'role' column
-- 2. 'authenticated' refers to any logged-in user
-- 3. 'admin' and 'super_admin' roles have full access to categorization data
-- 4. Regular users can only see enabled rules/discounts and their own category
-- 5. History records are automatically created when categories change
