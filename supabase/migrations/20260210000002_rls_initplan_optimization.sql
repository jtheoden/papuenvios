-- ============================================================
-- Migration: RLS InitPlan Optimization
-- Purpose: Wrap auth.uid(), is_admin_user(), and get_my_role()
--          calls in (select ...) to prevent per-row re-evaluation.
--          This is a Supabase-recommended performance optimization.
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- GROUP 1: Admin-only ALL policies (is_admin_user() → (select is_admin_user()))
-- ════════════════════════════════════════════════════════════

-- account_types
DROP POLICY IF EXISTS "account_types_manage" ON public.account_types;
CREATE POLICY "account_types_manage" ON public.account_types FOR ALL TO authenticated USING ((select is_admin_user()));

-- banks
DROP POLICY IF EXISTS "banks_manage" ON public.banks;
CREATE POLICY "banks_manage" ON public.banks FOR ALL TO authenticated USING ((select is_admin_user()));

-- carousel_slides (admin ALL)
DROP POLICY IF EXISTS "carousel_all_admin" ON public.carousel_slides;
CREATE POLICY "carousel_all_admin" ON public.carousel_slides FOR ALL USING ((select is_admin_user()));

-- category_rules
DROP POLICY IF EXISTS "category_rules_manage" ON public.category_rules;
CREATE POLICY "category_rules_manage" ON public.category_rules FOR ALL TO authenticated USING ((select is_admin_user()));

-- combo_items
DROP POLICY IF EXISTS "combo_items_manage" ON public.combo_items;
CREATE POLICY "combo_items_manage" ON public.combo_items FOR ALL TO authenticated USING ((select is_admin_user()));

-- combo_products (admin ALL)
DROP POLICY IF EXISTS "combos_all_admin" ON public.combo_products;
CREATE POLICY "combos_all_admin" ON public.combo_products FOR ALL USING ((select is_admin_user()));

-- cuban_municipalities
DROP POLICY IF EXISTS "cuban_municipalities_manage" ON public.cuban_municipalities;
CREATE POLICY "cuban_municipalities_manage" ON public.cuban_municipalities FOR ALL TO authenticated USING ((select is_admin_user()));

-- currencies
DROP POLICY IF EXISTS "currencies_manage" ON public.currencies;
CREATE POLICY "currencies_manage" ON public.currencies FOR ALL TO authenticated USING ((select is_admin_user()));

-- exchange_rates
DROP POLICY IF EXISTS "exchange_rates_manage" ON public.exchange_rates;
CREATE POLICY "exchange_rates_manage" ON public.exchange_rates FOR ALL TO authenticated USING ((select is_admin_user()));

-- inventory (admin manage)
DROP POLICY IF EXISTS "inventory_manage" ON public.inventory;
CREATE POLICY "inventory_manage" ON public.inventory FOR ALL TO authenticated USING ((select is_admin_user()));

-- inventory_movements (admin select)
DROP POLICY IF EXISTS "inventory_movements_select" ON public.inventory_movements;
CREATE POLICY "inventory_movements_select" ON public.inventory_movements FOR SELECT TO authenticated USING ((select is_admin_user()));

-- manager_assignments
DROP POLICY IF EXISTS "manager_assignments_manage" ON public.manager_assignments;
CREATE POLICY "manager_assignments_manage" ON public.manager_assignments FOR ALL TO authenticated USING ((select is_admin_user()));

-- notification_logs
DROP POLICY IF EXISTS "notification_logs_select" ON public.notification_logs;
CREATE POLICY "notification_logs_select" ON public.notification_logs FOR SELECT TO authenticated USING ((select is_admin_user()));

-- offer_items
DROP POLICY IF EXISTS "offer_items_manage" ON public.offer_items;
CREATE POLICY "offer_items_manage" ON public.offer_items FOR ALL TO authenticated USING ((select is_admin_user()));

-- offers
DROP POLICY IF EXISTS "offers_manage" ON public.offers;
CREATE POLICY "offers_manage" ON public.offers FOR ALL TO authenticated USING ((select is_admin_user()));

