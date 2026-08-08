-- Frente 2 del plan admin-bulk-ops-reset-audit: mecanismo de reset a estado
-- inicial funcional, exclusivo para el periodo de pruebas pre-lanzamiento.
--
-- Hard constraint no negociable: NINGUNA via invocable desde la app puede
-- poner platform_reset_control.enabled = true. Solo se activa con SQL directo
-- (dashboard de Supabase o psql como postgres). El unico camino app-invocable
-- que escribe esa columna es execute_platform_reset(), y unicamente para
-- ponerla en false (auto-desarme al terminar).
--
-- Alcance de la limpieza (decidido por el usuario 2026-08-07/08, aplicando su
-- propia logica "todo lo que implique operacion existente corresponde al
-- periodo de pruebas"): orders, remittances, recipients, cart/shopping carts,
-- offers, combos, inventory, zelle usage (counters + history, no las cuentas
-- en si), metricas (site_visits, user_category_history), bank_accounts,
-- notification_logs, user_alerts. Usuarios no-superadmin: NO se borran de
-- auth.users (Opcion A confirmada) - se deshabilitan (is_enabled=false).
--
-- Exclusiones deliberadas (no pedidas explicitamente, protegidas por la misma
-- logica que products/categories): activity_logs (es el rastro de auditoria
-- de TODO lo hecho durante pruebas, incluidos los propios bulk-delete;
-- borrarlo se contradice con que admin_destructive_ops_log nunca se limpia)
-- y admin_messages (correspondencia, no metrica). Catalogos/config intactos:
-- products, product_categories, remittance_types, shipping_zones,
-- exchange_rates, currencies, publications, zelle_accounts (solo se resetean
-- sus contadores), category_rules/category_discounts/user_categories,
-- account_types/banks, cuban_municipalities, business_visual_settings,
-- system_config, system_messages, notification_settings, manager_assignments.
--
-- AVISO: inventory se borra completo -> los 38 productos actuales del
-- catalogo quedan en stock 0 tras el reset. available_quantity sigue siendo
-- un DEFAULT calculado, no GENERATED ALWAYS AS (DATA-02, todavia abierto) -
-- probar el flujo de re-carga de inventario post-reset antes de habilitar
-- el flag en un entorno real.

BEGIN;

-- ── Tabla de control del flag ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_reset_control (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_reset_control (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_reset_control ENABLE ROW LEVEL SECURITY;

-- Solo lectura para admin (la UI necesita saber si enabled=true para mostrar
-- el boton habilitado). Sin policy de INSERT/UPDATE/DELETE para ningun rol
-- de app — ni siquiera super_admin puede escribir esta tabla via RLS. La
-- unica escritura app-invocable es dentro de execute_platform_reset()
-- (SECURITY DEFINER, corre como owner, bypassea RLS) y solo hacia false.
CREATE POLICY "platform_reset_control_select_admin" ON public.platform_reset_control
  FOR SELECT USING ((select is_admin_user()));

GRANT SELECT ON public.platform_reset_control TO authenticated;

-- ── Log de operaciones administrativas destructivas ─────────────────────────
-- Compartido entre bulk-delete y reset. Nunca se limpia con el reset — es la
-- evidencia de que se ejecuto, por quien y que se borro.

CREATE TABLE IF NOT EXISTS public.admin_destructive_ops_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  op_type text NOT NULL,
  performed_by text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.admin_destructive_ops_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_destructive_ops_log_select_super_admin" ON public.admin_destructive_ops_log
  FOR SELECT USING ((select is_super_admin()));

GRANT SELECT ON public.admin_destructive_ops_log TO authenticated;
-- Sin GRANT INSERT/UPDATE/DELETE a ningun rol de app — solo RPCs
-- SECURITY DEFINER (execute_platform_reset, bulk_delete_products/categories
-- via activity_logs por ahora) escriben aqui.

-- ── Guardia de concurrencia: checkout toma lock compartido ──────────────────
-- orderService.js y remittanceService.js NO pasan por un RPC de checkout
-- (insertan directo desde el cliente) — no hay "RPC de pago" al cual agregar
-- el lock. En su lugar, un trigger BEFORE INSERT en orders/remittances toma
-- el lock compartido: cualquier via de insercion (RPC futuro, insert directo,
-- lo que sea) queda cubierta automaticamente, sin tocar codigo de aplicacion.
-- execute_platform_reset toma el lock EXCLUSIVO del mismo namespace: un
-- checkout en curso bloquea el reset hasta terminar, y un reset en curso
-- bloquea nuevos checkouts — pero dos checkouts entre si siguen concurrentes
-- (shared-vs-shared no bloquea), sin el costo de serializar todo el trafico.

CREATE OR REPLACE FUNCTION public.guard_platform_reset_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('platform_reset'));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_reset_lock_orders ON public.orders;
CREATE TRIGGER guard_reset_lock_orders
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_reset_lock();

DROP TRIGGER IF EXISTS guard_reset_lock_remittances ON public.remittances;
CREATE TRIGGER guard_reset_lock_remittances
  BEFORE INSERT ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_reset_lock();

-- ── execute_platform_reset ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.execute_platform_reset(p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_enabled boolean;
  v_n int;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  IF NOT (SELECT is_super_admin()) THEN
    RAISE EXCEPTION 'Solo super_admin puede ejecutar el reset de plataforma' USING ERRCODE = '42501';
  END IF;

  -- Lock exclusivo ANTES de leer el flag: cierra la ventana entre chequear
  -- el estado y actuar sobre el (evita que un checkout concurrente vea un
  -- estado que cambia debajo suyo a mitad de la verificacion).
  PERFORM pg_advisory_xact_lock(hashtext('platform_reset'));

  SELECT enabled INTO v_enabled FROM platform_reset_control WHERE id = 1 FOR UPDATE;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'El reset no esta habilitado. Debe activarse el flag directamente en la base de datos (no desde la aplicacion).' USING ERRCODE = '42501';
  END IF;

  IF p_confirmation IS DISTINCT FROM 'RESETEAR' THEN
    RAISE EXCEPTION 'Texto de confirmacion invalido';
  END IF;

  -- Orden de borrado respeta las FK del schema real (verificado contra
  -- information_schema antes de escribir esta migracion, no asumido):

  DELETE FROM offer_usage;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('offer_usage', v_n);

  DELETE FROM cart_items;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('cart_items', v_n);

  DELETE FROM shopping_carts;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('shopping_carts', v_n);

  -- Cascada: remittance_status_history, remittance_bank_transfers
  DELETE FROM remittances;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('remittances', v_n);

  -- Cascada: order_items, order_status_history. admin_messages.related_order_id -> SET NULL (admin_messages no se borra).
  DELETE FROM orders;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('orders', v_n);

  -- Cascada: recipient_addresses, recipient_bank_accounts
  DELETE FROM recipients;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('recipients', v_n);

  DELETE FROM bank_accounts;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('bank_accounts', v_n);

  -- Cascada: offer_items
  DELETE FROM offers;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('offers', v_n);

  -- Cascada: combo_items
  DELETE FROM combo_products;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('combo_products', v_n);

  DELETE FROM inventory_movements;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('inventory_movements', v_n);

  -- ATENCION: borra TODO el stock de los productos del catalogo (que si
  -- sobreviven). available_quantity es DEFAULT calculado, no columna
  -- generada (DATA-02 abierto) - re-cargar inventario post-reset antes de
  -- confiar en este flujo en un entorno real.
  DELETE FROM inventory;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('inventory', v_n);

  DELETE FROM zelle_transaction_history;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_transaction_history', v_n);

  DELETE FROM zelle_payment_stats;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_payment_stats', v_n);

  DELETE FROM notification_logs;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notification_logs', v_n);

  DELETE FROM user_alerts;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('user_alerts', v_n);

  DELETE FROM site_visits;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('site_visits', v_n);

  DELETE FROM user_category_history;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('user_category_history', v_n);

  -- Cuentas Zelle: se conservan (configuracion del vendor), solo se
  -- resetean los contadores de uso.
  UPDATE zelle_accounts
  SET current_daily_amount = 0, current_monthly_amount = 0, last_used_at = NULL, updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_accounts_reset', v_n);

  -- Usuarios no-superadmin: Opcion A (confirmada por el usuario) — NO se
  -- borran de auth.users (requiere Admin API, fuera de esta transaccion de
  -- Postgres). Se deshabilitan; su actividad transaccional ya quedo
  -- eliminada arriba via los DELETE de orders/remittances/etc.
  UPDATE user_profiles SET is_enabled = false, updated_at = now() WHERE role != 'super_admin';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('users_disabled', v_n);

  -- Auto-desarme: cierra la ventana de doble-ejecucion. Una segunda llamada
  -- inmediatamente despues falla en el chequeo de enabled de arriba, salvo
  -- que alguien vuelva a activar el flag manualmente en la BD.
  UPDATE platform_reset_control SET enabled = false, updated_at = now() WHERE id = 1;

  INSERT INTO admin_destructive_ops_log (op_type, performed_by, details)
  VALUES ('platform_reset', COALESCE(auth.uid()::text, 'system'), v_counts);

  RETURN v_counts;
END;
$function$;

COMMENT ON FUNCTION public.execute_platform_reset(text) IS
  'Reset a estado inicial funcional. Requiere super_admin, platform_reset_control.enabled=true '
  '(activable SOLO por SQL directo, nunca desde esta funcion) y confirmacion literal "RESETEAR". '
  'Todo-o-nada en una unica transaccion. Se auto-desarma (enabled=false) al terminar.';

GRANT EXECUTE ON FUNCTION public.execute_platform_reset(text) TO authenticated;

COMMIT;
