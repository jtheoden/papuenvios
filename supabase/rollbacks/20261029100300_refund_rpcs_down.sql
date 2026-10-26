-- ROLLBACK of 20261029100300_refund_rpcs.sql: drops the three admin refund RPCs. Revert the front first if it calls them
-- (the badge/queue code treats a failing RPC as 0 / empty). Data in refund_requests is untouched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_resolve_refund(uuid, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.admin_refund_counts();
DROP FUNCTION IF EXISTS public.admin_list_refunds(text, integer, integer, text);

COMMIT;
