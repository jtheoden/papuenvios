-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- UPDATED: 2025-10-10 after MIGRATIONS_PHASE_2

CREATE TABLE public.carousel_slides (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title_es text NOT NULL,
  title_en text NOT NULL,
  subtitle_es text,
  subtitle_en text,
  image_url text,
  image_file text,
  link_url text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT carousel_slides_pkey PRIMARY KEY (id)
);

CREATE TABLE public.cart_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  cart_id uuid NOT NULL,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cart_items_pkey PRIMARY KEY (id),
  CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.shopping_carts(id)
);

CREATE TABLE public.combo_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  combo_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT combo_items_pkey PRIMARY KEY (id),
  CONSTRAINT combo_items_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES public.combo_products(id),
  CONSTRAINT combo_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);

CREATE TABLE public.combo_products (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  image_url text,
  base_total_price numeric NOT NULL,
  profit_margin numeric DEFAULT 40.00,
  final_price numeric DEFAULT (base_total_price * ((1)::numeric + (profit_margin / (100)::numeric))),
  shipping_free boolean DEFAULT false,
  shipping_discount_percent numeric DEFAULT 0,
  out_of_province_shipping boolean DEFAULT true,
  out_of_province_price numeric,
  is_active boolean DEFAULT true,
  is_featured boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT combo_products_pkey PRIMARY KEY (id)
);

CREATE TABLE public.currencies (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  code text NOT NULL UNIQUE,
  name_es text NOT NULL,
  name_en text NOT NULL,
  symbol text NOT NULL,
  is_base boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT currencies_pkey PRIMARY KEY (id)
);

CREATE TABLE public.exchange_rates (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  from_currency_id uuid NOT NULL,
  to_currency_id uuid NOT NULL,
  rate numeric NOT NULL,
  is_active boolean DEFAULT true,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT exchange_rates_pkey PRIMARY KEY (id),
  CONSTRAINT exchange_rates_from_currency_id_fkey FOREIGN KEY (from_currency_id) REFERENCES public.currencies(id),
  CONSTRAINT exchange_rates_to_currency_id_fkey FOREIGN KEY (to_currency_id) REFERENCES public.currencies(id)
);

CREATE TABLE public.inventory (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL,
  batch_number text,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity integer DEFAULT 0 CHECK (reserved_quantity >= 0),
  available_quantity integer DEFAULT (quantity - reserved_quantity),
  cost_per_unit numeric,
  expiry_date date,
  received_date date DEFAULT CURRENT_DATE,
  supplier_reference text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inventory_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);

CREATE TABLE public.inventory_movements (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  inventory_id uuid NOT NULL,
  movement_type text NOT NULL,
  quantity_change integer NOT NULL,
  reference_id uuid,
  reference_type text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inventory_movements_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_movements_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.inventory(id),
  CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

-- NEW: Admin messages table (PHASE 2)
CREATE TABLE public.admin_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  related_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now(),
  read_at timestamp with time zone,
  CONSTRAINT admin_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notification_logs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  notification_type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  content text,
  status text DEFAULT 'pending'::text,
  reference_id uuid,
  reference_type text,
  error_message text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_logs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notification_settings (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  setting_type text NOT NULL UNIQUE,
  value text NOT NULL,
  is_active boolean DEFAULT true,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_settings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.offer_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  offer_id uuid NOT NULL,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT offer_items_pkey PRIMARY KEY (id),
  CONSTRAINT offer_items_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id)
);

CREATE TABLE public.offers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  discount_type text NOT NULL,
  discount_value numeric NOT NULL,
  min_purchase_amount numeric,
  max_discount_amount numeric,
  start_date timestamp with time zone NOT NULL,
  end_date timestamp with time zone NOT NULL,
  applies_to text NOT NULL,
  free_shipping boolean DEFAULT false,
  shipping_discount_percent numeric DEFAULT 0,
  usage_limit integer,
  usage_count integer DEFAULT 0,
  user_usage_limit integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT offers_pkey PRIMARY KEY (id)
);

