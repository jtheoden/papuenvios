-- FIX: execute_platform_reset() fallaba en produccion con
-- "DELETE requires a WHERE clause" (SQLSTATE 21000). Causa raiz: el rol
-- `authenticator` (el que usa PostgREST para TODO el trafico de la app,
-- incluidas las llamadas .rpc() desde el cliente) tiene
-- session_preload_libraries=safeupdate configurado a nivel de rol
-- (verificado via pg_roles.rolconfig) — una extension que bloquea
-- sintacticamente cualquier UPDATE/DELETE sin WHERE en toda sesion abierta
-- por ese rol, incluso dentro de funciones SECURITY DEFINER. Mi conexion de
-- diagnostico via MCP usa el rol `postgres` (servicio), que no tiene esa
-- config — por eso el problema no era visible desde ahi.
--
-- execute_platform_reset() fue escrita para "borrar/resetear todo" en varias
-- tablas, lo cual es intencionalmente sin condicion — 16 DELETE y 1 UPDATE
-- sin WHERE. Fix: agregar "WHERE true" a cada uno. Es un no-op semantico
-- (sigue afectando TODAS las filas, true es siempre verdadero) que satisface
-- el chequeo sintactico de safeupdate sin cambiar que se borra.

CREATE OR REPLACE FUNCTION public.execute_platform_reset(p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_enabled boolean;
  v_n int;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  IF NOT (SELECT is_super_admin()) THEN
    RAISE EXCEPTION 'Solo super_admin puede ejecutar el reset de plataforma' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('platform_reset'));

  SELECT enabled INTO v_enabled FROM platform_reset_control WHERE id = 1 FOR UPDATE;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'El reset no esta habilitado. Debe activarse el flag directamente en la base de datos (no desde la aplicacion).' USING ERRCODE = '42501';
  END IF;

  IF p_confirmation IS DISTINCT FROM 'RESETEAR' THEN
    RAISE EXCEPTION 'Texto de confirmacion invalido';
  END IF;

  DELETE FROM offer_usage WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('offer_usage', v_n);

  DELETE FROM cart_items WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('cart_items', v_n);

  DELETE FROM shopping_carts WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('shopping_carts', v_n);

  DELETE FROM remittances WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('remittances', v_n);

  DELETE FROM orders WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('orders', v_n);

  DELETE FROM recipients WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('recipients', v_n);

  DELETE FROM bank_accounts WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('bank_accounts', v_n);

  DELETE FROM offers WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('offers', v_n);

  DELETE FROM combo_products WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('combo_products', v_n);

  DELETE FROM inventory_movements WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('inventory_movements', v_n);

  DELETE FROM inventory WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('inventory', v_n);

  DELETE FROM zelle_transaction_history WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_transaction_history', v_n);

  DELETE FROM zelle_payment_stats WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_payment_stats', v_n);

  DELETE FROM notification_logs WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notification_logs', v_n);

  DELETE FROM user_alerts WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('user_alerts', v_n);

  DELETE FROM site_visits WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('site_visits', v_n);

  DELETE FROM user_category_history WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('user_category_history', v_n);

  UPDATE zelle_accounts
  SET current_daily_amount = 0, current_monthly_amount = 0, last_used_at = NULL, updated_at = now()
  WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_accounts_reset', v_n);

  UPDATE user_profiles SET is_enabled = false, updated_at = now() WHERE role != 'super_admin';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('users_disabled', v_n);

  UPDATE platform_reset_control SET enabled = false, updated_at = now() WHERE id = 1;

  INSERT INTO admin_destructive_ops_log (op_type, performed_by, details)
  VALUES ('platform_reset', COALESCE(auth.uid()::text, 'system'), v_counts);

  RETURN v_counts;
END;
$function$;

COMMENT ON FUNCTION public.execute_platform_reset(text) IS
  'Reset a estado inicial funcional. Requiere super_admin, platform_reset_control.enabled=true '
  '(activable SOLO por SQL directo, nunca desde esta funcion) y confirmacion literal "RESETEAR". '
  'Todo-o-nada en una unica transaccion. Se auto-desarma (enabled=false) al terminar. '
  'DELETE/UPDATE usan "WHERE true" deliberadamente: el rol authenticator (PostgREST) tiene '
  'safeupdate cargado, que rechaza UPDATE/DELETE sin WHERE aunque el destino sea borrar/resetear '
  'todas las filas de la tabla.';
