import { describe, it, expect, vi, beforeEach } from 'vitest';
import golden from '../fixtures/remittanceGoldenVectors.json';

const state = { type: null, offer: null, insertPayload: null };

const baseType = (over = {}) => ({
  id: 'type-1',
  currency_code: 'USD',
  delivery_currency: 'CUP',
  exchange_rate: 800,
  commission_percentage: 0,
  commission_fixed: 0,
  min_amount: 0.01,
  max_amount: null,
  delivery_method: 'transfer',
  ...over
});

const makeQuery = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    or: () => q,
    insert: (rows) => {
      state.insertPayload = rows[0];
      return q;
    },
    single: async () => {
      if (table === 'remittance_types') return { data: state.type, error: null };
      if (table === 'offers') return { data: state.offer, error: null };
      if (table === 'remittances') {
        return { data: { id: 'rem-1', remittance_number: 'REM-1', ...state.insertPayload }, error: null };
      }
      return { data: null, error: null };
    }
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => makeQuery(table)),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) }
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshWhatsappRecipient: vi.fn() }));
vi.mock('@/lib/whatsappService', () => ({
  notifyAdminNewPaymentProof: vi.fn(),
  notifyUserPaymentValidated: vi.fn(),
  notifyUserPaymentRejected: vi.fn(),
  notifyUserRemittanceDelivered: vi.fn()
}));
vi.mock('@/lib/zelleService', () => ({
  pickAvailableZelleAccount: vi.fn(async () => ({ id: 'zelle-1' })),
  registerZelleTransaction: vi.fn(async () => ({})),
  upsertZelleTransactionStatus: vi.fn(),
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: { REMITTANCE: 'remittance' }
}));
vi.mock('@/lib/shippingService', () => ({ getActiveShippingZones: vi.fn(), calculateShippingCost: vi.fn() }));

import { calculateRemittance, calculateReverseRemittance, createRemittance } from '@/lib/remittanceService';

beforeEach(() => {
  vi.clearAllMocks();
  state.type = baseType();
  state.offer = null;
  state.insertPayload = null;
});

describe('calculateRemittance delegates to the rounding contract (golden vectors)', () => {
  it.each(golden.forward.map((v) => [v.name, v]))('%s', async (_name, v) => {
    state.type = baseType({
      exchange_rate: v.input.rate,
      commission_percentage: v.input.pct,
      commission_fixed: v.input.fixed
    });
    const r = await calculateRemittance('type-1', v.input.amount, v.input.offer);
    expect(r.amount).toBe(v.expected.amountSent);
    expect(r.exchangeRate).toBe(Number(v.input.rate.toFixed(4)));
    expect(r.originalCommission).toBe(v.expected.gross);
    expect(r.discountAmount).toBe(v.expected.discount);
    expect(r.totalCommission).toBe(v.expected.commission);
    expect(r.amountToDeliver).toBe(v.expected.amountToDeliver);
  });

  it('still validates min/max against the amount typed', async () => {
    state.type = baseType({ min_amount: 10, max_amount: 100 });
    await expect(calculateRemittance('type-1', 5)).rejects.toMatchObject({ code: expect.any(String) });
    await expect(calculateRemittance('type-1', 500)).rejects.toMatchObject({ code: expect.any(String) });
  });
});

describe('calculateReverseRemittance guarantees the recipient gets at least what was requested', () => {
  it.each(golden.reverse.map((v) => [v.name, v]))('%s', async (_name, v) => {
    state.type = baseType({
      exchange_rate: v.input.rate,
      commission_percentage: v.input.pct,
      commission_fixed: v.input.fixed
    });
    const r = await calculateReverseRemittance('type-1', v.input.desired);
    expect(r.amountToSend).toBe(v.expected.amountToSend);
    expect(r.amountToDeliver).toBe(v.expected.amountToDeliver);
    expect(r.amountToDeliver).toBeGreaterThanOrEqual(v.input.desired);
    expect(r.totalCommission).toBe(v.expected.commission);
  });

  it('validates min/max against the final amount to send', async () => {
    state.type = baseType({ min_amount: 100, max_amount: 200 });
    await expect(calculateReverseRemittance('type-1', 8000)).rejects.toMatchObject({ code: expect.any(String) }); // sends 10
    await expect(calculateReverseRemittance('type-1', 400000)).rejects.toMatchObject({ code: expect.any(String) }); // sends 500
    const ok = await calculateReverseRemittance('type-1', 80000); // sends 100
    expect(ok.amountToSend).toBe(100);
  });

  it('rejects a 100% commission type', async () => {
    state.type = baseType({ commission_percentage: 100 });
    await expect(calculateReverseRemittance('type-1', 1000)).rejects.toMatchObject({ code: expect.any(String) });
  });

  it('turns a calculation that cannot be solved into a validation error, not a raw Error', async () => {
    state.type = baseType({ exchange_rate: 0.00001 }); // rounds to 0 at 4 decimals
    await expect(calculateReverseRemittance('type-1', 1000)).rejects.toMatchObject({ code: expect.any(String) });
  });

  it('solves a 95% commission type', async () => {
    state.type = baseType({ commission_percentage: 95 });
    const r = await calculateReverseRemittance('type-1', 80000);
    expect(r.amountToDeliver).toBeGreaterThanOrEqual(80000);
  });
});

describe('createRemittance stores the rounded values of the contract', () => {
  const input = { remittance_type_id: 'type-1', recipient_name: 'Ana', recipient_phone: '+5355555555' };

  it('persists amount_sent, commission_total and amount_to_deliver rounded to cents (REM-2026-001125 case)', async () => {
    state.type = baseType({ exchange_rate: 800, commission_percentage: 2.5 });
    await createRemittance({ ...input, amount: 765 });
    expect(state.insertPayload.amount_sent).toBe(765);
    expect(state.insertPayload.commission_total).toBe(19.13);
    expect(state.insertPayload.amount_to_deliver).toBe(596696);
  });

  it('rounds a sub-cent amount before storing it and computes everything from the rounded amount', async () => {
    state.type = baseType({ exchange_rate: 780.5, commission_percentage: 0 });
    await createRemittance({ ...input, amount: 10.005 });
    expect(state.insertPayload.amount_sent).toBe(10.01);
    expect(state.insertPayload.amount_to_deliver).toBe(7812.81);
  });

  it('stored values satisfy amount_to_deliver = round((amount_sent - commission_total) * exchange_rate, 2)', async () => {
    state.type = baseType({ exchange_rate: 820, commission_percentage: 2.4390243902 });
    await createRemittance({ ...input, amount: 100 });
    const p = state.insertPayload;
    expect(p.commission_total).toBe(2.44);
    expect(p.amount_to_deliver).toBe(79999.2);
    expect(Math.round((p.amount_sent - p.commission_total) * p.exchange_rate * 100) / 100).toBe(p.amount_to_deliver);
  });

  it('stores the discount derived from the offer and the reduced commission', async () => {
    state.type = baseType({ exchange_rate: 800, commission_percentage: 2.5, commission_fixed: 1 });
    state.offer = { discount_type: 'percentage', discount_value: 15 };
    await createRemittance({ ...input, amount: 100, offer_id: 'offer-1' });
    expect(state.insertPayload.discount_amount).toBe(0.53);
    expect(state.insertPayload.commission_total).toBe(2.97);
    expect(state.insertPayload.amount_to_deliver).toBe(77624);
  });
});
