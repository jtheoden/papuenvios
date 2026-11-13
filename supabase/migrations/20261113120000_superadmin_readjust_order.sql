-- ============================================================================
-- Super admin readjustment of an order already made.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: when the catalog rate was wrong at the moment of a sale, the order keeps prices (and therefore a profit, which is
--   derived from order_items.total_price and the catalog margin) that differ from what the business really earned.
--   guard_orders_money_columns and guard_status_via_rpc refuse every direct change and no RPC reprices an order.
--   Case that motivated it: ORD-20261111-100019, cancelled after its payment was validated ("cambio tasas"), 2 x 124.00
--   that must become 2 x 118.21, reopened, with its pending refund closed and the stock discounted again.
--
-- WHAT:
--   * public.order_readjustments: append-only history (who, why, before/after snapshots including the lines).
--     Readable by super admins only. financial_audit_log keeps every changed money column but has no reason.
--   * public.superadmin_readjust_order(...): SECURITY DEFINER, super admin only. Reprices lines (unit_price,
--     total_price), optionally changes discount and shipping, recomputes subtotal and total keeping
--     orders_money_total_identity_chk, and moves status / payment_status. It passes guard_orders_money_columns and
--     guard_status_via_rpc because both refuse only current_user authenticated/anon and a DEFINER function runs as its
--     owner. It never touches refund_requests: moving an order out of 'cancelled' fires trg_refund_request_on_reopen,
--     which closes the pending refund as not_applicable ('reopened'); moving it into 'cancelled' fires
--     trg_refund_request_on_cancel and release_stock_on_order_cancel.
--   * Stock: when the resulting order is stock managed, active (pending or processing) and payment validated, the
--     function calls consume_order_inventory, which reserves (overwriting a 'restocked' allocation) and consumes it,
--     with the inventory ledger entries. If the stock cannot be consumed the whole call fails (stock_refused).
--   * A super admin cannot readjust an order that belongs to himself (separation of duties;
--     trg_orders_admin_self_dealing also fires inside the function).
--
-- NOT DONE ON PURPOSE (documented limits, shown to the user in the form):
--   * The difference between what the customer paid and the new total is NOT refunded or credited automatically.
--   * Dates (validated_at, delivered_at...) are kept; validated_at is set only if the payment becomes validated and it
--     was empty. A courier accrual already created is not recalculated.
--
-- Preconditions: is_super_admin(), consume_order_inventory, refund triggers, financial_audit_log. Idempotent.
-- ROLLBACK: supabase/rollbacks/20261113120000_superadmin_readjust_order_down.sql
-- Needs the owner's "dale" to apply remotely.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.order_readjustments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  set_by     uuid NOT NULL,
  reason     text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  before     jsonb NOT NULL,
  after      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_readjustments_order_idx
  ON public.order_readjustments (order_id, created_at DESC);

ALTER TABLE public.order_readjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_readjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_readjustments TO authenticated;

DROP POLICY IF EXISTS order_readjustments_select_super_admin ON public.order_readjustments;
CREATE POLICY order_readjustments_select_super_admin ON public.order_readjustments
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

