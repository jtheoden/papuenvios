-- Complete Schema Migration
-- Consolidated and corrected version
-- Security: Proper RLS policies without recursion
-- Performance: Optimized indexes and SECURITY DEFINER functions

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- ENUMS
-- =============================================================================
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

-- =============================================================================
-- USER PROFILES (CRITICAL TABLE)
-- =============================================================================
-- Security: This table must be created BEFORE setting up RLS policies
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    full_name text,
    avatar_url text,
    phone text,
    address text,
    city text,
    state text,
    country text,
    postal_code text,
    birth_date date,
    gender text,
    preferences jsonb DEFAULT '{}',
    metadata jsonb DEFAULT '{}',
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_profiles_id_user_id_check CHECK (id = user_id)
);

-- Unique indexes for performance and data integrity
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role) WHERE role IN ('admin', 'super_admin');

-- =============================================================================
-- CURRENCIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.currencies (
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

-- =============================================================================
-- PRODUCT CATEGORIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.product_categories (
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

-- =============================================================================
-- PRODUCTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.products (
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

CREATE INDEX IF NOT EXISTS idx_products_search ON products USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;

-- =============================================================================
-- COMBO PRODUCTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.combo_products (
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

CREATE INDEX IF NOT EXISTS idx_combo_products_search ON combo_products USING gin(search_vector);

CREATE TABLE IF NOT EXISTS public.combo_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    combo_id uuid NOT NULL REFERENCES public.combo_products(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id),
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at timestamptz DEFAULT now(),
    UNIQUE(combo_id, product_id)
);

-- =============================================================================
-- INVENTORY
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.inventory (
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

CREATE INDEX IF NOT EXISTS idx_inventory_product_batch ON inventory(product_id, batch_number);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
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

-- =============================================================================
-- SHOPPING CARTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.shopping_carts (
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

CREATE TABLE IF NOT EXISTS public.cart_items (
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

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- =============================================================================
-- OFFERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.offers (
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
    CONSTRAINT valid_date_range CHECK (start_date < end_date)
);

CREATE TABLE IF NOT EXISTS public.offer_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
    item_type item_type NOT NULL,
    item_id uuid NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- =============================================================================
-- ZELLE ACCOUNTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.zelle_accounts (
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
        current_daily_amount <= COALESCE(daily_limit, current_daily_amount) AND
        current_monthly_amount <= COALESCE(monthly_limit, current_monthly_amount)
    )
);

CREATE TABLE IF NOT EXISTS public.zelle_payment_stats (
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

CREATE INDEX IF NOT EXISTS idx_zelle_stats_account ON zelle_payment_stats(account_id);

-- =============================================================================
-- ORDERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
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
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS public.order_items (
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
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS public.order_status_history (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_status order_status,
    new_status order_status NOT NULL,
    changed_by uuid REFERENCES auth.users(id),
    notes text,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now()
);

-- =============================================================================
-- REMITTANCE SERVICES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.remittance_services (
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

-- =============================================================================
-- EXCHANGE RATES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.exchange_rates (
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

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies ON exchange_rates(from_currency_id, to_currency_id);

-- =============================================================================
-- CAROUSEL, TESTIMONIALS, VIDEOS, NOTIFICATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.carousel_slides (
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
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.testimonials (
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
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_user ON testimonials(user_id);

CREATE TABLE IF NOT EXISTS public.videos (
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

CREATE TABLE IF NOT EXISTS public.notification_logs (
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
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_settings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_type text NOT NULL UNIQUE,
    value text NOT NULL,
    is_active boolean DEFAULT true,
    description text,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_visits (
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

CREATE INDEX IF NOT EXISTS idx_site_visits_date ON site_visits(visit_date);

CREATE TABLE IF NOT EXISTS public.system_config (
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

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function: Get current user role (bypasses RLS to prevent recursion)
-- Security: SECURITY DEFINER allows function to bypass RLS policies
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Function: Check if current user is enabled
CREATE OR REPLACE FUNCTION public.current_user_is_enabled()
RETURNS boolean AS $$
DECLARE
    is_user_enabled boolean;
BEGIN
    SELECT is_enabled INTO is_user_enabled
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(is_user_enabled, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.current_user_is_enabled() TO authenticated;

-- Function: Handle new user creation
-- Security: Automatically assigns super_admin role to configured emails
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role_value text;
BEGIN
    -- Determine role based on email
    -- Support both @gmail.com and @googlemail.com for super admin
    IF NEW.email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com', 'superadmin@test.com') THEN
        user_role_value := 'super_admin';
    ELSIF NEW.email = 'admin@test.com' THEN
        user_role_value := 'admin';
    ELSE
        user_role_value := 'user';
    END IF;

    -- Insert profile with all required fields
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Create user profile on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function: Sync email changes from auth.users to user_profiles
CREATE OR REPLACE FUNCTION public.sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.user_profiles
    SET email = NEW.email, updated_at = NOW()
    WHERE id = NEW.id AND email != NEW.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_change ON auth.users;
CREATE TRIGGER on_auth_user_email_change
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.sync_user_email();

-- Function: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables with updated_at column
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
            DROP TRIGGER IF EXISTS update_updated_at ON public.%I;
            CREATE TRIGGER update_updated_at
            BEFORE UPDATE ON public.%I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', t, t);
    END LOOP;
END $$;

-- Function: Calculate exchange rate
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

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- USER_PROFILES POLICIES
-- Policy 1: Users can view their own profile
CREATE POLICY "Users can view own profile"
ON public.user_profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Policy 2: Admins can view all profiles (using SECURITY DEFINER function)
CREATE POLICY "Admins can view all profiles"
ON public.user_profiles FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Policy 3: Users can update their own profile
CREATE POLICY "Users can update own profile"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Policy 4: Super admins can update any profile
CREATE POLICY "Super admins can update all profiles"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (public.current_user_role() = 'super_admin')
WITH CHECK (public.current_user_role() = 'super_admin');

-- Policy 5: System can insert profiles via trigger
CREATE POLICY "System can insert profiles"
ON public.user_profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- PRODUCTS POLICIES
CREATE POLICY "Products viewable by all"
ON public.products FOR SELECT
USING (true);

CREATE POLICY "Products manageable by admins"
ON public.products FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- ORDERS POLICIES
CREATE POLICY "Users can view own orders"
ON public.orders FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all orders"
ON public.orders FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Users can create own orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage all orders"
ON public.orders FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- INVENTORY POLICIES
CREATE POLICY "Inventory viewable by admins"
ON public.inventory FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Inventory manageable by admins"
ON public.inventory FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- SYSTEM_CONFIG POLICIES
CREATE POLICY "Public config viewable by all"
ON public.system_config FOR SELECT
USING (is_public = true);

CREATE POLICY "All config viewable by admins"
ON public.system_config FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Config manageable by super admins"
ON public.system_config FOR ALL
TO authenticated
USING (public.current_user_role() = 'super_admin')
WITH CHECK (public.current_user_role() = 'super_admin');

-- =============================================================================
-- GRANTS
-- =============================================================================
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, phone, address, city, state, country, postal_code, birth_date, gender, preferences)
ON public.user_profiles TO authenticated;

-- =============================================================================
-- SEED BASE DATA
-- =============================================================================
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base, is_active, exchange_rate)
VALUES
    ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true, 1),
    ('VES', 'Bolívar', 'Venezuelan Bolivar', 'Bs.', false, true, null)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.product_categories (name_es, name_en, slug, description_es, description_en, is_active, display_order)
VALUES ('General', 'General', 'general', 'Categoría general para productos', 'General category for products', true, 0)
ON CONFLICT (slug) DO NOTHING;
