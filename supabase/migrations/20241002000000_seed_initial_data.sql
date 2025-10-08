-- Seed Initial Data
-- Adds base currencies, categories, and sample data

-- =============================================================================
-- CURRENCIES
-- =============================================================================
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base, is_active, exchange_rate)
VALUES
  ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true, 1.00),
  ('EUR', 'Euro', 'Euro', '€', false, true, 0.92),
  ('DOP', 'Peso Dominicano', 'Dominican Peso', 'RD$', false, true, 58.50),
  ('COP', 'Peso Colombiano', 'Colombian Peso', '$', false, true, 4100.00),
  ('VES', 'Bolívar', 'Venezuelan Bolívar', 'Bs.', false, true, 36.50)
ON CONFLICT (code) DO UPDATE SET
  name_es = EXCLUDED.name_es,
  name_en = EXCLUDED.name_en,
  symbol = EXCLUDED.symbol,
  exchange_rate = EXCLUDED.exchange_rate,
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
  updated_at = now();

-- =============================================================================
-- HELPER FUNCTION: Get currency ID by code
-- =============================================================================
CREATE OR REPLACE FUNCTION get_currency_id(currency_code text)
RETURNS uuid AS $$
DECLARE
  currency_uuid uuid;
BEGIN
  SELECT id INTO currency_uuid
  FROM public.currencies
  WHERE code = currency_code
  LIMIT 1;
  RETURN currency_uuid;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- HELPER FUNCTION: Get category ID by slug
-- =============================================================================
CREATE OR REPLACE FUNCTION get_category_id(category_slug text)
RETURNS uuid AS $$
DECLARE
  category_uuid uuid;
BEGIN
  SELECT id INTO category_uuid
  FROM public.product_categories
  WHERE slug = category_slug
  LIMIT 1;
  RETURN category_uuid;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- SAMPLE PRODUCTS (Optional - only insert if products table is empty)
-- =============================================================================
DO $$
DECLARE
  product_count integer;
  usd_id uuid;
  electronics_id uuid;
  clothing_id uuid;
  home_id uuid;
BEGIN
  SELECT COUNT(*) INTO product_count FROM public.products;

  IF product_count = 0 THEN
    -- Get currency and category IDs
    usd_id := get_currency_id('USD');
    electronics_id := get_category_id('electronics');
    clothing_id := get_category_id('clothing');
    home_id := get_category_id('home');

    -- Insert sample products
    INSERT INTO public.products (
      sku, name_es, name_en, slug,
      description_es, description_en,
      category_id, base_price, base_currency_id,
      profit_margin, is_active, is_featured
    )
    VALUES
      (
        'IPHONE15PM', 'iPhone 15 Pro Max', 'iPhone 15 Pro Max', 'iphone-15-pro-max',
        'Último iPhone con sistema de cámara avanzado', 'Latest iPhone with advanced camera system',
        electronics_id, 1199.00, usd_id, 40.00, true, true
      ),
      (
        'GALAXYS24U', 'Samsung Galaxy S24 Ultra', 'Samsung Galaxy S24 Ultra', 'samsung-galaxy-s24-ultra',
        'Smartphone Android premium con S Pen', 'Premium Android smartphone with S Pen',
        electronics_id, 1299.00, usd_id, 40.00, true, true
      ),
      (
        'AIRJORDAN1', 'Nike Air Jordan 1', 'Nike Air Jordan 1', 'nike-air-jordan-1',
        'Zapatillas de baloncesto clásicas', 'Classic basketball sneakers',
        clothing_id, 170.00, usd_id, 40.00, true, false
      );

    RAISE NOTICE 'Sample products inserted successfully';
  ELSE
    RAISE NOTICE 'Products table is not empty, skipping sample data';
  END IF;
END $$;
