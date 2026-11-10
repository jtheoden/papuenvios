import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { inserts: [] };

const makeQuery = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    single: async () => ({ data: { id: 'new-order', order_number: 'ORD-1', status: 'pending' }, error: null }),
    insert: (payload) => {
      state.inserts.push({ table, payload });
      return q;
    },
    update: () => q,
    then: (resolve) => resolve({ data: [], error: null })
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => makeQuery(table)),
    rpc: vi.fn(async () => ({ data: { ok: true, reason: null }, error: null })),
    storage: { from: vi.fn(() => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'x' } }) })) }
  }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: {},
  upsertZelleTransactionStatus: vi.fn()
}));

import { createOrder } from '@/lib/orderService';

beforeEach(() => {
  state.inserts = [];
  vi.clearAllMocks();
});

describe('orderService.createOrder - defensive cent rounding', () => {
  it('rounds order and item amounts half-up before inserting', async () => {
    await createOrder(
      {
        userId: 'user-1',
        subtotal: 44.805,
        discountAmount: 1.005,
        shippingCost: 6,
        totalAmount: 49.8,
        currencyId: 'c1',
        payerPhone: '+13055550100'
      },
      [{ itemType: 'combo', itemId: 'c1', nameEs: 'a', nameEn: 'a', quantity: 1, unitPrice: 44.805, totalPrice: 44.805 }]
    );

    const order = state.inserts.find((i) => i.table === 'orders').payload;
    expect(order.subtotal).toBe(44.81);
    expect(order.discount_amount).toBe(1.01);
    expect(order.total_amount).toBe(49.8);

    const item = state.inserts.find((i) => i.table === 'order_items').payload[0];
    expect(item.unit_price).toBe(44.81);
    expect(item.total_price).toBe(44.81);
  });
});
