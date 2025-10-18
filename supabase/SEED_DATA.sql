-- SEED INITIAL DATA FOR PAPUENVIOS
-- Run this in Supabase SQL Editor to populate initial data

-- =============================================================================
-- CURRENCIES
-- =============================================================================
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base, is_active, exchange_rate, last_updated)
VALUES
  ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true, 1.00, now()),
  ('EUR', 'Euro', 'Euro', '€', false, true, 0.92, now()),
  ('MXN', 'Peso Dominicano', 'Dominican Peso', 'RD$', false, true, 58.50, now()),
  ('CUP', 'Peso Cubano', 'Cuban Peso', '$', false, true, 410.00, now()),
  ('VES', 'Bolívar', 'Venezuelan Bolívar', 'Bs.', false, true, 36.50, now())
ON CONFLICT (code) DO UPDATE SET
  name_es = EXCLUDED.name_es,
  name_en = EXCLUDED.name_en,
  symbol = EXCLUDED.symbol,
  exchange_rate = EXCLUDED.exchange_rate,
  last_updated = now(),
  updated_at = now();

-- =============================================================================
-- PRODUCT CATEGORIES
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

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Initial data seeded successfully!';
  RAISE NOTICE 'Currencies: % rows', (SELECT COUNT(*) FROM public.currencies);
  RAISE NOTICE 'Categories: % rows', (SELECT COUNT(*) FROM public.product_categories WHERE is_active = true);
END $$;
