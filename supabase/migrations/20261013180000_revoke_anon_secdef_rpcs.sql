-- ============================================================================
-- Close SECURITY DEFINER RPCs that anon could execute (security hardening)
-- ============================================================================
-- Problem (live DB inventory, 2026-10-13): 20 SECURITY DEFINER functions in
-- schema public were executable by anon through the default EXECUTE grant to
-- PUBLIC. Ten are privileged RPCs anon has no reason to reach:
--   * admin / destructive (they re-check the role internally, but anon must not
--     reach them at all): execute_platform_reset(text), bulk_delete_categories,
--     bulk_delete_products, preview_bulk_delete_categories,
--     preview_bulk_delete_products, assign_manager_role, remove_manager_role,
--     update_user_category_manual
--   * business counts with NO caller check (information leak):
--     get_low_stock_count(), get_pending_orders_count()
--
-- Fix: REVOKE EXECUTE FROM PUBLIC and anon, then GRANT EXECUTE explicitly to
-- authenticated and service_role (revoking from PUBLIC also removes the implicit
-- grant authenticated relied on).
--
-- Deliberately NOT changed:
--   * is_admin_user, is_super_admin, get_my_role, current_user_role,
--     current_user_is_enabled: evaluated inside RLS policies that apply to the
--     public/anon role; revoking would break catalog queries for visitors.
--   * get_testimonial_author_profiles(uuid[]): intentionally public; returns only
--     user_id, full_name, avatar_url of authors of visible testimonials.
--   * Trigger functions: not callable as RPC and EXECUTE is not checked when a
--     trigger fires.
--
-- No data is read or changed. Idempotent.
--
-- ROLLBACK (re-opens the exposure):
--   GRANT EXECUTE ON FUNCTION <each signature below> TO PUBLIC;
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.execute_platform_reset(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_delete_categories(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_delete_products(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_bulk_delete_categories(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_bulk_delete_products(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assign_manager_role(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_manager_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_user_category_manual(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_low_stock_count() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_orders_count() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.execute_platform_reset(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_delete_categories(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_delete_products(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_bulk_delete_categories(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_bulk_delete_products(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_manager_role(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_manager_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_category_manual(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_low_stock_count() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_orders_count() TO authenticated, service_role;