-- operational_costs
DROP POLICY IF EXISTS "operational_costs_manage" ON public.operational_costs;
CREATE POLICY "operational_costs_manage" ON public.operational_costs FOR ALL TO authenticated USING ((select is_admin_user()));

-- product_categories (admin ALL)
DROP POLICY IF EXISTS "categories_all_admin" ON public.product_categories;
CREATE POLICY "categories_all_admin" ON public.product_categories FOR ALL USING ((select is_admin_user()));

-- products (admin delete)
DROP POLICY IF EXISTS "products_delete_admin" ON public.products;
CREATE POLICY "products_delete_admin" ON public.products FOR DELETE USING ((select is_admin_user()));

-- products (admin insert)
DROP POLICY IF EXISTS "products_insert_admin" ON public.products;
CREATE POLICY "products_insert_admin" ON public.products FOR INSERT WITH CHECK ((select is_admin_user()));

-- products (admin update)
DROP POLICY IF EXISTS "products_update_admin" ON public.products;
CREATE POLICY "products_update_admin" ON public.products FOR UPDATE USING ((select is_admin_user())) WITH CHECK ((select is_admin_user()));

-- remittance_services
DROP POLICY IF EXISTS "remittance_services_manage" ON public.remittance_services;
CREATE POLICY "remittance_services_manage" ON public.remittance_services FOR ALL TO authenticated USING ((select is_admin_user()));

-- remittance_types (admin ALL)
DROP POLICY IF EXISTS "remittance_types_all_admin" ON public.remittance_types;
CREATE POLICY "remittance_types_all_admin" ON public.remittance_types FOR ALL USING ((select is_admin_user()));

-- shipping_zones
DROP POLICY IF EXISTS "shipping_zones_manage" ON public.shipping_zones;
CREATE POLICY "shipping_zones_manage" ON public.shipping_zones FOR ALL TO authenticated USING ((select is_admin_user()));

-- site_visits (admin select)
DROP POLICY IF EXISTS "site_visits_select_admin" ON public.site_visits;
CREATE POLICY "site_visits_select_admin" ON public.site_visits FOR SELECT TO authenticated USING ((select is_admin_user()));

-- system_messages
DROP POLICY IF EXISTS "system_messages_manage" ON public.system_messages;
CREATE POLICY "system_messages_manage" ON public.system_messages FOR ALL TO authenticated USING ((select is_admin_user()));

-- user_categories (admin manage)
DROP POLICY IF EXISTS "user_categories_manage" ON public.user_categories;
CREATE POLICY "user_categories_manage" ON public.user_categories FOR ALL USING ((select is_admin_user()));

-- user_category_history (admin manage)
DROP POLICY IF EXISTS "user_category_history_manage" ON public.user_category_history;
CREATE POLICY "user_category_history_manage" ON public.user_category_history FOR ALL USING ((select is_admin_user()));

-- videos
DROP POLICY IF EXISTS "videos_manage" ON public.videos;
CREATE POLICY "videos_manage" ON public.videos FOR ALL TO authenticated USING ((select is_admin_user()));

-- zelle_accounts
DROP POLICY IF EXISTS "zelle_accounts_manage" ON public.zelle_accounts;
CREATE POLICY "zelle_accounts_manage" ON public.zelle_accounts FOR ALL TO authenticated USING ((select is_admin_user()));

-- zelle_payment_stats
DROP POLICY IF EXISTS "zps_select" ON public.zelle_payment_stats;
CREATE POLICY "zps_select" ON public.zelle_payment_stats FOR SELECT TO authenticated USING ((select is_admin_user()));

-- zelle_transaction_history
DROP POLICY IF EXISTS "zth_manage" ON public.zelle_transaction_history;
CREATE POLICY "zth_manage" ON public.zelle_transaction_history FOR ALL TO authenticated USING ((select is_admin_user()));

-- ════════════════════════════════════════════════════════════
-- GROUP 2: Public read + admin write (is_active OR is_admin_user)
-- ════════════════════════════════════════════════════════════

