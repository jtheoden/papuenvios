-- FORCE CREATE AND SEED
-- This will drop and recreate tables with correct structure

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- DROP EXISTING TABLES (in correct order due to foreign keys)
-- =============================================================================
DROP TABLE IF EXISTS public.combo_items CASCADE;
DROP TABLE IF EXISTS public.combo_products CASCADE;
DROP TABLE IF EXISTS public.inventory CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.product_categories CASCADE;
DROP TABLE IF EXISTS public.currencies CASCADE;

-- =============================================================================
-- CREATE CURRENCIES TABLE
-- =============================================================================
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

-- Seed currencies
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base, is_active, exchange_rate, last_updated)
VALUES
  ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true, 1.00, now()),
  ('EUR', 'Euro', 'Euro', '€', false, true, 0.92, now()),
  ('MXN', 'Peso Mexicano', 'Mexican Peso', 'MXN$', false, true, 17.00, now()),
  ('DOP', 'Peso Dominicano', 'Dominican Peso', 'RD$', false, true, 58.50, now()),
  ('COP', 'Peso Colombiano', 'Colombian Peso', 'COL$', false, true, 4100.00, now()),
  ('CUP', 'Peso Cubano', 'Cuban Peso', 'CUP$', false, true, 24.00, now()),
  ('VES', 'Bolívar', 'Venezuelan Bolívar', 'Bs.', false, true, 36.50, now());

-- =============================================================================
-- CREATE PRODUCT CATEGORIES TABLE
-- =============================================================================
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

-- Seed categories
INSERT INTO public.product_categories (slug, name_es, name_en, description_es, description_en, is_active, display_order)
VALUES
  ('electronics', 'Electrónicos', 'Electronics', 'Dispositivos electrónicos y tecnología', 'Electronic devices and technology', true, 1),
  ('clothing', 'Ropa', 'Clothing', 'Ropa y accesorios de moda', 'Fashion clothing and accessories', true, 2),
  ('home', 'Hogar', 'Home', 'Artículos para el hogar', 'Home goods and decor', true, 3),
  ('beauty', 'Belleza', 'Beauty', 'Productos de belleza y cuidado personal', 'Beauty and personal care products', true, 4),
  ('sports', 'Deportes', 'Sports', 'Equipo y ropa deportiva', 'Sports equipment and apparel', true, 5),
  ('toys', 'Juguetes', 'Toys', 'Juguetes y juegos', 'Toys and games', true, 6);

-- =============================================================================
-- CREATE PRODUCTS TABLE
-- =============================================================================
CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku text UNIQUE NOT NULL,
    name_es text NOT NULL,
    name_en text NOT NULL,
    slug text UNIQUE NOT NULL,
    description_es text,
    description_en text,
    category_id uuid REFERENCES public.product_categories(id),
    base_price numeric(15,2) NOT NULL CHECK (base_price >= 0),
    base_currency_id uuid REFERENCES public.currencies(id),
    cost_price numeric(15,2) CHECK (cost_price >= 0),
    profit_margin numeric(5,2) DEFAULT 40.00 CHECK (profit_margin >= 0),
    weight numeric(10,3),
    dimensions jsonb,
    images jsonb DEFAULT '[]',
    meta_data jsonb DEFAULT '{}',
    requires_expiry boolean DEFAULT false,
    min_stock_alert integer DEFAULT 10,
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    tags text[] DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = true;

-- =============================================================================
-- CREATE COMBO TABLES
-- =============================================================================
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
    shipping_free boolean DEFAULT false,
    shipping_discount_percent numeric(5,2) DEFAULT 0 CHECK (shipping_discount_percent >= 0 AND shipping_discount_percent <= 100),
    out_of_province_shipping boolean DEFAULT true,
    out_of_province_price numeric(15,2),
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
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

-- =============================================================================
-- CREATE INVENTORY TABLE
-- =============================================================================
CREATE TABLE public.inventory (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id uuid NOT NULL REFERENCES public.products(id),
    batch_number text,
    quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    cost_per_unit numeric(15,2) CHECK (cost_per_unit >= 0),
    expiry_date date,
    location text,
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_inventory_expiry ON inventory(expiry_date) WHERE expiry_date IS NOT NULL;

-- =============================================================================
-- ENABLE RLS (Row Level Security)
-- =============================================================================
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (allow authenticated users to read)
CREATE POLICY "Allow public read access" ON public.currencies FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.product_categories FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.products FOR SELECT USING (is_active = true);
CREATE POLICY "Allow public read access" ON public.combo_products FOR SELECT USING (is_active = true);
CREATE POLICY "Allow public read access" ON public.combo_items FOR SELECT USING (true);

-- Admin policies (for authenticated users with admin role)
CREATE POLICY "Allow admin full access" ON public.currencies FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Allow admin full access" ON public.product_categories FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Allow admin full access" ON public.products FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Allow admin full access" ON public.combo_products FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Allow admin full access" ON public.combo_items FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Allow admin full access" ON public.inventory FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

-- Show results
DO $$
DECLARE
  currency_count integer;
  category_count integer;
BEGIN
  SELECT COUNT(*) INTO currency_count FROM public.currencies;
  SELECT COUNT(*) INTO category_count FROM public.product_categories;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ Tables created successfully!';
  RAISE NOTICE '✓ Currencies: % rows', currency_count;
  RAISE NOTICE '✓ Categories: % rows', category_count;
  RAISE NOTICE '✓ Ready to add products and combos!';
  RAISE NOTICE '========================================';
END $$;
