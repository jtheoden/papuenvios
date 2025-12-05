-- ============================================================================
-- CHECK AUTHENTICATION SESSION
-- Verify current user authentication status
-- ============================================================================

-- Query 1: Check current authentication context
SELECT
  current_user as postgres_user,
  current_setting('request.jwt.claims', true)::json as jwt_claims,
  current_setting('request.jwt.claims', true)::json->>'role' as jwt_role,
  current_setting('request.jwt.claims', true)::json->>'sub' as user_id,
  current_setting('request.jwt.claims', true)::json->>'email' as email;

-- If jwt_claims is null: User is NOT authenticated (this causes 403)
-- If jwt_role is 'anon': User is anonymous
-- If jwt_role is 'authenticated': User is authenticated ✓

-- Query 2: Check if the user making this query has admin role
SELECT
  up.id,
  up.email,
  up.role,
  CASE
    WHEN up.role IN ('admin', 'super_admin', 'manager') THEN '✓ Is admin'
    ELSE '⚠️ Not admin'
  END as admin_status
FROM public.user_profiles up
WHERE up.id = auth.uid();

-- If no rows: User is not in user_profiles table
-- If admin_status is '✓ Is admin': User should have access to activity_logs

-- ============================================================================
-- EXPLANATION OF 403 ERROR:
-- ============================================================================
--
-- When you see 403 Forbidden on activity_logs:
-- 1. RLS is enabled ✓ (confirmed)
-- 2. Policies exist ✓ (confirmed: activity_logs_insert_authenticated, activity_logs_select_authenticated)
-- 3. Policies allow 'authenticated' role ✓ (confirmed)
-- 4. BUT: The request is being made WITHOUT authentication token
--
-- This happens when:
-- - Supabase client doesn't have the session token
-- - Token expired and wasn't refreshed
-- - Request is made before auth completes
--
-- Solution: Make activity logging fail silently (already done in activityLogger.js)
-- or ensure user is authenticated before calling logActivity
--
-- ============================================================================