-- carousel_slides (public select)
DROP POLICY IF EXISTS "carousel_select_public" ON public.carousel_slides;
CREATE POLICY "carousel_select_public" ON public.carousel_slides FOR SELECT USING ((is_active = true) OR (select is_admin_user()));

-- combo_products (public select)
DROP POLICY IF EXISTS "combos_select_public" ON public.combo_products;
CREATE POLICY "combos_select_public" ON public.combo_products FOR SELECT USING ((is_active = true) OR (select is_admin_user()));

-- product_categories (public select)
DROP POLICY IF EXISTS "categories_select_public" ON public.product_categories;
CREATE POLICY "categories_select_public" ON public.product_categories FOR SELECT USING ((is_active = true) OR (select is_admin_user()));

-- products (public select)
DROP POLICY IF EXISTS "products_select_public" ON public.products;
CREATE POLICY "products_select_public" ON public.products FOR SELECT USING ((is_active = true) OR (select is_admin_user()));

-- remittance_types (public select)
DROP POLICY IF EXISTS "remittance_types_select_public" ON public.remittance_types;
CREATE POLICY "remittance_types_select_public" ON public.remittance_types FOR SELECT USING ((is_active = true) OR (select is_admin_user()));

-- testimonials (public select: visible OR own OR admin)
DROP POLICY IF EXISTS "testimonials_select_public" ON public.testimonials;
CREATE POLICY "testimonials_select_public" ON public.testimonials FOR SELECT USING ((is_visible = true) OR (user_id = (select auth.uid())) OR (select is_admin_user()));

-- ════════════════════════════════════════════════════════════
-- GROUP 3: User-scoped + admin override (user_id = auth.uid() OR is_admin_user())
-- ════════════════════════════════════════════════════════════

-- admin_messages
DROP POLICY IF EXISTS "admin_messages_select" ON public.admin_messages;
CREATE POLICY "admin_messages_select" ON public.admin_messages FOR SELECT USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

DROP POLICY IF EXISTS "admin_messages_insert" ON public.admin_messages;
CREATE POLICY "admin_messages_insert" ON public.admin_messages FOR INSERT WITH CHECK ((select is_admin_user()));

DROP POLICY IF EXISTS "admin_messages_update" ON public.admin_messages;
CREATE POLICY "admin_messages_update" ON public.admin_messages FOR UPDATE USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

-- orders
DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders FOR SELECT USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
CREATE POLICY "orders_insert" ON public.orders FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "orders_update" ON public.orders;
CREATE POLICY "orders_update" ON public.orders FOR UPDATE USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

-- recipients
DROP POLICY IF EXISTS "recipients_select" ON public.recipients;
CREATE POLICY "recipients_select" ON public.recipients FOR SELECT USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

DROP POLICY IF EXISTS "recipients_insert" ON public.recipients;
CREATE POLICY "recipients_insert" ON public.recipients FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "recipients_update" ON public.recipients;
CREATE POLICY "recipients_update" ON public.recipients FOR UPDATE USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

DROP POLICY IF EXISTS "recipients_delete" ON public.recipients;
CREATE POLICY "recipients_delete" ON public.recipients FOR DELETE USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

-- shopping_carts
DROP POLICY IF EXISTS "shopping_carts_select" ON public.shopping_carts;
CREATE POLICY "shopping_carts_select" ON public.shopping_carts FOR SELECT USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

DROP POLICY IF EXISTS "shopping_carts_insert" ON public.shopping_carts;
CREATE POLICY "shopping_carts_insert" ON public.shopping_carts FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "shopping_carts_update" ON public.shopping_carts;
CREATE POLICY "shopping_carts_update" ON public.shopping_carts FOR UPDATE USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "shopping_carts_delete" ON public.shopping_carts;
CREATE POLICY "shopping_carts_delete" ON public.shopping_carts FOR DELETE USING (user_id = (select auth.uid()));