-- NEW: Operational costs table (PHASE 2)
CREATE TABLE public.operational_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cost_name text NOT NULL,
  amount numeric(10,2) NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  category text,
  description text,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT operational_costs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.order_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  item_name_es text NOT NULL,
  item_name_en text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric NOT NULL,
  total_price numeric NOT NULL,
  inventory_id uuid,
  remittance_amount numeric,
  exchange_rate numeric,
  recipient_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_items_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.inventory(id)
);

CREATE TABLE public.order_status_history (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT order_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id)
);

CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  order_type text NOT NULL,
  status text DEFAULT 'pending'::text,
  subtotal numeric NOT NULL,
  discount_amount numeric DEFAULT 0,
  shipping_cost numeric DEFAULT 0,
  tax_amount numeric DEFAULT 0,
  total_amount numeric NOT NULL,
  currency_id uuid NOT NULL,
  shipping_address jsonb,
  recipient_info jsonb,
  delivery_instructions text,
  estimated_delivery date,
  actual_delivery date,
  tracking_number text,
  payment_method text DEFAULT 'zelle'::text,
  payment_status text DEFAULT 'pending'::text,
  payment_reference text,
  payment_proof_url text,
  zelle_account_id uuid,
  notes text,
  admin_notes text,
  offer_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  shipping_zone_id uuid,
  validated_by uuid,
  validated_at timestamp with time zone,
  rejection_reason text,
  estimated_delivery_date date, -- NEW (PHASE 2)
  delivered_at timestamp with time zone, -- NEW (PHASE 2)
  delivery_notes text, -- NEW (PHASE 2)
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT orders_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES public.currencies(id),
  CONSTRAINT orders_zelle_account_id_fkey FOREIGN KEY (zelle_account_id) REFERENCES public.zelle_accounts(id),
  CONSTRAINT orders_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id),
  CONSTRAINT orders_shipping_zone_id_fkey FOREIGN KEY (shipping_zone_id) REFERENCES public.shipping_zones(id),
  CONSTRAINT orders_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES auth.users(id)
);

CREATE TABLE public.product_categories (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  parent_id uuid,
  image_url text,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  slug text NOT NULL,
  CONSTRAINT product_categories_pkey PRIMARY KEY (id),
  CONSTRAINT product_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id)
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  sku text NOT NULL UNIQUE,
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  category_id uuid NOT NULL,
  base_price numeric NOT NULL,
  base_currency_id uuid NOT NULL,
  cost_price numeric,
  profit_margin numeric DEFAULT 40.00,
  final_price numeric DEFAULT (base_price * ((1)::numeric + (profit_margin / (100)::numeric))),
  weight numeric,
  dimensions jsonb,
  image_url text,
  image_file text,
  requires_expiry boolean DEFAULT false,
  min_stock_alert integer DEFAULT 10,
  is_active boolean DEFAULT true,
  is_featured boolean DEFAULT false,
  tags text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id),
  CONSTRAINT products_base_currency_id_fkey FOREIGN KEY (base_currency_id) REFERENCES public.currencies(id)
);

CREATE TABLE public.remittance_services (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  source_currency_id uuid NOT NULL,
  target_currency_id uuid NOT NULL,
  min_amount numeric NOT NULL,
  max_amount numeric NOT NULL,
  fee_percent numeric DEFAULT 0,
  fixed_fee numeric DEFAULT 0,
  profit_margin numeric DEFAULT 40.00,
  delivery_type text NOT NULL,
  estimated_delivery_hours integer DEFAULT 24,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT remittance_services_pkey PRIMARY KEY (id),
  CONSTRAINT remittance_services_source_currency_id_fkey FOREIGN KEY (source_currency_id) REFERENCES public.currencies(id),
  CONSTRAINT remittance_services_target_currency_id_fkey FOREIGN KEY (target_currency_id) REFERENCES public.currencies(id)
);

