-- Rollback of 20261024100200_order_number_sequence.sql.
-- ORDER: revert the FRONT first (the old front sends its own order_number; the new one relies on this function).
--   If only this SQL is reverted while the new front is live, checkout keeps working because the function below no
--   longer truncates: it pads to 4 digits only while the sequence is below 10000 (the original behaviour) and
--   otherwise returns the full number (the original LPAD(..., 4) cut 100001 down to '1000' and repeated numbers).
-- The sequence position is left as is on purpose (a setval backwards would only risk duplicates).
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
    n bigint := NEXTVAL('public.order_sequence');
BEGIN
    RETURN 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
           CASE WHEN n < 10000 THEN LPAD(n::TEXT, 4, '0') ELSE n::TEXT END;
END;
$function$;
COMMIT;