CREATE OR REPLACE FUNCTION public.superadmin_readjust_order(
  p_order_id       uuid,
  p_reason         text,
  p_items          jsonb DEFAULT NULL,
  p_discount_amount numeric DEFAULT NULL,
  p_shipping_cost  numeric DEFAULT NULL,
  p_status         text DEFAULT NULL,
  p_payment_status text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_reason       text := btrim(COALESCE(p_reason, ''));
  v_ord          public.orders%ROWTYPE;
  v_item         jsonb;
  v_price        numeric;
  v_items_before jsonb;
  v_items_after  jsonb;
  v_before       jsonb;
  v_subtotal     numeric;
  v_discount     numeric;
  v_shipping     numeric;
  v_total        numeric;
  v_status       text;
  v_payment      text;
  v_res          jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can readjust an order' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_array_length(p_items), 0) = 0 AND p_discount_amount IS NULL AND p_shipping_cost IS NULL
     AND p_status IS NULL AND p_payment_status IS NULL THEN
    RAISE EXCEPTION 'nothing_to_change: give at least one value to readjust' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('order_readjust'));

  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ord.user_id = v_uid THEN
    RAISE EXCEPTION 'own_operation_not_allowed: another administrator must readjust your own order' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: % is not an order status', p_status USING ERRCODE = '22023';
  END IF;
  IF p_payment_status IS NOT NULL AND p_payment_status NOT IN ('pending', 'proof_uploaded', 'validated', 'rejected') THEN
    RAISE EXCEPTION 'invalid_payment_status: % is not a payment status', p_payment_status USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'unit_price', i.unit_price, 'quantity', i.quantity) ORDER BY i.id), '[]'::jsonb)
    INTO v_items_before FROM public.order_items i WHERE i.order_id = p_order_id;

  -- Reprice the given lines (only lines of this order).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_price := (v_item ->> 'unit_price')::numeric;
    IF v_price IS NULL OR v_price <= 0 OR v_price <> round(v_price, 2) THEN
      RAISE EXCEPTION 'invalid_item: the unit price must be greater than 0 with at most 2 decimals' USING ERRCODE = '22023';
    END IF;
    UPDATE public.order_items
       SET unit_price  = v_price,
           total_price = round(v_price * quantity, 2)
     WHERE id = (v_item ->> 'id')::uuid AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_item: line % does not belong to this order', v_item ->> 'id' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'unit_price', i.unit_price, 'quantity', i.quantity) ORDER BY i.id), '[]'::jsonb)
    INTO v_items_after FROM public.order_items i WHERE i.order_id = p_order_id;

  v_subtotal := CASE WHEN COALESCE(jsonb_array_length(p_items), 0) > 0
                     THEN (SELECT COALESCE(sum(i.total_price), 0) FROM public.order_items i WHERE i.order_id = p_order_id)
                     ELSE v_ord.subtotal END;
  v_discount := COALESCE(p_discount_amount, v_ord.discount_amount, 0);
  v_shipping := COALESCE(p_shipping_cost, v_ord.shipping_cost, 0);
  IF v_discount < 0 OR v_discount > v_subtotal OR v_discount <> round(v_discount, 2) THEN
    RAISE EXCEPTION 'invalid_discount: must be between 0 and the subtotal, with at most 2 decimals' USING ERRCODE = '22023';
  END IF;
  IF v_shipping < 0 OR v_shipping <> round(v_shipping, 2) THEN
    RAISE EXCEPTION 'invalid_shipping: must be 0 or more, with at most 2 decimals' USING ERRCODE = '22023';
  END IF;
  v_total := round(v_subtotal - v_discount + v_shipping + COALESCE(v_ord.tax_amount, 0), 2);
  IF v_subtotal <= 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: subtotal and total must be greater than 0' USING ERRCODE = '22023';
  END IF;

  v_status := COALESCE(p_status, v_ord.status);
  v_payment := COALESCE(p_payment_status, v_ord.payment_status);

  IF v_items_after = v_items_before AND v_subtotal = v_ord.subtotal AND v_discount = COALESCE(v_ord.discount_amount, 0)
     AND v_shipping = COALESCE(v_ord.shipping_cost, 0) AND v_total = v_ord.total_amount
     AND v_status = v_ord.status AND v_payment = v_ord.payment_status THEN
    RAISE EXCEPTION 'nothing_to_change: the given values equal the current ones' USING ERRCODE = '22023';
  END IF;

  v_before := jsonb_build_object(
    'status', v_ord.status, 'payment_status', v_ord.payment_status, 'subtotal', v_ord.subtotal,
    'discount_amount', v_ord.discount_amount, 'shipping_cost', v_ord.shipping_cost,
    'total_amount', v_ord.total_amount, 'items', v_items_before
  );

  -- audit_order_status_change copies this note into order_status_history.
  PERFORM set_config('app.status_note', 'Super admin readjustment: ' || v_reason, true);

  UPDATE public.orders
     SET subtotal        = v_subtotal,
         discount_amount = v_discount,
         shipping_cost   = v_shipping,
         total_amount    = v_total,
         status          = v_status,
         payment_status  = v_payment,
         validated_at    = CASE WHEN v_payment = 'validated' THEN COALESCE(validated_at, now()) ELSE validated_at END,
         validated_by    = CASE WHEN v_payment = 'validated' THEN COALESCE(validated_by, v_uid) ELSE validated_by END,
         updated_at      = now()
   WHERE id = p_order_id;

  PERFORM set_config('app.status_note', '', true);

  -- An active, paid, stock managed order must have its units discounted from the inventory.
  IF v_ord.stock_managed AND v_status IN ('pending', 'processing') AND v_payment = 'validated' THEN
    v_res := public.consume_order_inventory(p_order_id);
    IF NOT COALESCE((v_res ->> 'ok')::boolean, false) THEN
      RAISE EXCEPTION 'stock_refused: %', COALESCE(v_res ->> 'reason', 'unknown') USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id;

  INSERT INTO public.order_readjustments (order_id, set_by, reason, before, after)
  VALUES (
    p_order_id, v_uid, v_reason, v_before,
    jsonb_build_object(
      'status', v_ord.status, 'payment_status', v_ord.payment_status, 'subtotal', v_ord.subtotal,
      'discount_amount', v_ord.discount_amount, 'shipping_cost', v_ord.shipping_cost,
      'total_amount', v_ord.total_amount, 'items', v_items_after
    )
  );

  RETURN v_ord;
END;
$function$;

REVOKE ALL ON FUNCTION public.superadmin_readjust_order(uuid, text, jsonb, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_readjust_order(uuid, text, jsonb, numeric, numeric, text, text) TO authenticated;

COMMIT;
