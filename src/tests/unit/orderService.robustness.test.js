import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  orderInsertResults: [],
  orderInserts: [],
  historyResult: { error: null },
  updateResult: { error: null },
  orderRow: { id: 'ord-1', order_number: 'ORD-1', user_id: 'u1', status: 'pending', payment_status: 'pending', payment_method: 'zelle' }
};

const makeQuery = (table) => {
  let op = null;
  const q = {
    select: () => q,
    eq: () => q,
    limit: () => q,
    insert: (payload) => {
      op = 'insert';
      if (table === 'orders') state.orderInserts.push(payload);
      return q;
    },
    update: () => {
      op = 'update';
      return q;
    },
    single: async () => {
      if (table === 'orders' && op === 'insert') {
        return state.orderInsertResults.shift() ?? { data: { ...state.orderRow, id: 'new' }, error: null };
      }
      return { data: { ...state.orderRow }, error: null };
    },
    then: (resolve) => {
      if (table === 'order_status_history') return resolve(state.historyResult);
      if (table === 'orders' && op === 'update') return resolve(state.updateResult);
      return resolve({ data: [], error: null });
    }
  };
  return q;
};

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn((t) => makeQuery(t)), rpc: (...a) => rpcMock(...a) }
}));

const logErrorMock = vi.fn();
vi.mock('@/lib/errorHandler', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError: (...a) => logErrorMock(...a) };
});
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: {},
  upsertZelleTransactionStatus: vi.fn()
}));

import * as orderServiceModule from '@/lib/orderService';
import { createOrder } from '@/lib/orderService';

const baseOrderData = { userId: 'u1', totalAmount: 10, currencyId: 'c1', paymentReference: 'J', payerPhone: '+1 305 555 0100' };
const items = [{ itemType: 'combo', itemId: 'p1', nameEs: 'a', nameEn: 'a', quantity: 1, unitPrice: 10, totalPrice: 10 }];
const uniqueViolation = {
  data: null,
  error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_order_number_key"' }
};

beforeEach(() => {
  state.orderInsertResults = [];
  state.orderInserts = [];
  state.historyResult = { error: null };
  state.updateResult = { error: null };
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('createOrder order_number (assigned by the database, ND-7)', () => {
  it('does not send an order_number: the trigger set_order_number fills it', async () => {
    await createOrder(baseOrderData, items);
    expect(state.orderInserts).toHaveLength(1);
    expect(state.orderInserts[0]).not.toHaveProperty('order_number');
  });

  it('no longer exports the client-side generator', () => {
    expect(orderServiceModule.generateOrderNumber).toBeUndefined();
  });

  it('does not retry on a unique violation: it propagates', async () => {
    state.orderInsertResults = [uniqueViolation, uniqueViolation];
    await expect(createOrder(baseOrderData, items)).rejects.toMatchObject({ code: 'DB_UNIQUE_VIOLATION' });
    expect(state.orderInserts).toHaveLength(1);
  });

  it('does not retry on other errors', async () => {
    state.orderInsertResults = [{ data: null, error: { code: '42501', message: 'denied' } }];
    await expect(createOrder(baseOrderData, items)).rejects.toBeTruthy();
    expect(state.orderInserts).toHaveLength(1);
  });
});

describe('revertOrderToCancelled (reserve compensation)', () => {
  it('cancels through order_cancel and logs when that compensation fails instead of losing it', async () => {
    rpcMock.mockImplementation(async (name) =>
      name === 'order_cancel'
        ? { data: null, error: { code: '42501', message: 'not_authorized' } }
        : { data: null, error: { code: 'XX000', message: 'rpc down' } }
    );
    await expect(createOrder(baseOrderData, items)).rejects.toBeTruthy();
    const ops = logErrorMock.mock.calls.map((c) => c[1]?.operation);
    expect(ops).toContain('revertOrderToCancelled');
    expect(rpcMock).toHaveBeenCalledWith('order_cancel', { p_order_id: 'new', p_reason: 'reservation_failed' });
  });
});
