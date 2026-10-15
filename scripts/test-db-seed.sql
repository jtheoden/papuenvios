-- Minimal, idempotent seed for the LOCAL scratch test database (see scripts/test-db-bootstrap.sh).
-- The schema clone is structure-only, so the data the concurrency harness expects is created here:
-- two e2e users (customer + admin), one currency set, one category and one product.
-- Same identifiers as the e2e stack so tests that resolve actors by e-mail keep working.
-- Never run this against anything but the scratch database.

BEGIN;

-- Bypass user triggers while seeding (role guards, updated_at, reset locks): this is fixture data.
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000000', '9026d846-b1a8-482f-95b4-8ec8e67c1555', 'authenticated', 'authenticated',
   'e2e.customer@example.test', extensions.crypt('e2e-not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"E2E Customer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd9dd264f-116c-4b0c-b1e2-4760fd61f7bd', 'authenticated', 'authenticated',
   'e2e.admin@example.test', extensions.crypt('e2e-not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"E2E Admin"}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- The auth trigger is bypassed above (replica role), so create the profiles explicitly.
INSERT INTO public.user_profiles (id, user_id, email, role, full_name, is_enabled)
VALUES
  ('9026d846-b1a8-482f-95b4-8ec8e67c1555', '9026d846-b1a8-482f-95b4-8ec8e67c1555', 'e2e.customer@example.test', 'user', 'E2E Customer', true),
  ('d9dd264f-116c-4b0c-b1e2-4760fd61f7bd', 'd9dd264f-116c-4b0c-b1e2-4760fd61f7bd', 'e2e.admin@example.test', 'admin', 'E2E Admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.currencies (id, code, name_es, name_en, symbol, is_base, is_active)
VALUES
  ('e2e00000-0000-4000-8000-000000000001', 'USD', 'Dolar estadounidense', 'US Dollar', '$', true, true),
  ('e2e00000-0000-4000-8000-000000000002', 'CUP', 'Peso cubano', 'Cuban Peso', '$', false, true),
  ('e2e00000-0000-4000-8000-000000000003', 'EUR', 'Euro', 'Euro', 'EUR', false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_categories (id, name_es, name_en, slug)
VALUES ('e2e00000-0000-4000-8000-0000000000f1', 'Categoria E2E', 'E2E Category', 'e2e-category')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, sku, name_es, name_en, category_id, base_price, base_currency_id)
VALUES ('e2e00000-0000-4000-8000-0000000000f2', 'E2E-SKU-001', 'Producto E2E', 'E2E Product',
        'e2e00000-0000-4000-8000-0000000000f1', 5, 'e2e00000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Reference data that migration 20261014170000 seeds. That migration is BELOW the replay window
-- (the schema clone is structure-only, so its INSERT never ran): restate it here, same values.
INSERT INTO public.payment_methods (code, available, enabled_for_orders, enabled_for_remittances)
VALUES ('zelle', true, true, true), ('bizum', false, false, false)
ON CONFLICT (code) DO NOTHING;

COMMIT;
