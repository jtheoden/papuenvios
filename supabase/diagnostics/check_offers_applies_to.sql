-- ============================================================================
-- CHECK applies_to COLUMN IN OFFERS TABLE
-- ============================================================================

-- Check column definition
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'offers'
  AND column_name = 'applies_to';

-- Check if there's a CHECK constraint on applies_to
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'offers'
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) LIKE '%applies_to%';

-- Check existing values to see what's valid
SELECT DISTINCT applies_to
FROM public.offers
ORDER BY applies_to;

-- Expected values (based on typical offer systems):
-- 'all' - applies to all products/services
-- 'products' - only products
-- 'remittances' - only remittances
-- 'shipping' - only shipping costs
