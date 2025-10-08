-- =============================================================================
-- FIX INVENTORY & CURRENCIES - RLS + Schema Updates
-- =============================================================================
-- This fixes:
-- 1. Inventory table RLS policies (403 Forbidden error)
-- 2. Currencies table schema and RLS
-- 3. Categories description fields (description_es, description_en)
-- =============================================================================

-- =============================================================================
-- STEP 1: Fix INVENTORY RLS policies (403 Forbidden error)
-- =============================================================================
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "inventory_viewable_by_everyone" ON public.inventory;
DROP POLICY IF EXISTS "inventory_manageable_by_admins" ON public.inventory;
DROP POLICY IF EXISTS "Admins can view inventory" ON public.inventory;
DROP POLICY IF EXISTS "Admins can insert inventory" ON public.inventory;
DROP POLICY IF EXISTS "Admins can update inventory" ON public.inventory;
DROP POLICY IF EXISTS "Admins can delete inventory" ON public.inventory;

-- Policy 1: Public can view inventory (read-only for product availability)
CREATE POLICY "inventory_viewable_by_everyone"
ON public.inventory FOR SELECT
TO anon, authenticated
USING (true);

-- Policy 2: Admins can manage inventory (full CRUD)
CREATE POLICY "inventory_manageable_by_admins"
ON public.inventory FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Grant permissions
GRANT SELECT ON public.inventory TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.inventory TO authenticated;

-- =============================================================================
-- STEP 2: Create/Fix CURRENCIES table
-- =============================================================================

-- Check if currencies table exists, if not create it
CREATE TABLE IF NOT EXISTS public.currencies (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name_es text NOT NULL,
    name_en text NOT NULL,
    symbol text NOT NULL,
    rate_to_usd numeric(10, 4) NOT NULL DEFAULT 1.0,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Add comment
COMMENT ON TABLE public.currencies IS 'Supported currencies for the platform (USD, EUR, CUP)';

-- Enable RLS
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "currencies_viewable_by_everyone" ON public.currencies;
DROP POLICY IF EXISTS "currencies_manageable_by_admins" ON public.currencies;

-- Policy 1: Everyone can view active currencies
CREATE POLICY "currencies_viewable_by_everyone"
ON public.currencies FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Policy 2: Admins can manage currencies (full CRUD)
CREATE POLICY "currencies_manageable_by_admins"
ON public.currencies FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Grant permissions
GRANT SELECT ON public.currencies TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.currencies TO authenticated;

-- Check if rate_to_usd column exists, if not add it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='currencies' AND column_name='rate_to_usd') THEN
        ALTER TABLE public.currencies ADD COLUMN rate_to_usd numeric(10, 4) NOT NULL DEFAULT 1.0;
    END IF;
END $$;

-- Insert default currencies (Cuba market: USD, EUR, CUP)
INSERT INTO public.currencies (code, name_es, name_en, symbol, rate_to_usd, is_active, display_order)
VALUES
    ('USD', 'Dólar Estadounidense', 'US Dollar', '$', 1.0, true, 1),
    ('EUR', 'Euro', 'Euro', '€', 1.10, true, 2),
    ('CUP', 'Peso Cubano', 'Cuban Peso', '₱', 0.0083, true, 3)
ON CONFLICT (code) DO UPDATE SET
    name_es = EXCLUDED.name_es,
    name_en = EXCLUDED.name_en,
    symbol = EXCLUDED.symbol,
    rate_to_usd = EXCLUDED.rate_to_usd,
    updated_at = now();

-- =============================================================================
-- STEP 3: Add description fields to product_categories
-- =============================================================================

-- Add description_es and description_en if they don't exist
ALTER TABLE public.product_categories
ADD COLUMN IF NOT EXISTS description_es text DEFAULT '',
ADD COLUMN IF NOT EXISTS description_en text DEFAULT '';

-- Add comment
COMMENT ON COLUMN public.product_categories.description_es IS 'Category description in Spanish';
COMMENT ON COLUMN public.product_categories.description_en IS 'Category description in English';

-- =============================================================================
-- STEP 4: Fix INVENTORY_MOVEMENTS RLS policies
-- =============================================================================
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "inventory_movements_viewable_by_admins" ON public.inventory_movements;
DROP POLICY IF EXISTS "inventory_movements_manageable_by_admins" ON public.inventory_movements;

-- Policy 1: Admins can view all movements
CREATE POLICY "inventory_movements_viewable_by_admins"
ON public.inventory_movements FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Policy 2: Admins can manage movements (full CRUD)
CREATE POLICY "inventory_movements_manageable_by_admins"
ON public.inventory_movements FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Grant permissions
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;

-- =============================================================================
-- STEP 5: Update timestamps trigger for currencies
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS update_currencies_updated_at ON public.currencies;

-- Create trigger
CREATE TRIGGER update_currencies_updated_at
    BEFORE UPDATE ON public.currencies
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check inventory policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'inventory';

-- Check currencies policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'currencies';

-- Check categories columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'product_categories'
AND column_name IN ('description_es', 'description_en', 'slug');

-- Check currencies data
SELECT code, name_es, name_en, symbol, rate_to_usd, is_active
FROM public.currencies
ORDER BY display_order;

-- =============================================================================
-- COMPLETION MESSAGE
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Inventory RLS policies fixed';
    RAISE NOTICE '✅ Currencies table created with USD, EUR, CUP';
    RAISE NOTICE '✅ Categories description fields added';
    RAISE NOTICE '✅ All RLS policies applied successfully';
END $$;
