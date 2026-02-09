-- ============================================================================
-- SECURITY HARDENING MIGRATION
-- Date: 2026-02-10
-- Description: Comprehensive security hardening for all 53 public tables,
--   39 functions, and 2 views. Fixes RLS, GRANTs, search_path, and indexes.
-- ============================================================================
-- IMPORTANT: Take a Supabase point-in-time recovery snapshot before applying.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: GRANTs CLEANUP (Issues #1, #7)
-- ============================================================================

-- Issue #1: CRITICAL - anon role has full CRUD on user_profiles
REVOKE ALL ON public.user_profiles FROM anon;

-- Issue #7: Over-privileged GRANTs (REFERENCES, TRIGGER, TRUNCATE)
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.orders FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.order_items FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.shipping_zones FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.system_messages FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.testimonials FROM authenticated;

-- ============================================================================
-- SECTION 2: VIEWS FIX (Issues #2, #6)
-- ============================================================================

-- Issue #2: vw_user_profiles_public exposes email, role, is_enabled
DROP VIEW IF EXISTS public.vw_user_profiles_public;
CREATE VIEW public.vw_user_profiles_public AS
  SELECT user_id, full_name, avatar_url FROM public.user_profiles;
ALTER VIEW public.vw_user_profiles_public OWNER TO postgres;
GRANT SELECT ON public.vw_user_profiles_public TO authenticated;

-- Issue #6: order_analytics is SECURITY DEFINER, bypasses all RLS
DROP VIEW IF EXISTS public.order_analytics;
CREATE VIEW public.order_analytics WITH (security_invoker = true) AS
  SELECT o.id, o.order_number, o.created_at, o.validated_at, o.status, o.payment_status,
    o.total_amount, o.shipping_cost, sz.transport_cost, sz.province_name,
    (o.shipping_address->>'municipality') AS municipality,
    up.full_name AS customer_name, up.email AS customer_email,
    c.code AS currency_code
  FROM orders o
  LEFT JOIN shipping_zones sz ON o.shipping_zone_id = sz.id
  LEFT JOIN user_profiles up ON o.user_id = up.user_id
  LEFT JOIN currencies c ON o.currency_id = c.id;
GRANT SELECT ON public.order_analytics TO authenticated;

-- ============================================================================
-- SECTION 3: ENABLE RLS ON ORPHANED-POLICY TABLES (Issue #3)
-- ============================================================================

-- Issue #8: inventory_movements needs SELECT and INSERT policies first
CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT TO authenticated USING (is_admin_user());
CREATE POLICY inventory_movements_insert ON public.inventory_movements
  FOR INSERT TO authenticated WITH CHECK (true);

-- Now enable RLS on all 5 orphaned tables (policies already exist)
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_bank_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SECTION 4: RLS + POLICIES FOR UNPROTECTED TABLES (Issue #4)
-- ============================================================================

-- === Group A: User-scoped tables (HIGH priority) ===

-- 4A-1. recipients (user_id)
ALTER TABLE public.recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipients_select ON public.recipients FOR SELECT
  USING (user_id = auth.uid() OR is_admin_user());
CREATE POLICY recipients_insert ON public.recipients FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY recipients_update ON public.recipients FOR UPDATE
  USING (user_id = auth.uid() OR is_admin_user());
CREATE POLICY recipients_delete ON public.recipients FOR DELETE
  USING (user_id = auth.uid() OR is_admin_user());

-- 4A-2. recipient_addresses (via recipients.user_id)
ALTER TABLE public.recipient_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipient_addresses_select ON public.recipient_addresses FOR SELECT
  USING (EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND (r.user_id = auth.uid() OR is_admin_user())));
CREATE POLICY recipient_addresses_insert ON public.recipient_addresses FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND r.user_id = auth.uid()) OR is_admin_user());
CREATE POLICY recipient_addresses_update ON public.recipient_addresses FOR UPDATE
  USING (EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND (r.user_id = auth.uid() OR is_admin_user())));
