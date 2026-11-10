-- Rollback of the Phase 0b contract file (20261016160100_phase0b_contract_revoke_cost_columns.sql).
-- PREPARED, NOT APPLIED. Restores the production grants exactly as verified on 2026-10-16:
--   anon: SELECT; authenticated: SELECT (+ INSERT/UPDATE/DELETE, untouched by the contract) on the five
--   tables; authenticated: SELECT on order_analytics and remittance_services.
-- REVOKE first clears the column-level SELECT grants the contract created, then the table-level grant returns.
-- Effective immediately; no front revert is needed (the front works with and without the contract).

REVOKE SELECT ON public.products FROM anon, authenticated;
GRANT SELECT ON public.products TO anon, authenticated;

REVOKE SELECT ON public.combo_products FROM anon, authenticated;
GRANT SELECT ON public.combo_products TO anon, authenticated;

REVOKE SELECT ON public.product_categories FROM anon, authenticated;
GRANT SELECT ON public.product_categories TO anon, authenticated;

REVOKE SELECT ON public.inventory FROM anon, authenticated;
GRANT SELECT ON public.inventory TO anon, authenticated;

REVOKE SELECT ON public.shipping_zones FROM anon, authenticated;
GRANT SELECT ON public.shipping_zones TO anon, authenticated;

GRANT SELECT ON public.order_analytics TO authenticated;
GRANT SELECT ON public.remittance_services TO authenticated;

NOTIFY pgrst, 'reload schema';
