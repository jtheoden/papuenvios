-- ROLLBACK of 20261029100200_refund_triggers.sql: stops capturing new cancellations and closing requests on reopen.
-- Existing refund_requests rows stay (still resolvable); cancellations made while the triggers are absent are NOT captured and
-- would need a manual backfill.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_refund_request_on_cancel ON public.orders;
DROP TRIGGER IF EXISTS trg_refund_request_on_cancel ON public.remittances;
DROP TRIGGER IF EXISTS trg_refund_request_on_reopen ON public.orders;
DROP TRIGGER IF EXISTS trg_refund_request_on_reopen ON public.remittances;
DROP FUNCTION IF EXISTS public.refund_request_on_cancel();
DROP FUNCTION IF EXISTS public.refund_request_on_reopen();

COMMIT;
