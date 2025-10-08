-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For better text search

-- Create custom types and enums
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');
    CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
    CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
    CREATE TYPE payment_method AS ENUM ('zelle', 'crypto', 'wire_transfer');
    CREATE TYPE notification_type AS ENUM ('email', 'sms', 'push');
    CREATE TYPE movement_type AS ENUM ('purchase', 'sale', 'adjustment', 'return');
    CREATE TYPE item_type AS ENUM ('product', 'combo', 'remittance');
    CREATE TYPE delivery_type AS ENUM ('bank_transfer', 'cash_pickup', 'mobile_money');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Drop all existing tables if needed
DROP TABLE IF EXISTS 
    public.zelle_payment_stats,
    public.zelle_accounts,
    public.videos,
    public.user_profiles,
    public.testimonials,
    public.system_config,
    public.site_visits,
    public.shopping_carts,
    public.remittance_services,
    public.products,
    public.product_categories,
    public.orders,
    public.order_status_history,
    public.order_items,
    public.offers,
    public.offer_items,
    public.notification_settings,
    public.notification_logs,
    public.inventory_movements,
    public.inventory,
    public.exchange_rates,
    public.currencies,
    public.combo_products,
    public.combo_items,
    public.cart_items,
    public.carousel_slides CASCADE;

-- Create base tables first (no foreign keys)
CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id),
    role user_role NOT NULL DEFAULT 'user',
    full_name text,
    avatar_url text,
    phone text,
    address jsonb,
    preferences jsonb DEFAULT '{}',
    metadata jsonb DEFAULT '{}',
    is_enabled boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.currencies (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    code text NOT NULL UNIQUE,
    name_es text NOT NULL,
    name_en text NOT NULL,
    symbol text NOT NULL,
    decimal_places smallint DEFAULT 2,
    is_base boolean DEFAULT false,
    is_active boolean DEFAULT true,
    exchange_rate numeric,
    last_updated timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_decimal_places CHECK (decimal_places >= 0 AND decimal_places <= 8)
);

CREATE TABLE public.product_categories (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id uuid REFERENCES public.product_categories(id),
    name_es text NOT NULL,
    name_en text NOT NULL,
    slug text UNIQUE NOT NULL,
    description_es text,
    description_en text,
    image_url text,
    meta_title jsonb DEFAULT '{}',
    meta_description jsonb DEFAULT '{}',
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku text UNIQUE NOT NULL,
    name_es text NOT NULL,
    name_en text NOT NULL,
    slug text UNIQUE NOT NULL,
    description_es text,
    description_en text,
    category_id uuid NOT NULL REFERENCES public.product_categories(id),
    base_price numeric(15,2) NOT NULL CHECK (base_price >= 0),
    base_currency_id uuid NOT NULL REFERENCES public.currencies(id),
    cost_price numeric(15,2) CHECK (cost_price >= 0),
    profit_margin numeric(5,2) DEFAULT 40.00 CHECK (profit_margin >= 0),
    final_price numeric(15,2) GENERATED ALWAYS AS (
        CASE 
            WHEN base_price IS NOT NULL AND profit_margin IS NOT NULL 
            THEN round(base_price * (1 + profit_margin / 100), 2)
            ELSE NULL
        END
    ) STORED,
    weight numeric(10,3),
    dimensions jsonb,
    images jsonb DEFAULT '[]',
    meta_data jsonb DEFAULT '{}',
    requires_expiry boolean DEFAULT false,
    min_stock_alert integer DEFAULT 10,
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    tags text[] DEFAULT '{}',
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(name_es, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(name_en, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(description_es, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description_en, '')), 'B')
    ) STORED,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.combo_products (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_es text NOT NULL,
    name_en text NOT NULL,
    slug text UNIQUE NOT NULL,
    description_es text,
    description_en text,
    image_url text,
    base_total_price numeric(15,2) NOT NULL CHECK (base_total_price >= 0),
    profit_margin numeric(5,2) DEFAULT 40.00 CHECK (profit_margin >= 0),
    final_price numeric(15,2) GENERATED ALWAYS AS (
        round(base_total_price * (1 + profit_margin / 100), 2)
    ) STORED,
    shipping_free boolean DEFAULT false,
    shipping_discount_percent numeric(5,2) DEFAULT 0 CHECK (shipping_discount_percent >= 0 AND shipping_discount_percent <= 100),
    out_of_province_shipping boolean DEFAULT true,
    out_of_province_price numeric(15,2),
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(name_es, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(name_en, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(description_es, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description_en, '')), 'B')
    ) STORED,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.combo_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    combo_id uuid NOT NULL REFERENCES public.combo_products(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id),
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at timestamptz DEFAULT now(),
    UNIQUE(combo_id, product_id)
);

