-- ROLLBACK of 20261104160000_remittance_types_pricing_super_admin_only.sql: plain admins can again create types and edit
-- their pricing; updated_at stops moving. No row is touched (updated_at values already written stay).
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS guard_remittance_types_pricing ON public.remittance_types;
DROP TRIGGER IF EXISTS trigger_update_remittance_types_updated_at ON public.remittance_types;
DROP FUNCTION IF EXISTS public.guard_remittance_types_pricing();

COMMIT;
