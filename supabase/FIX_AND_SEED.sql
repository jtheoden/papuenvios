-- FIX AND SEED DATA FOR PAPUENVIOS
-- This will create tables if missing and seed initial data

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CREATE CURRENCIES TABLE IF NOT EXISTS
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
-- CREATE PRODUCT CATEGORIES TABLE IF NOT EXISTS
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
-- SEED CURRENCIES
-- =============================================================================
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base, is_active, exchange_rate, last_updated)
VALUES
  ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true, 1.00, now()),
  ('EUR', 'Euro', 'Euro', '€', false, true, 0.92, now()),
  ('MXN', 'Peso Mexicano', 'Mexican Peso', 'MXN$', false, true, 17.00, now()),
  ('DOP', 'Peso Dominicano', 'Dominican Peso', 'RD$', false, true, 58.50, now()),
  ('COP', 'Peso Colombiano', 'Colombian Peso', 'COL$', false, true, 4100.00, now()),
  ('CUP', 'Peso Cubano', 'Cuban Peso', 'CUP$', false, true, 24.00, now()),
  ('VES', 'Bolívar', 'Venezuelan Bolívar', 'Bs.', false, true, 36.50, now())
ON CONFLICT (code) DO UPDATE SET
  name_es = EXCLUDED.name_es,
  name_en = EXCLUDED.name_en,
  symbol = EXCLUDED.symbol,
  exchange_rate = EXCLUDED.exchange_rate,
  last_updated = now(),
  updated_at = now();

-- =============================================================================
-- SEED PRODUCT CATEGORIES
-- =============================================================================
INSERT INTO public.product_categories (slug, name_es, name_en, description_es, description_en, is_active, display_order)
VALUES
  ('electronics', 'Electrónicos', 'Electronics', 'Dispositivos electrónicos y tecnología', 'Electronic devices and technology', true, 1),
  ('clothing', 'Ropa', 'Clothing', 'Ropa y accesorios de moda', 'Fashion clothing and accessories', true, 2),
  ('home', 'Hogar', 'Home', 'Artículos para el hogar', 'Home goods and decor', true, 3),
  ('beauty', 'Belleza', 'Beauty', 'Productos de belleza y cuidado personal', 'Beauty and personal care products', true, 4),
  ('sports', 'Deportes', 'Sports', 'Equipo y ropa deportiva', 'Sports equipment and apparel', true, 5),
  ('toys', 'Juguetes', 'Toys', 'Juguetes y juegos', 'Toys and games', true, 6)
ON CONFLICT (slug) DO UPDATE SET
  name_es = EXCLUDED.name_es,
  name_en = EXCLUDED.name_en,
  description_es = EXCLUDED.description_es,
  description_en = EXCLUDED.description_en,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = now();

-- =============================================================================
-- CREATE PRODUCTS TABLE IF NOT EXISTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.products (
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

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;

-- =============================================================================
-- CREATE COMBO TABLES IF NOT EXISTS
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
    shipping_free boolean DEFAULT false,
    shipping_discount_percent numeric(5,2) DEFAULT 0 CHECK (shipping_discount_percent >= 0 AND shipping_discount_percent <= 100),
    out_of_province_shipping boolean DEFAULT true,
    out_of_province_price numeric(15,2),
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.combo_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    combo_id uuid NOT NULL REFERENCES public.combo_products(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id),
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at timestamptz DEFAULT now(),
    UNIQUE(combo_id, product_id)
);

-- =============================================================================
-- CREATE INVENTORY TABLE IF NOT EXISTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.inventory (
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

CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date) WHERE expiry_date IS NOT NULL;

-- Success message
DO $$
DECLARE
  currency_count integer;
  category_count integer;
BEGIN
  SELECT COUNT(*) INTO currency_count FROM public.currencies;
  SELECT COUNT(*) INTO category_count FROM public.product_categories WHERE is_active = true;

  RAISE NOTICE '✓ Tables created successfully!';
  RAISE NOTICE '✓ Currencies: % rows', currency_count;
  RAISE NOTICE '✓ Categories: % rows', category_count;
  RAISE NOTICE '✓ Ready to add products and combos!';
END $$;
