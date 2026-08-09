-- SEC-07 (backlog P2, ver .claude/TRACKING_PROGRESS.md y audit-frente3-2026-08-08.md)
-- activity_logs.metadata es jsonb libre sin redaccion ni TTL.
--
-- Alcance real verificado (grep de todos los call sites de logActivity): metadata solo recibe
-- IDs, montos, codigos de oferta y mensajes de error (error.message) — no se encontro ningun
-- caller que vuelque telefono/direccion/tarjeta de un cliente. `performed_by` SI guarda el email
-- del actor (staff/admin/usuario) a proposito, como identidad de auditoria — no se redacta porque
-- redactarlo destruye el proposito del log ("quien hizo que"). El riesgo real y concreto es que un
-- error.message reenviado a metadata/description termine incluyendo un email de cliente (ej. error
-- de constraint unique). Se redacta ese patron especifico via trigger BEFORE INSERT, y se agrega
-- TTL de 90 dias via pg_cron (extension disponible en el proyecto, no instalada hasta ahora).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Redaccion: enmascara patrones de email dentro de metadata (recursivo) y description.
-- No toca performed_by (identidad de auditoria, ver nota arriba).
CREATE OR REPLACE FUNCTION public.redact_pii_jsonb(data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result jsonb;
  key text;
  val jsonb;
  elem jsonb;
  arr jsonb := '[]'::jsonb;
BEGIN
  IF data IS NULL THEN
    RETURN NULL;
  END IF;

  CASE jsonb_typeof(data)
    WHEN 'object' THEN
      result := '{}'::jsonb;
      FOR key, val IN SELECT * FROM jsonb_each(data) LOOP
        result := result || jsonb_build_object(key, public.redact_pii_jsonb(val));
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      FOR elem IN SELECT * FROM jsonb_array_elements(data) LOOP
        arr := arr || jsonb_build_array(public.redact_pii_jsonb(elem));
      END LOOP;
      RETURN arr;
    WHEN 'string' THEN
      RETURN to_jsonb(
        regexp_replace(
          data #>> '{}',
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
          '[REDACTED_EMAIL]',
          'g'
        )
      );
    ELSE
      RETURN data;
  END CASE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redact_pii_jsonb(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.activity_logs_redact_pii()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.metadata := public.redact_pii_jsonb(NEW.metadata);
  NEW.description := regexp_replace(
    COALESCE(NEW.description, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    '[REDACTED_EMAIL]',
    'g'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_logs_redact_pii ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_redact_pii
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.activity_logs_redact_pii();

-- TTL: purga diaria de filas > 90 dias
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs (created_at);

CREATE OR REPLACE FUNCTION public.purge_old_activity_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.activity_logs WHERE created_at < now() - interval '90 days';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_activity_logs() FROM PUBLIC;

SELECT cron.unschedule('purge-old-activity-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-old-activity-logs');

SELECT cron.schedule(
  'purge-old-activity-logs',
  '0 3 * * *',
  $$SELECT public.purge_old_activity_logs();$$
);

COMMIT;