-- testimonials
DROP POLICY IF EXISTS "testimonials_insert" ON public.testimonials;
CREATE POLICY "testimonials_insert" ON public.testimonials FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "testimonials_update" ON public.testimonials;
CREATE POLICY "testimonials_update" ON public.testimonials FOR UPDATE USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

-- user_categories
DROP POLICY IF EXISTS "user_categories_select" ON public.user_categories;
CREATE POLICY "user_categories_select" ON public.user_categories FOR SELECT USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

-- user_category_history
DROP POLICY IF EXISTS "user_category_history_select" ON public.user_category_history;
CREATE POLICY "user_category_history_select" ON public.user_category_history FOR SELECT USING ((user_id = (select auth.uid())) OR (select is_admin_user()));

-- ════════════════════════════════════════════════════════════
-- GROUP 4: user_profiles (id = auth.uid())
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
CREATE POLICY "user_profiles_select_own" ON public.user_profiles FOR SELECT TO authenticated USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "user_profiles_insert_own" ON public.user_profiles;
CREATE POLICY "user_profiles_insert_own" ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "admins_select_all_profiles" ON public.user_profiles;
CREATE POLICY "admins_select_all_profiles" ON public.user_profiles FOR SELECT TO authenticated USING ((select is_admin_user()) OR (id = (select auth.uid())));

DROP POLICY IF EXISTS "users_can_update_own_profile" ON public.user_profiles;
CREATE POLICY "users_can_update_own_profile" ON public.user_profiles FOR UPDATE TO authenticated USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════
-- GROUP 5: user_alerts
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can view own alerts" ON public.user_alerts;
CREATE POLICY "Users can view own alerts" ON public.user_alerts FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own alerts" ON public.user_alerts;
CREATE POLICY "Users can update own alerts" ON public.user_alerts FOR UPDATE USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can manage all alerts" ON public.user_alerts;
CREATE POLICY "Admins can manage all alerts" ON public.user_alerts FOR ALL USING (EXISTS (
  SELECT 1 FROM user_profiles
  WHERE user_profiles.id = (select auth.uid())
  AND user_profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
));

-- ════════════════════════════════════════════════════════════
-- GROUP 6: bank_accounts (get_my_role() + auth.uid())
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "bank_accounts_user_view" ON public.bank_accounts;
CREATE POLICY "bank_accounts_user_view" ON public.bank_accounts FOR SELECT USING (
  ((select auth.uid()) = user_id) OR ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
);

DROP POLICY IF EXISTS "bank_accounts_user_insert" ON public.bank_accounts;
CREATE POLICY "bank_accounts_user_insert" ON public.bank_accounts FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "bank_accounts_user_update" ON public.bank_accounts;
CREATE POLICY "bank_accounts_user_update" ON public.bank_accounts FOR UPDATE USING (
  ((select auth.uid()) = user_id) OR ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
);

DROP POLICY IF EXISTS "bank_accounts_user_delete" ON public.bank_accounts;
CREATE POLICY "bank_accounts_user_delete" ON public.bank_accounts FOR DELETE USING (
  ((select auth.uid()) = user_id) OR ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
);

-- ════════════════════════════════════════════════════════════
-- GROUP 7: recipient_bank_accounts (get_my_role() + auth.uid() via recipients)
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "recipient_bank_accounts_view" ON public.recipient_bank_accounts;
CREATE POLICY "recipient_bank_accounts_view" ON public.recipient_bank_accounts FOR SELECT USING (
  ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  OR EXISTS (SELECT 1 FROM recipients WHERE recipients.id = recipient_bank_accounts.recipient_id AND recipients.user_id = (select auth.uid()))
);

DROP POLICY IF EXISTS "recipient_bank_accounts_insert" ON public.recipient_bank_accounts;
CREATE POLICY "recipient_bank_accounts_insert" ON public.recipient_bank_accounts FOR INSERT WITH CHECK (
  ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  OR EXISTS (SELECT 1 FROM recipients WHERE recipients.id = recipient_bank_accounts.recipient_id AND recipients.user_id = (select auth.uid()))
);

