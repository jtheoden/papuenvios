import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args) => rpc(...args) }, withTimeout: (p) => p }));

import { readjustOrder } from '@/lib/orderService';
import { validateOrderReadjust, calcReadjustedOrder, ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/orderReadjustRules';

const REASON = 'La tasa vigente estaba mal al momento de la venta';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: 'o1' }, error: null });
});

describe('orderReadjustRules', () => {
  it('lists the statuses of the orders table', () => {
    expect(ORDER_STATUSES).toEqual(['pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled']);
    expect(PAYMENT_STATUSES).toEqual(['pending', 'proof_uploaded', 'validated', 'rejected']);
  });

  it('recomputes subtotal and total like the table identity: subtotal - discount + shipping + tax', () => {
    const items = [{ id: 'a', quantity: 2, unitPrice: 118.21 }];
    expect(calcReadjustedOrder({ items, discountAmount: 0, shippingCost: 0, taxAmount: 0 })).toEqual({ subtotal: 236.42, total: 236.42 });
    expect(calcReadjustedOrder({ items, discountAmount: 10, shippingCost: 5, taxAmount: 1 })).toEqual({ subtotal: 236.42, total: 232.42 });
  });

  it.each([
    ['reason too short', { reason: 'corto', status: 'pending' }, 'reason'],
    ['unit price zero', { reason: REASON, items: [{ id: 'a', unitPrice: 0 }] }, 'items'],
    ['unit price with 3 decimals', { reason: REASON, items: [{ id: 'a', unitPrice: 1.234 }] }, 'items'],
    ['line without id', { reason: REASON, items: [{ unitPrice: 5 }] }, 'items'],
    ['negative discount', { reason: REASON, discountAmount: -1 }, 'discountAmount'],
    ['negative shipping', { reason: REASON, shippingCost: -1 }, 'shippingCost'],
    ['unknown status', { reason: REASON, status: 'shipped' }, 'status'],
    ['unknown payment status', { reason: REASON, paymentStatus: 'paid' }, 'paymentStatus'],
    ['nothing to change', { reason: REASON }, 'nothing']
  ])('refuses %s', (_label, input, field) => {
    expect(validateOrderReadjust(input)).toHaveProperty(field);
  });

  it('accepts a repricing together with a status change', () => {
    expect(validateOrderReadjust({ reason: REASON, items: [{ id: 'a', unitPrice: 118.21 }], status: 'processing' })).toEqual({});
  });
});

describe('readjustOrder', () => {
  it('maps the values to the RPC parameters and sends only what was given', async () => {
    await readjustOrder('o1', { items: [{ id: 'a', unitPrice: 118.21 }], status: 'processing', paymentStatus: 'validated' }, `  ${REASON} `);
    expect(rpc).toHaveBeenCalledWith('superadmin_readjust_order', {
      p_order_id: 'o1',
      p_reason: REASON,
      p_items: [{ id: 'a', unit_price: 118.21 }],
      p_status: 'processing',
      p_payment_status: 'validated'
    });
  });

  it('sends discount and shipping when given', async () => {
    await readjustOrder('o1', { discountAmount: 5, shippingCost: 0 }, REASON);
    expect(rpc.mock.calls[0][1]).toEqual({ p_order_id: 'o1', p_reason: REASON, p_discount_amount: 5, p_shipping_cost: 0 });
  });

  it('refuses invalid input without calling the server', async () => {
    await expect(readjustOrder('o1', {}, REASON)).rejects.toBeTruthy();
    await expect(readjustOrder('o1', { status: 'pending' }, 'corto')).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the row on success and throws on a server refusal', async () => {
    await expect(readjustOrder('o1', { status: 'pending' }, REASON)).resolves.toEqual({ id: 'o1' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'stock_refused: insufficient_stock' } });
    await expect(readjustOrder('o1', { status: 'processing' }, REASON)).rejects.toBeTruthy();
  });
});