CREATE TABLE public.inventory (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id uuid NOT NULL REFERENCES public.products(id),
    batch_number text,
    quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    available_quantity integer GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
    cost_per_unit numeric(15,2) CHECK (cost_per_unit >= 0),
    expiry_date date,
    received_date date DEFAULT CURRENT_DATE,
    supplier_reference text,
    notes text,
    metadata jsonb DEFAULT '{}',
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_quantities CHECK (reserved_quantity <= quantity)
);

CREATE TABLE public.inventory_movements (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    inventory_id uuid NOT NULL REFERENCES public.inventory(id),
    movement_type movement_type NOT NULL,
    quantity_change integer NOT NULL,
    reference_id uuid,
    reference_type item_type,
    notes text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    CONSTRAINT valid_reference CHECK (
        (reference_id IS NULL AND reference_type IS NULL) OR
        (reference_id IS NOT NULL AND reference_type IS NOT NULL)
    )
);

CREATE TABLE public.shopping_carts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id),
    session_id uuid NOT NULL,
    currency_id uuid NOT NULL REFERENCES public.currencies(id),
    metadata jsonb DEFAULT '{}',
    expires_at timestamptz DEFAULT (now() + '30 days'::interval),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT require_user_or_session CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

CREATE TABLE public.cart_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    cart_id uuid NOT NULL REFERENCES public.shopping_carts(id) ON DELETE CASCADE,
    item_type item_type NOT NULL,
    item_id uuid NOT NULL,
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price numeric(15,2) NOT NULL,
    total_price numeric(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    metadata jsonb DEFAULT '{}',
    added_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.offers (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_es text NOT NULL,
    name_en text NOT NULL,
    description_es text,
    description_en text,
    discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
    discount_value numeric(15,2) NOT NULL CHECK (
        (discount_type = 'percentage' AND discount_value > 0 AND discount_value <= 100) OR
        (discount_type = 'fixed_amount' AND discount_value > 0)
    ),
    min_purchase_amount numeric(15,2),
    max_discount_amount numeric(15,2),
    currency_id uuid NOT NULL REFERENCES public.currencies(id),
    start_date timestamptz NOT NULL,
    end_date timestamptz NOT NULL,
    applies_to item_type NOT NULL,
    free_shipping boolean DEFAULT false,
    shipping_discount_percent numeric(5,2) DEFAULT 0 CHECK (shipping_discount_percent >= 0 AND shipping_discount_percent <= 100),
    usage_limit integer CHECK (usage_limit > 0),
    usage_count integer DEFAULT 0,
    user_usage_limit integer DEFAULT 1 CHECK (user_usage_limit > 0),
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_date_range CHECK (start_date < end_date),
    CONSTRAINT valid_amounts CHECK (
        min_purchase_amount IS NULL OR
        max_discount_amount IS NULL OR
        min_purchase_amount <= max_discount_amount
    )
);

CREATE TABLE public.offer_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
    item_type item_type NOT NULL,
    item_id uuid NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE public.zelle_accounts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_name text NOT NULL,
    email text NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    phone text,
    bank_name text,
    account_holder text NOT NULL,
    is_active boolean DEFAULT true,
    for_products boolean DEFAULT true,
    for_remittances boolean DEFAULT true,
    daily_limit numeric(15,2) CHECK (daily_limit > 0),
    monthly_limit numeric(15,2) CHECK (monthly_limit > daily_limit),
    current_daily_amount numeric(15,2) DEFAULT 0 CHECK (current_daily_amount >= 0),
    current_monthly_amount numeric(15,2) DEFAULT 0 CHECK (current_monthly_amount >= 0),
    last_reset_date date DEFAULT CURRENT_DATE,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_limits CHECK (
        current_daily_amount <= daily_limit AND
        current_monthly_amount <= monthly_limit
    )
);

CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number text NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    order_type item_type NOT NULL,
    status order_status NOT NULL DEFAULT 'pending',
    subtotal numeric(15,2) NOT NULL CHECK (subtotal >= 0),
    discount_amount numeric(15,2) DEFAULT 0 CHECK (discount_amount >= 0),
    shipping_cost numeric(15,2) DEFAULT 0 CHECK (shipping_cost >= 0),
    tax_amount numeric(15,2) DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount numeric(15,2) NOT NULL CHECK (total_amount >= 0),
    currency_id uuid NOT NULL REFERENCES public.currencies(id),
    shipping_address jsonb,
    recipient_info jsonb,
    delivery_instructions text,
    estimated_delivery date,
    actual_delivery date,
    tracking_number text,
    payment_method payment_method DEFAULT 'zelle',
    payment_status payment_status DEFAULT 'pending',
    payment_reference text,
    payment_proof_url text,
    zelle_account_id uuid REFERENCES public.zelle_accounts(id),
    notes text,
    admin_notes text,
    offer_id uuid REFERENCES public.offers(id),
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_delivery_dates CHECK (
        actual_delivery IS NULL OR
        estimated_delivery IS NULL OR
        actual_delivery >= estimated_delivery
    ),
    CONSTRAINT valid_total CHECK (
        total_amount = subtotal - COALESCE(discount_amount, 0) + COALESCE(shipping_cost, 0) + COALESCE(tax_amount, 0)
    )
);

CREATE TABLE public.order_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    item_type item_type NOT NULL,
    item_id uuid NOT NULL,
    item_name_es text NOT NULL,
    item_name_en text NOT NULL,
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price numeric(15,2) NOT NULL CHECK (unit_price >= 0),
    total_price numeric(15,2) NOT NULL CHECK (total_price >= 0),
    inventory_id uuid REFERENCES public.inventory(id),
    remittance_amount numeric(15,2),
    exchange_rate numeric(15,6),
    recipient_data jsonb,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    CONSTRAINT valid_remittance_data CHECK (
        (item_type = 'remittance' AND remittance_amount IS NOT NULL AND exchange_rate IS NOT NULL AND recipient_data IS NOT NULL) OR
        (item_type != 'remittance' AND remittance_amount IS NULL AND exchange_rate IS NULL AND recipient_data IS NULL)
    )
);