DROP POLICY IF EXISTS "recipient_bank_accounts_update" ON public.recipient_bank_accounts;
CREATE POLICY "recipient_bank_accounts_update" ON public.recipient_bank_accounts FOR UPDATE USING (
  ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  OR EXISTS (SELECT 1 FROM recipients WHERE recipients.id = recipient_bank_accounts.recipient_id AND recipients.user_id = (select auth.uid()))
);

DROP POLICY IF EXISTS "recipient_bank_accounts_delete" ON public.recipient_bank_accounts;
CREATE POLICY "recipient_bank_accounts_delete" ON public.recipient_bank_accounts FOR DELETE USING (
  ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  OR EXISTS (SELECT 1 FROM recipients WHERE recipients.id = recipient_bank_accounts.recipient_id AND recipients.user_id = (select auth.uid()))
);

-- ════════════════════════════════════════════════════════════
-- GROUP 8: cart_items (auth.uid() via shopping_carts + is_admin_user())
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "cart_items_select" ON public.cart_items;
CREATE POLICY "cart_items_select" ON public.cart_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND ((sc.user_id = (select auth.uid())) OR (select is_admin_user())))
);

DROP POLICY IF EXISTS "cart_items_insert" ON public.cart_items;
CREATE POLICY "cart_items_insert" ON public.cart_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = (select auth.uid()))
  OR (select is_admin_user())
);

DROP POLICY IF EXISTS "cart_items_update" ON public.cart_items;
CREATE POLICY "cart_items_update" ON public.cart_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = (select auth.uid()))
  OR (select is_admin_user())
);

DROP POLICY IF EXISTS "cart_items_delete" ON public.cart_items;
CREATE POLICY "cart_items_delete" ON public.cart_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = (select auth.uid()))
  OR (select is_admin_user())
);

-- ════════════════════════════════════════════════════════════
-- GROUP 9: recipient_addresses (auth.uid() via recipients + is_admin_user())
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "recipient_addresses_select" ON public.recipient_addresses;
CREATE POLICY "recipient_addresses_select" ON public.recipient_addresses FOR SELECT USING (
  EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND ((r.user_id = (select auth.uid())) OR (select is_admin_user())))
);

DROP POLICY IF EXISTS "recipient_addresses_insert" ON public.recipient_addresses;
CREATE POLICY "recipient_addresses_insert" ON public.recipient_addresses FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND r.user_id = (select auth.uid()))
  OR (select is_admin_user())
);

DROP POLICY IF EXISTS "recipient_addresses_update" ON public.recipient_addresses;
CREATE POLICY "recipient_addresses_update" ON public.recipient_addresses FOR UPDATE USING (
  EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND ((r.user_id = (select auth.uid())) OR (select is_admin_user())))
);

DROP POLICY IF EXISTS "recipient_addresses_delete" ON public.recipient_addresses;
CREATE POLICY "recipient_addresses_delete" ON public.recipient_addresses FOR DELETE USING (
  EXISTS (SELECT 1 FROM recipients r WHERE r.id = recipient_addresses.recipient_id AND ((r.user_id = (select auth.uid())) OR (select is_admin_user())))
);

-- ════════════════════════════════════════════════════════════
-- GROUP 10: order_items (auth.uid() via orders + is_admin_user())
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "order_items_select" ON public.order_items;
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND ((orders.user_id = (select auth.uid())) OR (select is_admin_user())))
);

DROP POLICY IF EXISTS "order_items_insert" ON public.order_items;
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = (select auth.uid()))
);

-- ════════════════════════════════════════════════════════════
-- GROUP 11: Status history tables (auth.uid() via parent + is_admin_user())
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "osh_select" ON public.order_status_history;
CREATE POLICY "osh_select" ON public.order_status_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_status_history.order_id AND ((o.user_id = (select auth.uid())) OR (select is_admin_user())))
);

DROP POLICY IF EXISTS "rsh_select" ON public.remittance_status_history;
CREATE POLICY "rsh_select" ON public.remittance_status_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM remittances r WHERE r.id = remittance_status_history.remittance_id AND ((r.user_id = (select auth.uid())) OR (select is_admin_user())))
);

