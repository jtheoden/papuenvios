-- Fix products table RLS to allow public read access
-- This allows the REST API to fetch products without authentication

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Products viewable by all" ON public.products;

-- Create new policy that allows anonymous SELECT access
CREATE POLICY "Products viewable by everyone"
ON public.products FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Also allow public read access to product_categories
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categories viewable by all" ON public.product_categories;

CREATE POLICY "Categories viewable by everyone"
ON public.product_categories FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Grant necessary permissions
GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.product_categories TO anon;
