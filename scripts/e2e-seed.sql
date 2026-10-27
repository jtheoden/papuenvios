-- Minimal fixtures for the E2E suite (local stack only). Idempotent; removed by scripts/e2e-local.sh on exit
-- (rows are matched by their e2e-seed / E2E-SEED markers; currencies USD/EUR on a fresh stack).
-- The storefront stays on "Cargando..." until at least one active exchange rate (and its currencies) exists.
INSERT INTO public.currencies (code, name_es, name_en, symbol, is_base)
SELECT v.c, 'e2e-seed-' || v.c, 'e2e-seed-' || v.c, v.s, v.b
FROM (VALUES ('USD', '$', true), ('EUR', 'EUR ', false)) AS v(c, s, b)
WHERE NOT EXISTS (SELECT 1 FROM public.currencies WHERE code = v.c);

INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate)
SELECT f.id, t.id, v.r
FROM (VALUES ('USD', 'EUR', 0.9), ('EUR', 'USD', 1.1)) AS v(a, b, r)
JOIN public.currencies f ON f.code = v.a
JOIN public.currencies t ON t.code = v.b
WHERE NOT EXISTS (SELECT 1 FROM public.exchange_rates e WHERE e.from_currency_id = f.id AND e.to_currency_id = t.id);

INSERT INTO public.product_categories (name_es, name_en, slug)
SELECT 'e2e-seed-category', 'e2e-seed-category', 'e2e-seed-category'
WHERE NOT EXISTS (SELECT 1 FROM public.product_categories WHERE slug = 'e2e-seed-category');

INSERT INTO public.products (sku, name_es, name_en, category_id, base_price, base_currency_id)
SELECT 'E2E-SEED-1', 'Producto E2E', 'E2E product', c.id, 10, cur.id
FROM public.product_categories c, public.currencies cur
WHERE c.slug = 'e2e-seed-category' AND cur.code = 'USD'
  AND NOT EXISTS (SELECT 1 FROM public.products WHERE sku = 'E2E-SEED-1');

INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
SELECT 'e2e-seed-remittance-type', 'USD', 'CUP', 100, 10, 'cash'
WHERE NOT EXISTS (SELECT 1 FROM public.remittance_types WHERE name = 'e2e-seed-remittance-type');

-- Payments must be enabled for the remittance/order flows to proceed (otherwise the UI shows "payments unavailable").
INSERT INTO public.payment_methods (code, available, enabled_for_orders, enabled_for_remittances)
VALUES ('zelle', true, true, true)
ON CONFLICT (code) DO NOTHING;

-- Offers used by the anonymous-access contract test: one visible (active, in window), one inactive, one expired.
-- `code` must be set: AdminOffersTab calls offer.code.toLowerCase() and crashes the whole dashboard on NULL
-- (the column is nullable in the schema: latent app bug, see TRACKING_PROGRESS).
INSERT INTO public.offers (name_es, name_en, code, discount_type, discount_value, start_date, end_date, applies_to, is_active)
SELECT v.n, v.n, upper(replace(v.n, '-', '')), 'percentage', 10, v.s, v.e, 'product', v.a
FROM (VALUES
  ('e2e-seed-offer-active',   now() - interval '1 day',  now() + interval '30 days', true),
  ('e2e-seed-offer-inactive', now() - interval '1 day',  now() + interval '30 days', false),
  ('e2e-seed-offer-expired',  now() - interval '30 days', now() - interval '1 day',  true)
) AS v(n, s, e, a)
WHERE NOT EXISTS (SELECT 1 FROM public.offers o WHERE o.name_es = v.n);

-- Stock so the seeded product is purchasable (otherwise the catalog shows "Agotado" and add-to-cart is unavailable).
INSERT INTO public.inventory (product_id, quantity)
SELECT p.id, 100 FROM public.products p
WHERE p.sku = 'E2E-SEED-1' AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = p.id);