-- ════════════════════════════════════════════════════════════
-- GROUP 12: Legacy policies with inline user_profiles subqueries
-- ════════════════════════════════════════════════════════════

-- offer_usage: users can view own usage
DROP POLICY IF EXISTS "users can view own usage" ON public.offer_usage;
CREATE POLICY "users can view own usage" ON public.offer_usage FOR SELECT TO authenticated USING (
  (user_id = (select auth.uid())) OR EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
    AND user_profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'manager'::text])
  )
);

-- offer_usage: admins can manage all usage
DROP POLICY IF EXISTS "admins can manage all usage" ON public.offer_usage;
CREATE POLICY "admins can manage all usage" ON public.offer_usage FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
    AND user_profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'manager'::text])
  )
);

-- system_config: admins_read_config
DROP POLICY IF EXISTS "admins_read_config" ON public.system_config;
CREATE POLICY "admins_read_config" ON public.system_config FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
    AND user_profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
  )
);

-- inventory_movements: admin_delete (legacy inline check)
DROP POLICY IF EXISTS "admin_delete_inventory_movements_direct" ON public.inventory_movements;
CREATE POLICY "admin_delete_inventory_movements_direct" ON public.inventory_movements FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = (select auth.uid())
    AND user_profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    AND user_profiles.is_enabled = true
  )
);

-- ════════════════════════════════════════════════════════════
-- GROUP 13: Remaining get_my_role() policies
-- ════════════════════════════════════════════════════════════

-- business_visual_settings
DROP POLICY IF EXISTS "business_visual_settings_delete_admin" ON public.business_visual_settings;
CREATE POLICY "business_visual_settings_delete_admin" ON public.business_visual_settings FOR DELETE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "business_visual_settings_insert_admin" ON public.business_visual_settings;
CREATE POLICY "business_visual_settings_insert_admin" ON public.business_visual_settings FOR INSERT TO authenticated
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "business_visual_settings_update_admin" ON public.business_visual_settings;
CREATE POLICY "business_visual_settings_update_admin" ON public.business_visual_settings FOR UPDATE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

-- notification_settings
DROP POLICY IF EXISTS "notification_settings_delete_admin" ON public.notification_settings;
CREATE POLICY "notification_settings_delete_admin" ON public.notification_settings FOR DELETE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "notification_settings_insert_admin" ON public.notification_settings;
CREATE POLICY "notification_settings_insert_admin" ON public.notification_settings FOR INSERT TO authenticated
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "notification_settings_update_admin" ON public.notification_settings;
CREATE POLICY "notification_settings_update_admin" ON public.notification_settings FOR UPDATE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

-- publications
DROP POLICY IF EXISTS "publications_delete_admin" ON public.publications;
CREATE POLICY "publications_delete_admin" ON public.publications FOR DELETE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "publications_insert_admin" ON public.publications;
CREATE POLICY "publications_insert_admin" ON public.publications FOR INSERT TO authenticated
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "publications_update_admin" ON public.publications;
CREATE POLICY "publications_update_admin" ON public.publications FOR UPDATE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]))
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

-- remittance_bank_transfers
DROP POLICY IF EXISTS "remittance_bank_transfers_view" ON public.remittance_bank_transfers;
CREATE POLICY "remittance_bank_transfers_view" ON public.remittance_bank_transfers FOR SELECT
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "remittance_bank_transfers_insert" ON public.remittance_bank_transfers;
CREATE POLICY "remittance_bank_transfers_insert" ON public.remittance_bank_transfers FOR INSERT
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

DROP POLICY IF EXISTS "remittance_bank_transfers_update" ON public.remittance_bank_transfers;
CREATE POLICY "remittance_bank_transfers_update" ON public.remittance_bank_transfers FOR UPDATE
  USING ((select get_my_role()) = ANY (ARRAY['admin'::text, 'super_admin'::text]));

COMMIT;
