-- Backup table + atomic helper for the TEMPORARY image migration
-- (supabase/functions/migrate-product-images). NOT APPLIED: the owner applies it.
--
-- Context
--   products.image_url, combo_products.image_url and carousel_slides.image_url
--   hold base64 data URIs. The edge function moves them to the product-images
--   bucket (migrated/<table>/<id>.jpg) and replaces image_url by the public URL.
--
-- What this migration creates
--   1. public._bak_image_migration_20261015: one row per migrated record with the
--      ORIGINAL data URI (needed for rollback), storage path, sha256 of the
--      decoded bytes and byte counts. RLS enabled, no policies, no grants to
--      anon/authenticated: only service_role can read/write.
--   2. public._migrate_image_row(...): service_role-only function that, in ONE
--      transaction, locks the row, checks image_url is still the exact data URI
--      the function read (sha256 of the string), copies it into the backup table
--      and updates image_url. Returns false (no change) if the row was edited
--      meanwhile. Doing it in SQL avoids sending a ~150 KB data URI inside an
--      URL filter (PostgREST URL limits) and makes backup+update atomic.
--
-- ROLLBACK of the migration itself (after the data rollback below, if needed)
--   DROP FUNCTION IF EXISTS public._migrate_image_row(text, text, text, text, text, bigint, text);
--   DROP TABLE IF EXISTS public._bak_image_migration_20261015;
--
-- DATA ROLLBACK (restore base64; run as service_role / SQL editor; per table)
--   UPDATE public.products p SET image_url = b.original_image_url
--     FROM public._bak_image_migration_20261015 b
--    WHERE b.table_name = 'products' AND b.row_id = p.id::text AND p.image_url = b.public_url;
--   (same for combo_products and carousel_slides)
--   The condition p.image_url = b.public_url keeps rows edited after the migration.
--
-- Columns used were verified against 20241001000000_complete_schema.sql and later
-- migrations: <table>.id, <table>.image_url. Tables are whitelisted in the function.

CREATE TABLE IF NOT EXISTS public._bak_image_migration_20261015 (
    id bigserial PRIMARY KEY,
    table_name text NOT NULL,
    row_id text NOT NULL,
    storage_path text NOT NULL,
    sha256 text NOT NULL,              -- sha256 (hex) of the decoded image bytes
    original_bytes bigint NOT NULL,    -- decoded image size in bytes
    original_uri_bytes bigint NOT NULL,-- size of the stored data URI string
    original_image_url text NOT NULL,  -- the original base64 data URI (for rollback)
    public_url text NOT NULL,          -- URL written to image_url
    migrated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT _bak_image_migration_table_chk
        CHECK (table_name IN ('products', 'combo_products', 'carousel_slides')),
    CONSTRAINT _bak_image_migration_row_uniq UNIQUE (table_name, row_id)
);

ALTER TABLE public._bak_image_migration_20261015 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public._bak_image_migration_20261015 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public._bak_image_migration_20261015_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public._bak_image_migration_20261015 TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public._bak_image_migration_20261015_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public._migrate_image_row(
    p_table text,
    p_id text,
    p_expected_uri_sha256 text,
    p_storage_path text,
    p_object_sha256 text,
    p_original_bytes bigint,
    p_public_url text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_current text;
BEGIN
    IF p_table NOT IN ('products', 'combo_products', 'carousel_slides') THEN
        RAISE EXCEPTION 'table not allowed: %', p_table;
    END IF;

    -- Lock the row and read the current value
    EXECUTE format('SELECT image_url FROM public.%I WHERE id::text = $1 FOR UPDATE', p_table)
        INTO v_current
        USING p_id;

    IF v_current IS NULL
       OR v_current NOT LIKE 'data:image/%'
       OR encode(sha256(convert_to(v_current, 'UTF8')), 'hex') <> lower(p_expected_uri_sha256) THEN
        RETURN false; -- row gone, already migrated or edited meanwhile: do not touch it
    END IF;

    INSERT INTO public._bak_image_migration_20261015
        (table_name, row_id, storage_path, sha256, original_bytes, original_uri_bytes, original_image_url, public_url)
    VALUES
        (p_table, p_id, p_storage_path, lower(p_object_sha256), p_original_bytes, octet_length(v_current), v_current, p_public_url)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
        storage_path = EXCLUDED.storage_path,
        sha256 = EXCLUDED.sha256,
        original_bytes = EXCLUDED.original_bytes,
        original_uri_bytes = EXCLUDED.original_uri_bytes,
        original_image_url = EXCLUDED.original_image_url,
        public_url = EXCLUDED.public_url,
        migrated_at = now();

    EXECUTE format('UPDATE public.%I SET image_url = $1 WHERE id::text = $2', p_table)
        USING p_public_url, p_id;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._migrate_image_row(text, text, text, text, text, bigint, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._migrate_image_row(text, text, text, text, text, bigint, text)
    TO service_role;
