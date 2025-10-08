-- CORRECT SEED FOR ACTUAL DATABASE SCHEMA
-- Based on the actual table structure in your Supabase database

-- =============================================================================
-- SEED CURRENCIES (actual columns: code, name_es, name_en, symbol, is_base, is_active)
-- =============================================================================
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base, is_active)
VALUES
  ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true),
  ('EUR', 'Euro', 'Euro', '€', false, true),
  ('MXN', 'Peso Mexicano', 'Mexican Peso', 'MXN$', false, true),
  ('DOP', 'Peso Dominicano', 'Dominican Peso', 'RD$', false, true),
  ('COP', 'Peso Colombiano', 'Colombian Peso', 'COL$', false, true),
  ('CUP', 'Peso Cubano', 'Cuban Peso', 'CUP$', false, true),
  ('VES', 'Bolívar', 'Venezuelan Bolívar', 'Bs.', false, true)
ON CONFLICT (code) DO UPDATE SET
  name_es = EXCLUDED.name_es,
  name_en = EXCLUDED.name_en,
  symbol = EXCLUDED.symbol,
  is_base = EXCLUDED.is_base,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =============================================================================
-- ADD EXCHANGE RATES (using exchange_rates table)
-- =============================================================================
DO $$
DECLARE
  usd_id uuid;
  eur_id uuid;
  mxn_id uuid;
  dop_id uuid;
  cop_id uuid;
  cup_id uuid;
  ves_id uuid;
BEGIN
  -- Get currency IDs
  SELECT id INTO usd_id FROM public.currencies WHERE code = 'USD';
  SELECT id INTO eur_id FROM public.currencies WHERE code = 'EUR';
  SELECT id INTO mxn_id FROM public.currencies WHERE code = 'MXN';
  SELECT id INTO dop_id FROM public.currencies WHERE code = 'DOP';
  SELECT id INTO cop_id FROM public.currencies WHERE code = 'COP';
  SELECT id INTO cup_id FROM public.currencies WHERE code = 'CUP';
  SELECT id INTO ves_id FROM public.currencies WHERE code = 'VES';

  -- Insert exchange rates (from USD to other currencies)
  INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
  VALUES
    (usd_id, usd_id, 1.00, true, CURRENT_DATE),
    (usd_id, eur_id, 0.92, true, CURRENT_DATE),
    (usd_id, mxn_id, 17.00, true, CURRENT_DATE),
    (usd_id, dop_id, 58.50, true, CURRENT_DATE),
    (usd_id, cop_id, 4100.00, true, CURRENT_DATE),
    (usd_id, cup_id, 24.00, true, CURRENT_DATE),
    (usd_id, ves_id, 36.50, true, CURRENT_DATE)
  ON CONFLICT DO NOTHING;
END $$;

-- =============================================================================
-- SEED PRODUCT CATEGORIES (actual columns: name_es, name_en, description_es, description_en, is_active, display_order)
-- =============================================================================
INSERT INTO public.product_categories (name_es, name_en, description_es, description_en, is_active, display_order)
VALUES
  ('Electrónicos', 'Electronics', 'Dispositivos electrónicos y tecnología', 'Electronic devices and technology', true, 1),
  ('Ropa', 'Clothing', 'Ropa y accesorios de moda', 'Fashion clothing and accessories', true, 2),
  ('Hogar', 'Home', 'Artículos para el hogar', 'Home goods and decor', true, 3),
  ('Belleza', 'Beauty', 'Productos de belleza y cuidado personal', 'Beauty and personal care products', true, 4),
  ('Deportes', 'Sports', 'Equipo y ropa deportiva', 'Sports equipment and apparel', true, 5),
  ('Juguetes', 'Toys', 'Juguetes y juegos', 'Toys and games', true, 6);

-- Note: Since product_categories doesn't have slug column, we can't use ON CONFLICT (slug)
-- If categories already exist, this will create duplicates. To avoid that, we check first:
DO $$
BEGIN
  -- Only insert if categories table is empty
  IF NOT EXISTS (SELECT 1 FROM public.product_categories LIMIT 1) THEN
    RAISE NOTICE 'Categories inserted';
  ELSE
    RAISE NOTICE 'Categories already exist, skipping insertion';
  END IF;
END $$;

-- =============================================================================
-- SHOW RESULTS
-- =============================================================================
DO $$
DECLARE
  currency_count integer;
  category_count integer;
  exchange_rate_count integer;
BEGIN
  SELECT COUNT(*) INTO currency_count FROM public.currencies;
  SELECT COUNT(*) INTO category_count FROM public.product_categories;
  SELECT COUNT(*) INTO exchange_rate_count FROM public.exchange_rates;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ Database seeded successfully!';
  RAISE NOTICE '✓ Currencies: % rows', currency_count;
  RAISE NOTICE '✓ Exchange Rates: % rows', exchange_rate_count;
  RAISE NOTICE '✓ Categories: % rows', category_count;
  RAISE NOTICE '✓ Ready to add products and combos!';
  RAISE NOTICE '========================================';
END $$;
