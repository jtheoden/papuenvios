-- ROLLBACK of 20261104160300_revoke_rate_readers_from_anon.sql: restores the exact live ACLs
--   get_order_exchange_rate  {=X, postgres=X, authenticated=X, anon=X}
--   get_market_exchange_rate {=X, postgres=X, authenticated=X}
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regprocedure('public.get_order_exchange_rate(text,text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_order_exchange_rate(text, text) TO PUBLIC, anon;
  END IF;
  IF to_regprocedure('public.get_market_exchange_rate(text,text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_market_exchange_rate(text, text) TO PUBLIC;
  END IF;
END
$do$;

COMMIT;
