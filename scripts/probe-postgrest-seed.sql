-- Probe fixtures for the LOCAL scratch database used by scripts/probe-postgrest-local.sh.
-- Gives every guarded table at least one row with NON-NULL cost/margin values, so the before-B phase can
-- show the leak as real values and a failed embed cannot hide behind an empty result.
-- Idempotent. Refuses to run anywhere but a papuenvios_test* database.

DO $guard$
BEGIN
  IF current_database() NOT LIKE 'papuenvios\_test%' THEN
    RAISE EXCEPTION 'probe seed refused: % is not a papuenvios_test* scratch database', current_database();
  END IF;
END
$guard$;

BEGIN;
-- Fixture data: bypass user triggers (role guards, reset locks) exactly like scripts/test-db-seed.sql.
SET LOCAL session_replication_role = replica;

UPDATE public.products
   SET cost_price = 3.21, base_price = 12.34, profit_margin = 25, is_active = true
 WHERE id = 'e2e00000-0000-4000-8000-0000000000f2';

UPDATE public.product_categories
   SET profit_margin = 15, is_active = true
 WHERE id = 'e2e00000-0000-4000-8000-0000000000f1';

INSERT INTO public.combo_products (id, name_es, name_en, base_total_price, profit_margin, is_active)
VALUES ('e2e00000-0000-4000-8000-0000000000c1', 'Combo probe', 'Probe combo', 20.5, 30, true)
ON CONFLICT (id) DO UPDATE SET base_total_price = 20.5, profit_margin = 30, is_active = true;

INSERT INTO public.combo_items (id, combo_id, product_id, quantity)
VALUES ('e2e00000-0000-4000-8000-0000000000c2', 'e2e00000-0000-4000-8000-0000000000c1', 'e2e00000-0000-4000-8000-0000000000f2', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.inventory (id, product_id, batch_number, quantity, cost_per_unit, supplier_reference, is_active)
VALUES ('e2e00000-0000-4000-8000-0000000000a1', 'e2e00000-0000-4000-8000-0000000000f2', 'probe-seed', 10, 2.5, 'SUPPLIER-PROBE', true)
ON CONFLICT (id) DO UPDATE SET cost_per_unit = 2.5, supplier_reference = 'SUPPLIER-PROBE', is_active = true;

INSERT INTO public.shipping_zones (id, province_name, municipality_name, shipping_cost, transport_cost, is_active)
VALUES ('e2e00000-0000-4000-8000-0000000000b1', 'Probe Province', 'Probe Municipality', 5, 3.5, true)
ON CONFLICT (id) DO UPDATE SET shipping_cost = 5, transport_cost = 3.5, is_active = true;

INSERT INTO public.remittance_services (id, name_es, name_en, source_currency_id, target_currency_id, min_amount, max_amount,
                                        fee_percent, fixed_fee, profit_margin, delivery_type, is_active)
VALUES ('e2e00000-0000-4000-8000-0000000000d1', 'Servicio probe', 'Probe service',
        'e2e00000-0000-4000-8000-000000000001', 'e2e00000-0000-4000-8000-000000000002', 1, 1000, 2, 1, 4.5, 'cash', true)
ON CONFLICT (id) DO UPDATE SET profit_margin = 4.5, fixed_fee = 1;

-- One order owned by the e2e customer, tied to the probe zone: order_analytics then returns a row for them.
INSERT INTO public.orders (id, user_id, order_type, status, subtotal, total_amount, currency_id,
                           payment_status, payment_method, stock_managed, order_number, shipping_zone_id)
VALUES ('e2e00000-0000-4000-8000-0000000000e1', '9026d846-b1a8-482f-95b4-8ec8e67c1555', 'product', 'pending', 10, 10,
        'e2e00000-0000-4000-8000-000000000001', 'pending', 'zelle', false, 'PROBE-0001', 'e2e00000-0000-4000-8000-0000000000b1')
ON CONFLICT (id) DO NOTHING;

COMMIT;
