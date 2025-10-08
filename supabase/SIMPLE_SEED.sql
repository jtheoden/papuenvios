-- SIMPLE SEED - Works with existing table structure
-- First, let's check what we have and add what's missing

-- =============================================
-- FIX CURRENCIES TABLE
-- =============================================

-- Add exchange_rate if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'currencies' AND column_name = 'exchange_rate'
    ) THEN
        ALTER TABLE public.currencies ADD COLUMN exchange_rate numeric;
    END IF;
END $$;

-- Add last_updated if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'currencies' AND column_name = 'last_updated'
    ) THEN
        ALTER TABLE public.currencies ADD COLUMN last_updated timestamptz;
    END IF;
END $$;

-- Seed currencies (using only columns that exist)
INSERT INTO public.currencies (code, name, symbol, rate)
VALUES
  ('USD', 'US Dollar', '$', 1.00),
  ('EUR', 'Euro', '€', 0.92),
  ('MXN', 'Mexican Peso', 'MXN$', 17.00),
  ('DOP', 'Dominican Peso', 'RD$', 58.50),
  ('COP', 'Colombian Peso', 'COL$', 4100.00),
  ('CUP', 'Cuban Peso', 'CUP$', 24.00),
  ('VES', 'Venezuelan Bolívar', 'Bs.', 36.50)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  symbol = EXCLUDED.symbol,
  rate = EXCLUDED.rate;

-- =============================================
-- FIX PRODUCT_CATEGORIES TABLE
-- =============================================

-- Add slug column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'slug'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN slug text UNIQUE;
    END IF;
END $$;

-- Add name_es if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'name_es'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN name_es text;
    END IF;
END $$;

-- Add name_en if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'name_en'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN name_en text;
    END IF;
END $$;

-- Add description_es if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'description_es'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN description_es text;
    END IF;
END $$;

-- Add description_en if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'description_en'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN description_en text;
    END IF;
END $$;

-- Add is_active if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN is_active boolean DEFAULT true;
    END IF;
END $$;

-- Add display_order if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories' AND column_name = 'display_order'
    ) THEN
        ALTER TABLE public.product_categories ADD COLUMN display_order integer DEFAULT 0;
    END IF;
END $$;

-- Seed categories
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
  description_en = EXCLUDED.description_en;

-- Show results
DO $$
DECLARE
  currency_count integer;
  category_count integer;
BEGIN
  SELECT COUNT(*) INTO currency_count FROM public.currencies;
  SELECT COUNT(*) INTO category_count FROM public.product_categories;

  RAISE NOTICE '✓ Setup complete!';
  RAISE NOTICE '✓ Currencies: % rows', currency_count;
  RAISE NOTICE '✓ Categories: % rows', category_count;
END $$;
