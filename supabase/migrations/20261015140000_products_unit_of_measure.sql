-- Unit of measure for products (shown next to quantities in order details).
--
-- APPLIED to production on 2026-10-15 (as `products_unit_of_measure`). It must exist BEFORE the front that
-- selects products.unit is deployed: otherwise PostgREST answers 42703 (column does not exist).
--
-- Design notes:
--   * Nullable text, no default: NULL means "no unit defined". No unit is inferred for existing rows.
--   * Allowed codes (lb, kg, pack, ...) are defined in the app (src/lib/productUnits.js), NOT as a
--     DB enum, so adding a unit never requires a migration. The CHECK only bounds the length.
--   * GRANTs/RLS: new columns inherit the table-level GRANTs and row-level policies of
--     public.products; nothing to change here.
--
-- Rollback:
--   ALTER TABLE public.products DROP COLUMN IF EXISTS unit;
--   (the CHECK constraint is dropped together with the column)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_unit_length_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_unit_length_check
      CHECK (unit IS NULL OR char_length(unit) BETWEEN 1 AND 20);
  END IF;
END
$$;

COMMENT ON COLUMN public.products.unit IS
  'Unit of measure code (e.g. lb, kg, pack) shown next to quantities in orders. NULL = not defined. Allowed codes are defined in the app (src/lib/productUnits.js).';
