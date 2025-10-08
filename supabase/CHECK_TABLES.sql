-- Check what tables and columns exist
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM
    information_schema.columns
WHERE
    table_schema = 'public'
    AND table_name IN ('currencies', 'products', 'product_categories', 'combo_products')
ORDER BY
    table_name, ordinal_position;