CREATE POLICY recipient_addresses_delete ON public.recipient_addresses FOR DELETE
  USING (EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND (r.user_id = auth.uid() OR is_admin_user())));

-- 4A-3. shopping_carts (user_id)
ALTER TABLE public.shopping_carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY shopping_carts_select ON public.shopping_carts FOR SELECT
  USING (user_id = auth.uid() OR is_admin_user());
CREATE POLICY shopping_carts_insert ON public.shopping_carts FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY shopping_carts_update ON public.shopping_carts FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY shopping_carts_delete ON public.shopping_carts FOR DELETE
  USING (user_id = auth.uid());

-- 4A-4. cart_items (via shopping_carts.user_id)
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY cart_items_select ON public.cart_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND (sc.user_id = auth.uid() OR is_admin_user())));
CREATE POLICY cart_items_insert ON public.cart_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = auth.uid()) OR is_admin_user());
CREATE POLICY cart_items_update ON public.cart_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = auth.uid()) OR is_admin_user());
CREATE POLICY cart_items_delete ON public.cart_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = auth.uid()) OR is_admin_user());

-- 4A-5. admin_messages (user_id + admin_id)
ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_messages_select ON public.admin_messages FOR SELECT
  USING (user_id = auth.uid() OR is_admin_user());
CREATE POLICY admin_messages_insert ON public.admin_messages FOR INSERT
  WITH CHECK (is_admin_user());
CREATE POLICY admin_messages_update ON public.admin_messages FOR UPDATE
  USING (user_id = auth.uid() OR is_admin_user());

-- 4A-6. user_categories (user_id)
ALTER TABLE public.user_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_categories_select ON public.user_categories FOR SELECT
  USING (user_id = auth.uid() OR is_admin_user());
CREATE POLICY user_categories_manage ON public.user_categories FOR ALL
  USING (is_admin_user());

-- 4A-7. user_category_history (user_id + changed_by)
ALTER TABLE public.user_category_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_category_history_select ON public.user_category_history FOR SELECT
  USING (user_id = auth.uid() OR is_admin_user());
CREATE POLICY user_category_history_manage ON public.user_category_history FOR ALL
  USING (is_admin_user());

-- 4A-8. site_visits (user_id nullable - analytics)
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_visits_insert_anon ON public.site_visits FOR INSERT TO anon
  WITH CHECK (true);
CREATE POLICY site_visits_insert_auth ON public.site_visits FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY site_visits_select_admin ON public.site_visits FOR SELECT TO authenticated
  USING (is_admin_user());

-- === Group B: Admin/system tables (MEDIUM priority) ===

-- 4B-1. order_status_history (changed_by)
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY osh_select ON public.order_status_history FOR SELECT
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_status_history.order_id AND (o.user_id = auth.uid() OR is_admin_user())));
CREATE POLICY osh_insert ON public.order_status_history FOR INSERT
  WITH CHECK (true);

-- 4B-2. remittance_status_history (changed_by)
ALTER TABLE public.remittance_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY rsh_select ON public.remittance_status_history FOR SELECT
  USING (EXISTS (SELECT 1 FROM remittances r WHERE r.id = remittance_status_history.remittance_id AND (r.user_id = auth.uid() OR is_admin_user())));
CREATE POLICY rsh_insert ON public.remittance_status_history FOR INSERT
  WITH CHECK (true);

-- 4B-3. operational_costs (admin only)
ALTER TABLE public.operational_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY operational_costs_manage ON public.operational_costs FOR ALL TO authenticated
  USING (is_admin_user());

-- 4B-4. inventory (public read for stock, admin write)
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_select ON public.inventory FOR SELECT
  USING (true);
CREATE POLICY inventory_manage ON public.inventory FOR ALL TO authenticated
  USING (is_admin_user());

-- 4B-5. manager_assignments (admin only)
ALTER TABLE public.manager_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY manager_assignments_manage ON public.manager_assignments FOR ALL TO authenticated
  USING (is_admin_user());

-- 4B-6. notification_logs (admin only)
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_logs_select ON public.notification_logs FOR SELECT TO authenticated
  USING (is_admin_user());
