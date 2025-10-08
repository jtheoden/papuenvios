-- Add missing columns to existing tables

-- Add exchange_rate column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'currencies'
        AND column_name = 'exchange_rate'
    ) THEN
        ALTER TABLE public.currencies ADD COLUMN exchange_rate numeric;
        RAISE NOTICE 'Added exchange_rate column to currencies table';
    END IF;
END $$;

-- Add last_updated column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'currencies'
        AND column_name = 'last_updated'
    ) THEN
        ALTER TABLE public.currencies ADD COLUMN last_updated timestamptz;
        RAISE NOTICE 'Added last_updated column to currencies table';
    END IF;
END $$;

-- Now seed the data
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
  last_updated = now();

-- Seed product categories
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
  display_order = EXCLUDED.display_order;

-- Show results
DO $$
DECLARE
  currency_count integer;
  category_count integer;
BEGIN
  SELECT COUNT(*) INTO currency_count FROM public.currencies;
  SELECT COUNT(*) INTO category_count FROM public.product_categories WHERE is_active = true;

  RAISE NOTICE '✓ Currencies: % rows', currency_count;
  RAISE NOTICE '✓ Categories: % rows', category_count;
  RAISE NOTICE '✓ Ready to use!';
END $$;
