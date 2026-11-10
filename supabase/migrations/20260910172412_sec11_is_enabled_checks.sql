-- SEC-11: is_super_admin() did not check is_enabled (unlike is_admin_user()),
-- so a disabled super_admin retained full access via 5 policies that use it
-- (remittances excluded — those use is_admin()/is_super_admin() directly).
-- Also: remittances SELECT/UPDATE policies used is_admin() (no is_enabled
-- check either) instead of the project-standard is_admin_user().
--
-- Scope confirmed live via pg_policies query (2026-09-10), not assumed:
--   remittances: "admins can view all remittances" (SELECT), "admins can
--     update all remittances" (UPDATE) — both is_admin() OR is_super_admin()
--   user_profiles: "super_admins_can_update_any_profile" (UPDATE) — is_super_admin()
--   admin_destructive_ops_log, product_categories: also use is_super_admin(),
--     fixed as a side effect of patching the function in-place (not the
--     original hallazgo, but the correct outcome).

-- Part A: is_super_admin() now also requires is_enabled = true.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT role = 'super_admin' AND is_enabled = true FROM public.user_profiles WHERE id = auth.uid() LIMIT 1),
    false
  );
END;
$$;

-- Part B: remittances — replace is_admin() (no is_enabled check) with is_admin_user().
DROP POLICY IF EXISTS "admins can view all remittances" ON public.remittances;
CREATE POLICY "admins can view all remittances" ON public.remittances
  FOR SELECT USING (is_admin_user() OR is_super_admin());

DROP POLICY IF EXISTS "admins can update all remittances" ON public.remittances;
CREATE POLICY "admins can update all remittances" ON public.remittances
  FOR UPDATE USING (is_admin_user() OR is_super_admin())
  WITH CHECK (is_admin_user() OR is_super_admin());
