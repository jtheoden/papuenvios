-- PR-01 (backlog "To Build Better Web", observacion #4: remesas no se registran).
--
-- Causa raiz (verificada en la BD viva el 2026-10-13):
-- 20260809000002_sec07_activity_logs_pii_ttl.sql creo el trigger BEFORE INSERT
-- trg_activity_logs_redact_pii sobre activity_logs, cuya funcion
-- activity_logs_redact_pii() NO es SECURITY DEFINER (corre con los privilegios de quien
-- inserta) y llama a public.redact_pii_jsonb(jsonb). Esa migracion hizo
-- REVOKE EXECUTE ... FROM PUBLIC sin re-otorgar el permiso a ningun rol de aplicacion
-- (ACL real: {postgres=X/postgres}). Resultado: todo INSERT directo en activity_logs hecho
-- por el rol authenticated falla con 42501 "permission denied for function redact_pii_jsonb".
-- Desde el 2026-08-09 solo sobreviven los logs insertados via RPC SECURITY DEFINER
-- (6 filas, todas product/product_deleted).
--
-- Efecto del cliente: activityLogger.logActivity nunca lanza; ante 42501 encola el log en
-- localStorage y devuelve { status: 'queued' }, por eso el fallo era silencioso.
--
-- Fix minimo: otorgar EXECUTE a authenticated (inserta desde el navegador) y service_role.
-- NO se otorga a anon: anon no tiene INSERT sobre activity_logs, asi que no lo necesita.
-- La funcion es pura (IMMUTABLE, sin acceso a tablas, search_path fijado), por lo que
-- exponerla como RPC a usuarios autenticados no filtra datos. El REVOKE FROM PUBLIC se
-- mantiene intacto. GRANT es idempotente: re-ejecutar la migracion es seguro.
--
-- IMPORTANTE: aplicar junto con 20261013100100_restrict_activity_logs_select_admin.sql.
-- Este GRANT solo hace que empiecen a llegar logs; el otro archivo evita que cualquier cliente
-- logueado pueda leerlos.
--
-- Verificacion post-apply (solo lectura):
--   SELECT has_function_privilege('authenticated','public.redact_pii_jsonb(jsonb)','EXECUTE');  -- true
--   SELECT has_function_privilege('anon','public.redact_pii_jsonb(jsonb)','EXECUTE');           -- false
--   Criterio de UI: tras subir un comprobante de remesa, el tab Activity Log (admin) muestra
--   entidad "remittance". Los logs encolados en localStorage de cada navegador se reponen solos.
--
-- Reversion: REVOKE EXECUTE ON FUNCTION public.redact_pii_jsonb(jsonb) FROM authenticated, service_role;
-- (restauraria el bug; solo para diagnostico).

BEGIN;

GRANT EXECUTE ON FUNCTION public.redact_pii_jsonb(jsonb) TO authenticated, service_role;

COMMIT;
