-- ROLLBACK of 20261029100000_refund_requests_table.sql. DESTRUCTIVE: drops every refund obligation recorded so far.
-- Export first:  \copy (SELECT * FROM public.refund_requests) TO 'refund_requests_backup.csv' CSV HEADER
-- Roll back 20261029100300 (RPCs) and 20261029100200 (triggers) first.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.refund_requests;

COMMIT;
