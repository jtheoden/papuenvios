-- Rollback of 20261016160000_phase0b_admin_cost_read_rpcs.sql (migration A, expand).
-- PREPARED, NOT APPLIED. Purely additive migration: dropping the five functions restores the previous state.
-- Do NOT run this while the contract file is applied or the admin front uses the RPCs (the admin screens
-- would show their "cost data unavailable" error until the migration is applied again).
DROP FUNCTION IF EXISTS public.admin_list_product_costs(integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public.admin_list_combo_costs(integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public.admin_list_category_margins(integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public.admin_list_inventory_costs(integer, integer, uuid[]);
DROP FUNCTION IF EXISTS public.admin_list_shipping_zone_costs(integer, integer, uuid[]);
NOTIFY pgrst, 'reload schema';
