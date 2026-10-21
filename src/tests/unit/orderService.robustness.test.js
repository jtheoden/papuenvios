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

import { createOrder, generateOrderNumber, updateOrderStatus, cancelOrder } from '@/lib/orderService';

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

describe('generateOrderNumber', () => {
  it('keeps the ORD-YYYYMMDD-NNNNN format and varies between calls', async () => {
    const nums = await Promise.all(Array.from({ length: 20 }, () => generateOrderNumber()));
    nums.forEach((n) => expect(n).toMatch(/^ORD-\d{8}-\d{5}$/));
    expect(new Set(nums).size).toBeGreaterThan(1);
  });
});

describe('createOrder order_number collisions', () => {
  it('retries with a NEW order number when the insert hits the order_number unique violation', async () => {
    state.orderInsertResults = [uniqueViolation];
    const result = await createOrder(baseOrderData, items);
    expect(result.id).toBe('new');
    expect(state.orderInserts).toHaveLength(2);
    expect(state.orderInserts[1].order_number).not.toBe(state.orderInserts[0].order_number);
  });

  it('gives up after a bounded number of attempts with a unique-violation error', async () => {
    state.orderInsertResults = [uniqueViolation, uniqueViolation, uniqueViolation, uniqueViolation, uniqueViolation];
    await expect(createOrder(baseOrderData, items)).rejects.toMatchObject({ code: 'DB_UNIQUE_VIOLATION' });
    expect(state.orderInserts).toHaveLength(3);
  });

  it('does not retry on other errors', async () => {
    state.orderInsertResults = [{ data: null, error: { code: '42501', message: 'denied' } }];
    await expect(createOrder(baseOrderData, items)).rejects.toBeTruthy();
    expect(state.orderInserts).toHaveLength(1);
  });

  it('does not retry on a unique violation of a different constraint', async () => {
    state.orderInsertResults = [{ data: null, error: { code: '23505', message: 'duplicate key ... "orders_other_key"' } }];
    await expect(createOrder(baseOrderData, items)).rejects.toBeTruthy();
    expect(state.orderInserts).toHaveLength(1);
  });
});

describe('revertOrderToCancelled (reserve compensation)', () => {
  it('logs when the compensating update returns an error instead of losing it', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'rpc down' } });
    state.updateResult = { error: { code: '42501', message: 'update denied' } };
    await expect(createOrder(baseOrderData, items)).rejects.toBeTruthy();
    const ops = logErrorMock.mock.calls.map((c) => c[1]?.operation);
    expect(ops).toContain('revertOrderToCancelled');
  });
});

describe('order_status_history insert errors are surfaced', () => {
  const historyErr = { error: { code: '42501', message: 'history denied' } };

  it('updateOrderStatus logs a failed history insert and still succeeds', async () => {
    state.historyResult = historyErr;
    await updateOrderStatus('ord-1', 'processing', 'admin-1', 'n');
    const ops = logErrorMock.mock.calls.map((c) => c[1]?.operation);
    expect(ops).toContain('updateOrderStatus - log history');
  });

  it('cancelOrder logs a failed history insert and still succeeds', async () => {
    state.historyResult = historyErr;
    await cancelOrder('ord-1', 'admin-1', 'reason');
    const ops = logErrorMock.mock.calls.map((c) => c[1]?.operation);
    expect(ops).toContain('cancelOrder - log history');
  });
});