CREATE TABLE public.order_status_history (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_status order_status,
    new_status order_status NOT NULL,
    changed_by uuid REFERENCES auth.users(id),
    notes text,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE public.carousel_slides (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title_es text NOT NULL,
    title_en text NOT NULL,
    subtitle_es text,
    subtitle_en text,
    image_url text NOT NULL,
    mobile_image_url text,
    link_url text,
    display_order integer NOT NULL DEFAULT 0,
    starts_at timestamptz,
    ends_at timestamptz,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_date_range CHECK (
        starts_at IS NULL OR
        ends_at IS NULL OR
        starts_at < ends_at
    )
);

CREATE TABLE public.exchange_rates (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_currency_id uuid NOT NULL REFERENCES public.currencies(id),
    to_currency_id uuid NOT NULL REFERENCES public.currencies(id),
    rate numeric(20,6) NOT NULL CHECK (rate > 0),
    source text,
    is_active boolean DEFAULT true,
    effective_date date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT different_currencies CHECK (from_currency_id != to_currency_id),
    CONSTRAINT unique_daily_rate UNIQUE (from_currency_id, to_currency_id, effective_date)
);

CREATE TABLE public.notification_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_type notification_type NOT NULL,
    recipient text NOT NULL,
    subject text,
    content text,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    reference_id uuid,
    reference_type text,
    error_message text,
    metadata jsonb DEFAULT '{}',
    sent_at timestamptz,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT valid_email_recipient CHECK (
        notification_type != 'email' OR 
        recipient ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

CREATE TABLE public.notification_settings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_type text NOT NULL UNIQUE,
    value text NOT NULL,
    is_active boolean DEFAULT true,
    description text,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.remittance_services (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_es text NOT NULL,
    name_en text NOT NULL,
    description_es text,
    description_en text,
    source_currency_id uuid NOT NULL REFERENCES public.currencies(id),
    target_currency_id uuid NOT NULL REFERENCES public.currencies(id),
    min_amount numeric(15,2) NOT NULL CHECK (min_amount > 0),
    max_amount numeric(15,2) NOT NULL CHECK (max_amount > min_amount),
    fee_percent numeric(5,2) DEFAULT 0 CHECK (fee_percent >= 0),
    fixed_fee numeric(15,2) DEFAULT 0 CHECK (fixed_fee >= 0),
    profit_margin numeric(5,2) DEFAULT 40.00 CHECK (profit_margin >= 0),
    delivery_type delivery_type NOT NULL,
    estimated_delivery_hours integer DEFAULT 24 CHECK (estimated_delivery_hours > 0),
    is_active boolean DEFAULT true,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT different_currencies CHECK (source_currency_id != target_currency_id)
);

CREATE TABLE public.site_visits (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address inet,
    user_agent text,
    page_url text NOT NULL,
    referrer text,
    country character varying(2),
    city text,
    device_type text,
    browser text,
    visit_date date NOT NULL DEFAULT CURRENT_DATE,
    visit_time timestamptz DEFAULT now(),
    session_id uuid,
    user_id uuid REFERENCES auth.users(id),
    metadata jsonb DEFAULT '{}'
);

CREATE TABLE public.system_config (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    key text NOT NULL UNIQUE,
    value_text text,
    value_numeric numeric,
    value_boolean boolean,
    value_json jsonb,
    description text,
    is_public boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT one_value_type CHECK (
        (CASE WHEN value_text IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN value_numeric IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN value_boolean IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN value_json IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE TABLE public.testimonials (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES auth.users(id),
    order_id uuid REFERENCES public.orders(id),
    rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title text,
    comment text NOT NULL,
    response text,
    response_by uuid REFERENCES auth.users(id),
    response_at timestamptz,
    is_verified boolean DEFAULT false,
    is_visible boolean DEFAULT false,
    is_featured boolean DEFAULT false,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_response CHECK (
        (response IS NULL AND response_by IS NULL AND response_at IS NULL) OR
        (response IS NOT NULL AND response_by IS NOT NULL AND response_at IS NOT NULL)
    )
);

CREATE TABLE public.videos (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title_es text NOT NULL,
    title_en text NOT NULL,
    description_es text,
    description_en text,
    video_url text NOT NULL,
    thumbnail_url text,
    platform text CHECK (platform IN ('youtube', 'vimeo', 'custom')),
    video_id text,
    duration integer CHECK (duration > 0),
    is_active boolean DEFAULT true,
    category text,
    tags text[] DEFAULT '{}',
    view_count integer DEFAULT 0 CHECK (view_count >= 0),
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.zelle_accounts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_name text NOT NULL,
    email text NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    phone text,
    bank_name text,
    account_holder text NOT NULL,
    is_active boolean DEFAULT true,
    for_products boolean DEFAULT true,
    for_remittances boolean DEFAULT true,
    daily_limit numeric(15,2) CHECK (daily_limit > 0),
    monthly_limit numeric(15,2) CHECK (monthly_limit > daily_limit),
    current_daily_amount numeric(15,2) DEFAULT 0 CHECK (current_daily_amount >= 0),
    current_monthly_amount numeric(15,2) DEFAULT 0 CHECK (current_monthly_amount >= 0),
    last_reset_date date DEFAULT CURRENT_DATE,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT valid_limits CHECK (
        current_daily_amount <= daily_limit AND
        current_monthly_amount <= monthly_limit
    )
);

CREATE TABLE public.zelle_payment_stats (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id uuid NOT NULL REFERENCES public.zelle_accounts(id),
    period_type text NOT NULL CHECK (period_type IN ('daily', 'monthly')),
    period_start date NOT NULL,
    period_end date NOT NULL,
    payment_count integer DEFAULT 0 CHECK (payment_count >= 0),
    total_amount numeric(15,2) DEFAULT 0 CHECK (total_amount >= 0),
    metadata jsonb DEFAULT '{}',
    last_calculated timestamptz DEFAULT now(),
    CONSTRAINT valid_period CHECK (period_start <= period_end)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_combo_products_search ON combo_products USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_inventory_product_batch ON inventory(product_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies ON exchange_rates(from_currency_id, to_currency_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_date ON site_visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_testimonials_user ON testimonials(user_id);
CREATE INDEX IF NOT EXISTS idx_zelle_stats_account ON zelle_payment_stats(account_id);

-- Create functions for common operations
CREATE OR REPLACE FUNCTION calculate_exchange_rate(
    from_currency uuid,
    to_currency uuid,
    amount numeric
) RETURNS numeric AS $$
DECLARE
    rate numeric;
BEGIN
    SELECT er.rate INTO rate
    FROM exchange_rates er
    WHERE er.from_currency_id = from_currency
    AND er.to_currency_id = to_currency
    AND er.is_active = true
    AND er.effective_date <= CURRENT_DATE
    ORDER BY er.effective_date DESC
    LIMIT 1;

    IF rate IS NULL THEN
        RAISE EXCEPTION 'No exchange rate found for the specified currencies';
    END IF;

    RETURN amount * rate;
END;
$$ LANGUAGE plpgsql;

-- Create RLS policies
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (extend these based on your needs)
CREATE POLICY "Products are viewable by everyone"
    ON public.products FOR SELECT
    USING (true);

CREATE POLICY "Orders are viewable by the owner"
    ON public.orders FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Inventory is viewable by admins"
    ON public.inventory FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid()
            AND (role = 'admin' OR role = 'super_admin')
        )
    );

CREATE POLICY "System config public items are viewable by everyone"
    ON public.system_config FOR SELECT
    USING (is_public = true);

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id,
        role,
        full_name,
        avatar_url,
        is_enabled
    )
    VALUES (
        NEW.id,
        CASE 
            WHEN NEW.email = 'jtheoden@gmail.com' THEN 'super_admin'
            ELSE 'user'
        END,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            split_part(NEW.email, '@', 1)
        ),
        COALESCE(
            NEW.raw_user_meta_data->>'avatar_url',
            'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(sha256(NEW.email::bytea), 'hex')
        ),
        true
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for automatic profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to automatically update updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all relevant tables
DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
    LOOP
        EXECUTE format('
            CREATE TRIGGER update_updated_at
            BEFORE UPDATE ON public.%I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', t);
    END LOOP;
END $$;

-- Create trigger functions for item reference validation
CREATE OR REPLACE FUNCTION public.validate_cart_item_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.item_type = 'product' AND NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid product reference';
    ELSIF NEW.item_type = 'combo' AND NOT EXISTS (SELECT 1 FROM combo_products WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid combo reference';
    ELSIF NEW.item_type = 'remittance' AND NOT EXISTS (SELECT 1 FROM remittance_services WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid remittance service reference';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.validate_offer_item_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.item_type = 'product' AND NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid product reference';
    ELSIF NEW.item_type = 'combo' AND NOT EXISTS (SELECT 1 FROM combo_products WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid combo reference';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.validate_order_item_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.item_type = 'product' AND NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid product reference';
    ELSIF NEW.item_type = 'combo' AND NOT EXISTS (SELECT 1 FROM combo_products WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid combo reference';
    ELSIF NEW.item_type = 'remittance' AND NOT EXISTS (SELECT 1 FROM remittance_services WHERE id = NEW.item_id) THEN
        RAISE EXCEPTION 'Invalid remittance service reference';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for item reference validation
CREATE TRIGGER validate_cart_item_reference_trigger
BEFORE INSERT OR UPDATE ON public.cart_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_cart_item_reference();

CREATE TRIGGER validate_offer_item_reference_trigger
BEFORE INSERT OR UPDATE ON public.offer_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_offer_item_reference();

CREATE TRIGGER validate_order_item_reference_trigger
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_item_reference();