-- Fixed full schema optimized for Supabase
-- Notes:
-- 1) Use auth.users for authentication data.
-- 2) Install extensions into the "extensions" schema and avoid pgcrypto for UUID generation.
-- 3) Ensure foreign keys have indexes and RLS-enabled tables have policies applied separately.

-- EXTENSIONS
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
-- Removed pgcrypto per best practices (use uuid-ossp for uuid_generate_v4)

-- 1. SYSTEM / CONFIG
CREATE TABLE IF NOT EXISTS public.system_config (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL,
    value_text TEXT,
    value_numeric DECIMAL(15,4),
    value_boolean BOOLEAN,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.currencies (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name_es TEXT NOT NULL,
    name_en TEXT NOT NULL,
    symbol TEXT NOT NULL,
    is_base BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.exchange_rates (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    from_currency_id UUID NOT NULL REFERENCES public.currencies(id),
    to_currency_id UUID NOT NULL REFERENCES public.currencies(id),
    rate DECIMAL(15,6) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_currency_pair_date UNIQUE (from_currency_id, to_currency_id, effective_date)
);

-- 2. USER PROFILES (link to auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    address TEXT,
    city TEXT,
    state TEXT,
    country VARCHAR(2),
    postal_code TEXT,
    birth_date DATE,
    gender TEXT,
    preferences JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. SITE VISITS (optional user link to auth.users)
CREATE TABLE IF NOT EXISTS public.site_visits (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    ip_address INET,
    user_agent TEXT,
    page_url TEXT,
    referrer TEXT,
    country VARCHAR(2),
    city TEXT,
    visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
    visit_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_id UUID,
    user_id UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_site_visits_date ON public.site_visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_site_visits_session ON public.site_visits(session_id);

-- 4. CONTENT
CREATE TABLE IF NOT EXISTS public.carousel_slides (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    title_es TEXT NOT NULL,
    title_en TEXT NOT NULL,
    subtitle_es TEXT,
    subtitle_en TEXT,
    image_url TEXT,
    image_file TEXT,
    link_url TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.videos (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    title_es TEXT NOT NULL,
    title_en TEXT NOT NULL,
    description_es TEXT,
    description_en TEXT,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    platform TEXT,
    video_id TEXT,
    duration INTEGER,
    is_active BOOLEAN DEFAULT true,
    category TEXT,
    tags TEXT[],
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.testimonials (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT NOT NULL,
    user_photo TEXT,
    is_visible BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    order_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. PRODUCTS & INVENTORY
CREATE TABLE IF NOT EXISTS public.product_categories (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name_es TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_es TEXT,
    description_en TEXT,
    parent_id UUID REFERENCES public.product_categories(id),
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON public.product_categories(parent_id);

CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    sku TEXT UNIQUE NOT NULL,
    name_es TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_es TEXT,
    description_en TEXT,
    category_id UUID NOT NULL REFERENCES public.product_categories(id),
    base_price DECIMAL(10,2) NOT NULL,
    base_currency_id UUID NOT NULL REFERENCES public.currencies(id),
    cost_price DECIMAL(10,2),
    profit_margin DECIMAL(5,2) DEFAULT 40.00,
    final_price DECIMAL(10,2) GENERATED ALWAYS AS (base_price * (1 + profit_margin / 100)) STORED,
    weight DECIMAL(8,3),
    dimensions JSONB,
    image_url TEXT,
    image_file TEXT,
    requires_expiry BOOLEAN DEFAULT false,
    min_stock_alert INTEGER DEFAULT 10,
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_featured ON public.products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products(final_price);

CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    -- canonical FK to products
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    batch_number TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    reserved_quantity INTEGER DEFAULT 0,
    available_quantity INTEGER GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
    cost_per_unit DECIMAL(10,2),
    expiry_date DATE,
    received_date DATE DEFAULT CURRENT_DATE,
    supplier_reference TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT check_positive_quantity CHECK (quantity >= 0),
    CONSTRAINT check_positive_reserved CHECK (reserved_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_product ON public.inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON public.inventory(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON public.inventory(product_id, available_quantity);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    inventory_id UUID NOT NULL REFERENCES public.inventory(id),
    movement_type TEXT NOT NULL,
    quantity_change INTEGER NOT NULL,
    reference_id UUID,
    reference_type TEXT,
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory ON public.inventory_movements(inventory_id);

-- 6. COMBOS
CREATE TABLE IF NOT EXISTS public.combo_products (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name_es TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_es TEXT,
    description_en TEXT,
    image_url TEXT,
    base_total_price DECIMAL(10,2) NOT NULL,
    profit_margin DECIMAL(5,2) DEFAULT 40.00,
    final_price DECIMAL(10,2) GENERATED ALWAYS AS (base_total_price * (1 + profit_margin / 100)) STORED,
    shipping_free BOOLEAN DEFAULT false,
    shipping_discount_percent DECIMAL(5,2) DEFAULT 0,
    out_of_province_shipping BOOLEAN DEFAULT true,
    out_of_province_price DECIMAL(8,2),
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.combo_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    combo_id UUID NOT NULL REFERENCES public.combo_products(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_combo_product UNIQUE (combo_id, product_id),
    CONSTRAINT positive_quantity CHECK (quantity > 0)
);

-- 7. REMITTANCES
CREATE TABLE IF NOT EXISTS public.remittance_services (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name_es TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_es TEXT,
    description_en TEXT,
    source_currency_id UUID NOT NULL REFERENCES public.currencies(id),
    target_currency_id UUID NOT NULL REFERENCES public.currencies(id),
    min_amount DECIMAL(10,2) NOT NULL,
    max_amount DECIMAL(10,2) NOT NULL,
    fee_percent DECIMAL(5,2) DEFAULT 0,
    fixed_fee DECIMAL(8,2) DEFAULT 0,
    profit_margin DECIMAL(5,2) DEFAULT 40.00,
    delivery_type TEXT NOT NULL,
    estimated_delivery_hours INTEGER DEFAULT 24,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. PAYMENTS
CREATE TABLE IF NOT EXISTS public.zelle_accounts (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    account_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    bank_name TEXT,
    account_holder TEXT,
    is_active BOOLEAN DEFAULT true,
    for_products BOOLEAN DEFAULT true,
    for_remittances BOOLEAN DEFAULT true,
    daily_limit DECIMAL(12,2),
    monthly_limit DECIMAL(12,2),
    current_daily_amount DECIMAL(12,2) DEFAULT 0,
    current_monthly_amount DECIMAL(12,2) DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.zelle_payment_stats (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.zelle_accounts(id) ON DELETE CASCADE,
    period_type TEXT NOT NULL,
    period_start DATE,
    period_end DATE,
    payment_count INTEGER DEFAULT 0,
    total_amount DECIMAL(12,2) DEFAULT 0,
    last_calculated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_account_period UNIQUE (account_id, period_type, period_start)
);

-- 9. OFFERS
CREATE TABLE IF NOT EXISTS public.offers (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    name_es TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_es TEXT,
    description_en TEXT,
    discount_type TEXT NOT NULL,
    discount_value DECIMAL(8,2) NOT NULL,
    min_purchase_amount DECIMAL(10,2),
    max_discount_amount DECIMAL(10,2),
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    applies_to TEXT NOT NULL,
    free_shipping BOOLEAN DEFAULT false,
    shipping_discount_percent DECIMAL(5,2) DEFAULT 0,
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    user_usage_limit INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_dates CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS public.offer_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    offer_id UUID NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_offer_item UNIQUE (offer_id, item_type, item_id)
);

-- 10. ORDERS & TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    order_number TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    order_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    subtotal DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    shipping_cost DECIMAL(8,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    currency_id UUID NOT NULL REFERENCES public.currencies(id),
    shipping_address JSONB,
    recipient_info JSONB,
    delivery_instructions TEXT,
    estimated_delivery DATE,
    actual_delivery DATE,
    tracking_number TEXT,
    payment_method TEXT DEFAULT 'zelle',
    payment_status TEXT DEFAULT 'pending',
    payment_reference TEXT,
    payment_proof_url TEXT,
    zelle_account_id UUID REFERENCES public.zelle_accounts(id),
    notes TEXT,
    admin_notes TEXT,
    offer_id UUID REFERENCES public.offers(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON public.orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_number ON public.orders(order_number);

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id UUID NOT NULL,
    item_name_es TEXT NOT NULL,
    item_name_en TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    inventory_id UUID REFERENCES public.inventory(id),
    remittance_amount DECIMAL(12,2),
    exchange_rate DECIMAL(15,6),
    recipient_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT positive_quantity CHECK (quantity > 0),
    CONSTRAINT positive_prices CHECK (unit_price > 0 AND total_price > 0)
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. SHOPPING Carts
CREATE TABLE IF NOT EXISTS public.shopping_carts (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    session_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cart_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    cart_id UUID NOT NULL REFERENCES public.shopping_carts(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT positive_cart_quantity CHECK (quantity > 0)
);

-- 12. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notification_settings (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    setting_type TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    notification_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT,
    content TEXT,
    status TEXT DEFAULT 'pending',
    reference_id UUID,
    reference_type TEXT,
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- INDICES
CREATE INDEX IF NOT EXISTS idx_exchange_rates_active ON public.exchange_rates(from_currency_id, to_currency_id, is_active);
CREATE INDEX IF NOT EXISTS idx_zelle_stats_account ON public.zelle_payment_stats(account_id, period_type);

-- FUNCTIONS & TRIGGERS
CREATE SEQUENCE IF NOT EXISTS public.order_sequence START 1;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('public.order_sequence')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL THEN
        NEW.order_number := public.generate_order_number();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_order_number ON public.orders;
CREATE TRIGGER trigger_set_order_number
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_order_number();

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach update_updated_at trigger to tables
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'system_config', 'currencies', 'exchange_rates', 'user_profiles',
        'carousel_slides', 'videos', 'testimonials', 'product_categories', 'products',
        'inventory', 'combo_products', 'remittance_services', 'zelle_accounts',
        'offers', 'orders', 'shopping_carts', 'notification_settings'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trigger_update_%I_updated_at ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER trigger_update_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t, t);
    END LOOP;
END $$;

-- RLS: enable on public tables that hold user data
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES (unchanged, kept as-is)
CREATE POLICY "user_profiles_select" ON public.user_profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_profiles_insert" ON public.user_profiles FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_profiles_update" ON public.user_profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_profiles_delete" ON public.user_profiles FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "testimonials_select" ON public.testimonials FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin');
CREATE POLICY "testimonials_insert" ON public.testimonials FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "testimonials_update" ON public.testimonials FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin') WITH CHECK (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin');
CREATE POLICY "testimonials_delete" ON public.testimonials FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin');

CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin');
CREATE POLICY "orders_insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin') WITH CHECK (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin');
CREATE POLICY "orders_delete" ON public.orders FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) OR (auth.jwt() ->> 'role') = 'admin');

CREATE POLICY "cart_items_select" ON public.cart_items FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.shopping_carts sc WHERE sc.id = cart_items.cart_id AND (sc.user_id = (SELECT auth.uid()) OR sc.session_id IS NOT NULL))
);
CREATE POLICY "cart_items_insert" ON public.cart_items FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.shopping_carts sc WHERE sc.id = cart_items.cart_id AND (sc.user_id = (SELECT auth.uid()) OR sc.session_id IS NOT NULL))
);
CREATE POLICY "cart_items_update" ON public.cart_items FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = (SELECT auth.uid()))
) WITH CHECK (
    EXISTS (SELECT 1 FROM public.shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = (SELECT auth.uid()))
);
CREATE POLICY "cart_items_delete" ON public.cart_items FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.shopping_carts sc WHERE sc.id = cart_items.cart_id AND sc.user_id = (SELECT auth.uid()))
);

-- INITIAL DATA (safe inserts)
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base)
VALUES
('USD','Dólar Estadounidense','US Dollar','$', true),
('CUP','Peso Cubano','Cuban Peso','$', false),
('EUR','Euro','Euro','€', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.system_config (key, value_numeric, description)
VALUES
('default_profit_margin', 40.00, 'Margen de ganancia por defecto'),
('shipping_cost_local', 5.00, 'Costo de envío local'),
('shipping_cost_national', 15.00, 'Costo de envío nacional'),
('tax_rate', 0.00, 'Tasa de impuestos')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.notification_settings (setting_type, value, description)
VALUES
('admin_whatsapp', '+15616011675', 'Número de WhatsApp para notificaciones'),
('admin_email', 'admin@papuenvios.com', 'Email de administración'),
('site_email', 'info@papuenvios.com', 'Email público del sitio')
ON CONFLICT (setting_type) DO NOTHING;

-- END OF FIXED SCRIPT
