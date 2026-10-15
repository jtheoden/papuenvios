import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORDER = {
  id: 'ord-1',
  order_number: 'ORD-1',
  user_id: 'user-1',
  status: 'pending',
  payment_status: 'rejected',
  payment_method: 'zelle',
  total_amount: 10,
  payment_reference: 'John'
};

const state = { inserts: [], updatePayload: null, fromCalls: 0 };
const uploadMock = vi.fn(async () => ({ error: null }));

// Thenable chain: awaiting any step resolves to an empty successful result,
// .single() resolves to the order row.
const makeQuery = (table) => {
  const result = { data: [], error: null };
  const q = {
    select: () => q,
    eq: () => q,
    single: async () => ({ data: { ...ORDER, id: 'new-order' }, error: null }),
    insert: (payload) => {
      state.inserts.push({ table, payload });
      return q;
    },
    update: (payload) => {
      state.updatePayload = payload;
      return q;
    },
    then: (resolve) => resolve(result)
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => {
      state.fromCalls += 1;
      return makeQuery(table);
    }),
    // createOrder reserves stock through the atomic RPC
    rpc: vi.fn(async () => ({ data: { ok: true, reason: null }, error: null })),
    storage: {
      from: vi.fn(() => ({
        upload: (...args) => uploadMock(...args),
        getPublicUrl: () => ({ data: { publicUrl: 'https://x.test/proof.png' } })
      }))
    }
  }
}));

const logActivityMock = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: (...a) => logActivityMock(...a) }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: {},
  upsertZelleTransactionStatus: vi.fn()
}));

import { createOrder, uploadPaymentProof } from '@/lib/orderService';

const PHONE = '  +1 305 555 0100  ';
const file = new File(['x'], 'proof.png', { type: 'image/png' });
const baseOrderData = { userId: 'user-1', totalAmount: 10, currencyId: 'c1', paymentReference: 'John' };
const items = [
  { itemType: 'combo', itemId: 'p1', nameEs: 'a', nameEn: 'a', quantity: 1, unitPrice: 10, totalPrice: 10 }
];

beforeEach(() => {
  state.inserts = [];
  state.updatePayload = null;
  state.fromCalls = 0;
  vi.clearAllMocks();
});

describe('orderService.createOrder payer phone', () => {
  it('persists the trimmed payer_phone in the orders insert', async () => {
    await createOrder({ ...baseOrderData, payerPhone: PHONE }, items);
    const orderInsert = state.inserts.find((i) => i.table === 'orders');
    expect(orderInsert.payload.payer_phone).toBe('+1 305 555 0100');
  });

  it.each([[undefined], [''], ['   '], ['abc'], ['123']])(
    'rejects payerPhone=%j before touching the database',
    async (payerPhone) => {
      await expect(createOrder({ ...baseOrderData, payerPhone }, items)).rejects.toMatchObject({
        code: expect.any(String)
      });
      expect(state.fromCalls).toBe(0);
      expect(state.inserts).toHaveLength(0);
    }
  );
});

describe('orderService.uploadPaymentProof payer phone (late upload)', () => {
  it.each([[undefined], [''], ['abc']])(
    'rejects payerPhone=%j before fetching the order or uploading to storage',
    async (payerPhone) => {
      await expect(
        uploadPaymentProof(file, 'ord-1', 'user-1', 'John', { payerPhone })
      ).rejects.toMatchObject({ code: expect.any(String) });
      expect(uploadMock).not.toHaveBeenCalled();
      expect(state.fromCalls).toBe(0);
      expect(state.updatePayload).toBeNull();
    }
  );

  it('rejects when called with the legacy signature (no options)', async () => {
    await expect(uploadPaymentProof(file, 'ord-1', 'user-1', 'John')).rejects.toBeTruthy();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('persists the trimmed payer_phone in the proof update and keeps it out of activity_logs', async () => {
    await uploadPaymentProof(file, 'ord-1', 'user-1', 'John', { payerPhone: PHONE });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(state.updatePayload.payer_phone).toBe('+1 305 555 0100');
    expect(JSON.stringify(logActivityMock.mock.calls)).not.toContain('305');
  });
});