CREATE POLICY notification_logs_insert ON public.notification_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- 4B-7. zelle_accounts (admin only)
ALTER TABLE public.zelle_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY zelle_accounts_manage ON public.zelle_accounts FOR ALL TO authenticated
  USING (is_admin_user());

-- 4B-8. zelle_transaction_history (admin only)
ALTER TABLE public.zelle_transaction_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY zth_manage ON public.zelle_transaction_history FOR ALL TO authenticated
  USING (is_admin_user());

-- 4B-9. zelle_payment_stats (admin read only)
ALTER TABLE public.zelle_payment_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY zps_select ON public.zelle_payment_stats FOR SELECT TO authenticated
  USING (is_admin_user());

-- === Group C: Reference/config tables (public read, admin write) ===

-- banks
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
CREATE POLICY banks_select ON public.banks FOR SELECT USING (true);
CREATE POLICY banks_manage ON public.banks FOR ALL TO authenticated USING (is_admin_user());

-- account_types
ALTER TABLE public.account_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_types_select ON public.account_types FOR SELECT USING (true);
CREATE POLICY account_types_manage ON public.account_types FOR ALL TO authenticated USING (is_admin_user());

-- currencies
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY currencies_select ON public.currencies FOR SELECT USING (true);
CREATE POLICY currencies_manage ON public.currencies FOR ALL TO authenticated USING (is_admin_user());

-- exchange_rates
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY exchange_rates_select ON public.exchange_rates FOR SELECT USING (true);
CREATE POLICY exchange_rates_manage ON public.exchange_rates FOR ALL TO authenticated USING (is_admin_user());

-- cuban_municipalities
ALTER TABLE public.cuban_municipalities ENABLE ROW LEVEL SECURITY;
CREATE POLICY cuban_municipalities_select ON public.cuban_municipalities FOR SELECT USING (true);
CREATE POLICY cuban_municipalities_manage ON public.cuban_municipalities FOR ALL TO authenticated USING (is_admin_user());

-- shipping_zones
ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipping_zones_select ON public.shipping_zones FOR SELECT USING (true);
CREATE POLICY shipping_zones_manage ON public.shipping_zones FOR ALL TO authenticated USING (is_admin_user());

-- remittance_services
ALTER TABLE public.remittance_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY remittance_services_select ON public.remittance_services FOR SELECT USING (true);
CREATE POLICY remittance_services_manage ON public.remittance_services FOR ALL TO authenticated USING (is_admin_user());

-- offers
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY offers_select ON public.offers FOR SELECT USING (true);
CREATE POLICY offers_manage ON public.offers FOR ALL TO authenticated USING (is_admin_user());

-- offer_items
ALTER TABLE public.offer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY offer_items_select ON public.offer_items FOR SELECT USING (true);
CREATE POLICY offer_items_manage ON public.offer_items FOR ALL TO authenticated USING (is_admin_user());

-- combo_items
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY combo_items_select ON public.combo_items FOR SELECT USING (true);
CREATE POLICY combo_items_manage ON public.combo_items FOR ALL TO authenticated USING (is_admin_user());

-- category_rules
ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY category_rules_select ON public.category_rules FOR SELECT USING (true);
CREATE POLICY category_rules_manage ON public.category_rules FOR ALL TO authenticated USING (is_admin_user());

-- videos
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY videos_select ON public.videos FOR SELECT USING (true);
CREATE POLICY videos_manage ON public.videos FOR ALL TO authenticated USING (is_admin_user());

-- system_messages
ALTER TABLE public.system_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_messages_select ON public.system_messages FOR SELECT USING (true);
CREATE POLICY system_messages_manage ON public.system_messages FOR ALL TO authenticated USING (is_admin_user());

-- _migrations_applied (internal - service_role only)
ALTER TABLE public._migrations_applied ENABLE ROW LEVEL SECURITY;
CREATE POLICY migrations_service ON public._migrations_applied FOR ALL TO service_role USING (true);

