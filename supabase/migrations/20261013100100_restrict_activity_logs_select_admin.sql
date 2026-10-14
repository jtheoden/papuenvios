-- PR-01 (companion de 20261013100000_fix_sec07_redact_fn_grant.sql).
-- DEBE aplicarse junto con ese GRANT, nunca antes ni despues por separado.
--
-- Por que existe: activity_logs_select_authenticated tiene USING (true) para el rol
-- authenticated, es decir, CUALQUIER cliente logueado puede leer el rastro completo de auditoria
-- via la API REST (verificado en la BD viva el 2026-10-13: un usuario con role='user' ve las
-- 40 filas, igual que un super_admin). Hasta hoy el impacto era minimo porque casi no se
-- registraba nada (el GRANT de redact_pii_jsonb estaba roto). Al arreglarlo, empezaran a
-- llegar logs de pedidos y remesas con montos, numeros de remesa, referencias de pago y emails
-- en performed_by, y quedarian legibles por cualquier cliente. Esta migracion cierra esa
-- exposicion antes de que exista el volumen.
--
-- Alcance verificado de lectores: el unico consumidor es src/lib/activityLogger.js
-- (fetchActivityLogs) usado solo por ActivityLogTab, renderizado unicamente dentro de
-- DashboardPage (ruta protegida a rol admin). Los INSERT (incluido el flush de la cola
-- localStorage) no leen de vuelta, por lo que no necesitan SELECT.
--
-- Se usa public.is_admin_user() (SECURITY DEFINER, search_path fijado): admin o super_admin
-- con is_enabled = true. Envuelta en (SELECT ...) para evaluarse una vez por consulta.
-- La policy de INSERT no se toca (los usuarios siguen pudiendo registrar sus acciones).
--
-- Reversion: DROP POLICY activity_logs_select_admin ON public.activity_logs;
--            CREATE POLICY activity_logs_select_authenticated ON public.activity_logs
--              FOR SELECT TO authenticated USING (true);

BEGIN;

DROP POLICY IF EXISTS "activity_logs_select_authenticated" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_admin" ON public.activity_logs;

CREATE POLICY "activity_logs_select_admin"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_user()));

COMMIT;
