-- Fix: get_advisors(security) detecto function_search_path_mutable en las 2 funciones
-- nuevas de 20260809000002 (redact_pii_jsonb, activity_logs_redact_pii) — se me olvido
-- fijar search_path ahi, a diferencia de purge_old_activity_logs que si lo tenia.

BEGIN;

ALTER FUNCTION public.redact_pii_jsonb(jsonb) SET search_path = public;
ALTER FUNCTION public.activity_logs_redact_pii() SET search_path = public;

COMMIT;