CREATE TABLE public.shipping_zones (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  province_name text NOT NULL UNIQUE,
  shipping_cost numeric NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0::numeric),
  is_active boolean DEFAULT true,
  free_shipping boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  delivery_days integer DEFAULT 3, -- NEW (PHASE 2)
  transport_cost numeric(10,2) DEFAULT 0.00, -- NEW (PHASE 2)
  delivery_note text, -- NEW (PHASE 2)
  CONSTRAINT shipping_zones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.shopping_carts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  session_id uuid NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT shopping_carts_pkey PRIMARY KEY (id),
  CONSTRAINT shopping_carts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.site_visits (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  ip_address inet,
  user_agent text,
  page_url text,
  referrer text,
  country character varying,
  city text,
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  visit_time timestamp with time zone DEFAULT now(),
  session_id uuid,
  user_id uuid,
  CONSTRAINT site_visits_pkey PRIMARY KEY (id),
  CONSTRAINT site_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.system_config (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  key text NOT NULL UNIQUE,
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT system_config_pkey PRIMARY KEY (id)
);

CREATE TABLE public.system_messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  message_key text NOT NULL UNIQUE,
  title_es text,
  title_en text,
  content_es text NOT NULL,
  content_en text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT system_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.testimonials (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text NOT NULL,
  user_photo text,
  is_visible boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  order_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT testimonials_pkey PRIMARY KEY (id),
  CONSTRAINT testimonials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.user_profiles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  address text,
  city text,
  state text,
  country character varying,
  postal_code text,
  birth_date date,
  gender text,
  preferences jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  email text NOT NULL,
  role text DEFAULT 'user'::text CHECK (role = ANY (ARRAY['user'::text, 'admin'::text, 'super_admin'::text])),
  is_enabled boolean DEFAULT true,
  full_name text,
  avatar_url text,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.videos (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title_es text NOT NULL,
  title_en text NOT NULL,
  description_es text,
  description_en text,
  video_url text NOT NULL,
  thumbnail_url text,
  platform text,
  video_id text,
  duration integer,
  is_active boolean DEFAULT true,
  category text,
  tags text[],
  view_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT videos_pkey PRIMARY KEY (id)
);

CREATE TABLE public.zelle_accounts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  account_name text NOT NULL,
  email text NOT NULL,
  phone text,
  bank_name text,
  account_holder text,
  is_active boolean DEFAULT true,
  for_products boolean DEFAULT true,
  for_remittances boolean DEFAULT true,
  daily_limit numeric,
  monthly_limit numeric,
  current_daily_amount numeric DEFAULT 0,
  current_monthly_amount numeric DEFAULT 0,
  last_reset_date date DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT zelle_accounts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.zelle_payment_stats (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL,
  period_type text NOT NULL,
  period_start date,
  period_end date,
  payment_count integer DEFAULT 0,
  total_amount numeric DEFAULT 0,
  last_calculated timestamp with time zone DEFAULT now(),
  CONSTRAINT zelle_payment_stats_pkey PRIMARY KEY (id),
  CONSTRAINT zelle_payment_stats_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.zelle_accounts(id)
);

-- NEW: Views (PHASE 2)
CREATE OR REPLACE VIEW order_analytics AS
SELECT
  o.id,
  o.order_number,
  o.created_at,
  o.validated_at,
  o.status,
  o.payment_status,
  o.total_amount,
  o.shipping_cost,
  sz.transport_cost,
  sz.province_name,
  (o.shipping_address->>'municipality')::text as municipality,
  up.full_name as customer_name,
  up.email as customer_email,
  c.code as currency_code
FROM orders o
LEFT JOIN shipping_zones sz ON o.shipping_zone_id = sz.id
LEFT JOIN user_profiles up ON o.user_id = up.user_id
LEFT JOIN currencies c ON o.currency_id = c.id;