-- ============================================================================
-- SECTION 5: FIX 33 FUNCTIONS - ADD SET search_path = public (Issue #5)
-- ============================================================================

-- Function 1: audit_order_status_change (DEFINER, trigger)
CREATE OR REPLACE FUNCTION public.audit_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO order_status_history (
      order_id,
      previous_status,
      new_status,
      changed_by,
      created_at
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Function 2: audit_remittance_status_change (DEFINER, trigger)
CREATE OR REPLACE FUNCTION public.audit_remittance_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO remittance_status_history (
      remittance_id,
      old_status,
      new_status,
      changed_by,
      created_at
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Function 3: calculate_order_total (INVOKER)
CREATE OR REPLACE FUNCTION public.calculate_order_total(p_subtotal numeric, p_shipping_zone_id uuid, p_discount_amount numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_shipping_cost numeric := 0;
  v_free_shipping boolean := false;
BEGIN
  SELECT shipping_cost, free_shipping
  INTO v_shipping_cost, v_free_shipping
  FROM public.shipping_zones
  WHERE id = p_shipping_zone_id AND is_active = true;

  IF v_free_shipping THEN
    v_shipping_cost := 0;
  END IF;

  RETURN (p_subtotal - COALESCE(p_discount_amount, 0)) + COALESCE(v_shipping_cost, 0);
END;
$function$;

-- Function 4: count_user_interactions (INVOKER, STABLE)
CREATE OR REPLACE FUNCTION public.count_user_interactions(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $function$
DECLARE
  v_order_count integer := 0;
  v_remittance_count integer := 0;
  v_total integer := 0;
BEGIN
  SELECT COUNT(*) INTO v_order_count
  FROM public.orders
  WHERE user_id = p_user_id
  AND status = 'completed';

  SELECT COUNT(*) INTO v_remittance_count
  FROM public.remittances
  WHERE user_id = p_user_id
  AND payment_validated = true
  AND delivered_at IS NOT NULL;

  v_total := COALESCE(v_order_count, 0) + COALESCE(v_remittance_count, 0);

  RETURN v_total;
END;
$function$;

-- Function 5: current_user_id (INVOKER, STABLE)
CREATE OR REPLACE FUNCTION public.current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  SELECT auth.uid();
$function$;

-- Function 6: current_user_is_enabled (DEFINER, STABLE)
CREATE OR REPLACE FUNCTION public.current_user_is_enabled()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    is_user_enabled boolean;
BEGIN
    SELECT is_enabled INTO is_user_enabled
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(is_user_enabled, false);
END;
$function$;

-- Function 7: current_user_role (DEFINER, STABLE)
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
END;
$function$;

-- Function 8: generate_order_number (INVOKER)
CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    RETURN 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('public.order_sequence')::TEXT, 4, '0');
END;
$function$;

-- Function 9: generate_remittance_number (INVOKER, trigger)
CREATE OR REPLACE FUNCTION public.generate_remittance_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  IF NEW.remittance_number IS NULL THEN
    NEW.remittance_number := 'REM-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('remittance_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;

-- Function 10: get_category_from_interactions (INVOKER, STABLE)
CREATE OR REPLACE FUNCTION public.get_category_from_interactions(p_interactions integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $function$
DECLARE
  v_category text := 'regular';
BEGIN
  IF p_interactions >= (SELECT interaction_threshold FROM public.category_rules WHERE category_name = 'vip') THEN
    v_category := 'vip';
  ELSIF p_interactions >= (SELECT interaction_threshold FROM public.category_rules WHERE category_name = 'pro') THEN
    v_category := 'pro';
  ELSE
    v_category := 'regular';
  END IF;

  RETURN v_category;
END;
$function$;

-- Function 11: get_daily_operational_cost (DEFINER)
CREATE OR REPLACE FUNCTION public.get_daily_operational_cost()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  total_daily_cost DECIMAL := 0;
  cost_record RECORD;
BEGIN
  FOR cost_record IN
    SELECT amount, frequency FROM operational_costs WHERE is_active = true
  LOOP
    CASE cost_record.frequency
      WHEN 'daily' THEN
        total_daily_cost := total_daily_cost + cost_record.amount;
      WHEN 'weekly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 7);
      WHEN 'biweekly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 14);
      WHEN 'monthly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 30);
      WHEN 'yearly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 365);
    END CASE;
  END LOOP;

  RETURN total_daily_cost;
END;
$function$;

-- Function 12: get_low_stock_count (DEFINER)
CREATE OR REPLACE FUNCTION public.get_low_stock_count()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT COUNT(*)::integer
  FROM public.inventory i
  JOIN public.products p ON p.id = i.product_id
  WHERE i.available_quantity <= p.min_stock_alert
  AND i.available_quantity > 0
  AND i.is_active = true;
$function$;

-- Function 13: get_pending_orders_count (DEFINER) - also fix VOLATILE -> STABLE
CREATE OR REPLACE FUNCTION public.get_pending_orders_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT COUNT(*)::integer
  FROM public.orders
  WHERE status = 'pending' OR payment_status = 'pending';
$function$;

-- Function 14: get_recipient_bank_account_full (DEFINER)
CREATE OR REPLACE FUNCTION public.get_recipient_bank_account_full(p_recipient_bank_account_id uuid)
 RETURNS TABLE(recipient_bank_account_id uuid, bank_name text, account_type text, currency_code text, account_holder_name text, account_number_full text, account_number_last4 text, is_default boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF (auth.jwt() ->> 'user_role') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    rba.id AS recipient_bank_account_id,
    b.name AS bank_name,
    at.name AS account_type,
    c.code AS currency_code,
    ba.account_holder_name,
    ba.account_number_full,
    ba.account_number_last4,
    rba.is_default
  FROM public.recipient_bank_accounts rba
  INNER JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  INNER JOIN public.banks b ON b.id = ba.bank_id
  INNER JOIN public.account_types at ON at.id = ba.account_type_id
  INNER JOIN public.currencies c ON c.id = ba.currency_id
  WHERE rba.id = p_recipient_bank_account_id
    AND rba.is_active = true
    AND ba.is_active = true
    AND ba.deleted_at IS NULL;
END;
$function$;

-- Function 15: get_remittance_bank_accounts_admin (DEFINER)
CREATE OR REPLACE FUNCTION public.get_remittance_bank_accounts_admin(p_remittance_id uuid)
 RETURNS TABLE(remittance_id uuid, recipient_name text, recipient_phone text, bank_name text, account_type text, currency_code text, account_holder_name text, account_number_full text, account_number_last4 text, delivery_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF (auth.jwt() ->> 'user_role') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS remittance_id,
    rec.full_name AS recipient_name,
    rec.phone AS recipient_phone,
    b.name AS bank_name,
    at.name AS account_type,
    c.code AS currency_code,
    ba.account_holder_name,
    ba.account_number_full,
    ba.account_number_last4,
    r.delivery_amount
  FROM public.remittances r
  INNER JOIN public.recipients rec ON rec.id = r.recipient_id
  LEFT JOIN public.remittance_bank_transfers rbt ON rbt.remittance_id = r.id
  LEFT JOIN public.recipient_bank_accounts rba ON rba.id = rbt.recipient_bank_account_id
  LEFT JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  LEFT JOIN public.banks b ON b.id = ba.bank_id
  LEFT JOIN public.account_types at ON at.id = ba.account_type_id
  LEFT JOIN public.currencies c ON c.id = ba.currency_id
  WHERE r.id = p_remittance_id;
END;
$function$;

-- Function 16: get_shipping_cost_for_location (INVOKER, STABLE)
CREATE OR REPLACE FUNCTION public.get_shipping_cost_for_location(p_province_name text, p_municipality_name text DEFAULT NULL::text)
 RETURNS TABLE(zone_id uuid, shipping_cost numeric, free_shipping boolean, is_municipality_specific boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path = public
AS $function$
BEGIN
  IF p_municipality_name IS NOT NULL THEN
    RETURN QUERY
    SELECT
      sz.id,
      sz.shipping_cost,
      sz.free_shipping,
      true as is_municipality_specific
    FROM public.shipping_zones sz
    WHERE sz.province_name = p_province_name
      AND sz.municipality_name = p_municipality_name
      AND sz.is_active = true
    LIMIT 1;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    sz.id,
    sz.shipping_cost,
    sz.free_shipping,
    false as is_municipality_specific
  FROM public.shipping_zones sz
  WHERE sz.province_name = p_province_name
    AND sz.municipality_name IS NULL
    AND sz.is_active = true
  LIMIT 1;
END;
$function$;

-- Function 17: handle_new_user (DEFINER, trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    user_role_value text;
BEGIN
    IF NEW.email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com', 'superadmin@test.com') THEN
        user_role_value := 'super_admin';
    ELSIF NEW.email = 'admin@test.com' THEN
        user_role_value := 'admin';
    ELSE
        user_role_value := 'user';
    END IF;

    INSERT INTO public.user_profiles (
        id,
        user_id,
        email,
        role,
        full_name,
        avatar_url,
        is_enabled
    )
    VALUES (
        NEW.id,
        NEW.id,
        NEW.email,
        user_role_value,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            split_part(NEW.email, '@', 1)
        ),
        COALESCE(
            NEW.raw_user_meta_data->>'avatar_url',
            NEW.raw_user_meta_data->>'picture',
            'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(sha256(NEW.email::bytea), 'hex')
        ),
        true
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        full_name = COALESCE(EXCLUDED.full_name, user_profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
        updated_at = NOW();

    RETURN NEW;
END;
$function$;

-- Function 18: is_admin (INVOKER, STABLE)
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

-- Function 19: is_admin_user (DEFINER, STABLE)
CREATE OR REPLACE FUNCTION public.is_admin_user()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND is_enabled = true
  );
END;
$function$;

-- Function 20: is_manager (INVOKER, STABLE)
CREATE OR REPLACE FUNCTION public.is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  SELECT COALESCE(role = 'manager', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

-- Function 21: is_super_admin (DEFINER, STABLE)
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  RETURN COALESCE(
    (SELECT role = 'super_admin' FROM public.user_profiles WHERE id = auth.uid() LIMIT 1),
    false
  );
END;
$function$;

-- Function 22: reset_daily_zelle_counters (INVOKER)
CREATE OR REPLACE FUNCTION public.reset_daily_zelle_counters()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  UPDATE zelle_accounts
  SET
    current_daily_amount = 0,
    last_reset_date = CURRENT_DATE
  WHERE last_reset_date < CURRENT_DATE;
END;
$function$;

-- Function 23: reset_monthly_zelle_counters (INVOKER)
CREATE OR REPLACE FUNCTION public.reset_monthly_zelle_counters()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  UPDATE zelle_accounts
  SET current_monthly_amount = 0
  WHERE EXTRACT(DAY FROM now()) = 1;
END;
$function$;

-- Function 24: select_available_zelle_account (INVOKER)
CREATE OR REPLACE FUNCTION public.select_available_zelle_account(p_transaction_type character varying, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id
  FROM zelle_accounts
  WHERE is_active = true
    AND (
      (p_transaction_type = 'remittance' AND for_remittances = true) OR
      (p_transaction_type IN ('product', 'combo') AND for_products = true)
    )
    AND (current_daily_amount + p_amount) <= COALESCE(daily_limit, 999999)
    AND (current_monthly_amount + p_amount) <= COALESCE(monthly_limit, 999999)
    AND (current_daily_amount + p_amount) <= COALESCE(security_limit, 999999)
  ORDER BY priority_order ASC, last_used_at ASC NULLS FIRST
  LIMIT 1;

  RETURN v_account_id;
END;
$function$;

-- Function 25: set_order_number (INVOKER, trigger)
CREATE OR REPLACE FUNCTION public.set_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    IF NEW.order_number IS NULL THEN
        NEW.order_number := public.generate_order_number();
    END IF;
    RETURN NEW;
END;
$function$;

-- Function 26: set_user_role (DEFINER) - CRITICAL
CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id uuid, new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF new_role NOT IN ('user','admin','super_admin') THEN
    RAISE EXCEPTION 'Role inválido: %', new_role;
  END IF;

  UPDATE public.user_profiles
  SET role = new_role, updated_at = now()
  WHERE user_id = target_user_id;
END;
$function$;

-- Function 27: sync_user_email (DEFINER, trigger)
CREATE OR REPLACE FUNCTION public.sync_user_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
    UPDATE public.user_profiles
    SET email = NEW.email, updated_at = NOW()
    WHERE id = NEW.id AND email != NEW.email;
    RETURN NEW;
END;
$function$;

-- Function 28: update_business_visual_settings_timestamp (INVOKER, trigger)
CREATE OR REPLACE FUNCTION public.update_business_visual_settings_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- Function 29: update_publications_timestamp (INVOKER, trigger)
CREATE OR REPLACE FUNCTION public.update_publications_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- Function 30: update_updated_at (INVOKER, trigger)
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$function$;

-- Function 31: update_updated_at_column (INVOKER, trigger)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- Function 32: update_zelle_account_usage (INVOKER)
CREATE OR REPLACE FUNCTION public.update_zelle_account_usage(p_account_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  UPDATE zelle_accounts
  SET
    current_daily_amount = current_daily_amount + p_amount,
    current_monthly_amount = current_monthly_amount + p_amount,
    last_used_at = now(),
    updated_at = now()
  WHERE id = p_account_id;
END;
$function$;

-- Function 33: upsert_my_profile (INVOKER)
CREATE OR REPLACE FUNCTION public.upsert_my_profile(p_full_name text, p_avatar_url text, p_email text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, user_id uuid, email text, role text, is_enabled boolean, full_name text, avatar_url text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  INSERT INTO public.user_profiles (user_id, email, full_name, avatar_url, role, is_enabled)
  VALUES (
    auth.uid(),
    COALESCE(p_email, ''),
    p_full_name,
    p_avatar_url,
    'user',
    true
  )
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = now()
  RETURNING
    public.user_profiles.id,
    public.user_profiles.user_id,
    public.user_profiles.email,
    public.user_profiles.role,
    public.user_profiles.is_enabled,
    public.user_profiles.full_name,
    public.user_profiles.avatar_url,
    public.user_profiles.created_at,
    public.user_profiles.updated_at;
END;
$function$;

-- ============================================================================
-- SECTION 6: PERFORMANCE INDEXES (Issues #9-#13)
-- ============================================================================

-- Issue #9: Missing index on site_visits.visit_time
CREATE INDEX IF NOT EXISTS idx_site_visits_visit_time ON public.site_visits USING btree (visit_time);

-- Issue #11: Composite index for products query
CREATE INDEX IF NOT EXISTS idx_products_active_category ON public.products USING btree (is_active, category_id, created_at DESC);

-- Issue #12: Composite index for carousel slides
CREATE INDEX IF NOT EXISTS idx_carousel_slides_active_order ON public.carousel_slides USING btree (is_active, display_order);

-- Issue #13: Drop redundant/duplicate indexes
DROP INDEX IF EXISTS public.idx_products_active;
DROP INDEX IF EXISTS public.idx_products_category;
DROP INDEX IF EXISTS public.idx_inventory_product;
DROP INDEX IF EXISTS public.idx_inventory_movements_inventory;
DROP INDEX IF EXISTS public.idx_remittances_status;
DROP INDEX IF EXISTS public.idx_remittances_user;
DROP INDEX IF EXISTS public.idx_testimonials_is_visible;
DROP INDEX IF EXISTS public.idx_testimonials_is_featured;

-- ============================================================================
-- SECTION 7: POLICY CLEANUP (Issue #14)
-- ============================================================================

-- Remove duplicate/overlapping policies on remittances
DROP POLICY IF EXISTS "remittances_select" ON public.remittances;
DROP POLICY IF EXISTS "remittances_insert" ON public.remittances;
DROP POLICY IF EXISTS "remittances_update" ON public.remittances;

COMMIT;
