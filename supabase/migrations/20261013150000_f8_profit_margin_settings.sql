-- PR-07 (F8-A, client observation #9): persist the global profit margins.
--
-- Rationale
--   Settings > Financial "Ganancia producto" / "Ganancia combo" only lived in
--   per-device localStorage. They now persist in public.system_config:
--     * default_profit_margin        (already exists, 40.0)
--     * default_combo_profit_margin  (new, 35 = current app fallback for combos,
--                                     see DEFAULTS.COMBO_PROFIT_MARGIN)
--   product_categories gets a nullable profit_margin column for the margin
--   precedence product > category > global (consumed by a later PR; no UI or
--   service uses it yet).
--
-- Security
--   * system_config already has RLS enabled. The existing admins_read_config
--     SELECT policy lets admins read every row, so the new key needs NO new
--     SELECT policy.
--   * Write access is added only for authenticated admins (is_admin_user()) and
--     only for the two margin keys. No policy for anon/public and no GRANT
--     changes (authenticated already has table-level privileges).
--   * The 0..999.99 range is validated in the service layer
--     (financialSettingsService); no CHECK on system_config.
--
-- Not done on purpose: no repricing and no data change on products/combos.
--
-- Verification (read-only):
--   SELECT key, value_numeric FROM public.system_config
--    WHERE key IN ('default_profit_margin','default_combo_profit_margin');
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='system_config' ORDER BY policyname;
--   SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='product_categories'
--      AND column_name='profit_margin';
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='public.product_categories'::regclass
--      AND conname='product_categories_profit_margin_range';
--
-- ROLLBACK:
--   BEGIN;
--   DROP POLICY IF EXISTS "system_config_admin_insert_margins" ON public.system_config;
--   DROP POLICY IF EXISTS "system_config_admin_update_margins" ON public.system_config;
--   DELETE FROM public.system_config WHERE key = 'default_combo_profit_margin';
--   ALTER TABLE public.product_categories
--     DROP CONSTRAINT IF EXISTS product_categories_profit_margin_range;
--   ALTER TABLE public.product_categories DROP COLUMN IF EXISTS profit_margin;
--   COMMIT;

BEGIN;

-- 1. New config row (idempotent; never overwrites an existing value).
INSERT INTO public.system_config (key, value_numeric, description)
VALUES (
  'default_combo_profit_margin',
  35,
  'Default profit margin (%) applied to combos without an individual margin'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Admin write policies, scoped to the two margin keys.
DROP POLICY IF EXISTS "system_config_admin_update_margins" ON public.system_config;
CREATE POLICY "system_config_admin_update_margins" ON public.system_config
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_admin_user())
    AND key IN ('default_profit_margin', 'default_combo_profit_margin')
  )
  WITH CHECK (
    (SELECT public.is_admin_user())
    AND key IN ('default_profit_margin', 'default_combo_profit_margin')
  );

DROP POLICY IF EXISTS "system_config_admin_insert_margins" ON public.system_config;
CREATE POLICY "system_config_admin_insert_margins" ON public.system_config
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_admin_user())
    AND key IN ('default_profit_margin', 'default_combo_profit_margin')
  );

-- 3. Category-level margin (nullable = inherit the global margin).
ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS profit_margin numeric(5,2) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.product_categories'::regclass
       AND conname = 'product_categories_profit_margin_range'
  ) THEN
    ALTER TABLE public.product_categories
      ADD CONSTRAINT product_categories_profit_margin_range
      CHECK (profit_margin IS NULL OR (profit_margin >= 0 AND profit_margin <= 999.99));
  END IF;
END $$;

COMMIT;
