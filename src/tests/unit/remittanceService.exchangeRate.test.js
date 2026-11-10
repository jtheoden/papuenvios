/**
 * A1 - the remittance rate is fail-closed.
 * Precedence (unchanged): same currency -> 1; the type's own rate wins; otherwise the central exchange_rates rate.
 * No usable rate (or an error while looking it up) must throw a typed error, never fall back to a rate of 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { type: null, offer: null, insertPayload: null };

const baseType = (over = {}) => ({
  id: 'type-1',
  currency_code: 'USD',
  delivery_currency: 'CUP',
  exchange_rate: 915,
  commission_percentage: 3,
  commission_fixed: 0,
  min_amount: 1,
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
// The lookup failure paths log through logError; keep test output quiet.
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import { getExchangeRate } from '@/lib/currencyService';
import { ERROR_CODES } from '@/lib/errorHandler';
import {
  getRemittanceExchangeRate,
  calculateRemittance,
  calculateReverseRemittance,
  createRemittance
} from '@/lib/remittanceService';

const UNAVAILABLE = { code: ERROR_CODES.EXCHANGE_RATE_UNAVAILABLE };

beforeEach(() => {
  vi.clearAllMocks();
  state.type = baseType();
  state.offer = null;
  state.insertPayload = null;
});

describe('error code', () => {
  it('EXCHANGE_RATE_UNAVAILABLE exists as a stable string', () => {
    expect(ERROR_CODES.EXCHANGE_RATE_UNAVAILABLE).toBe('EXCHANGE_RATE_UNAVAILABLE');
  });
});

describe('getRemittanceExchangeRate truth table', () => {
  it('same currency is 1:1 and needs no lookup, even without a type rate', async () => {
    await expect(getRemittanceExchangeRate('USD', 'USD', null)).resolves.toEqual({ rate: 1, source: 'configured' });
    expect(getExchangeRate).not.toHaveBeenCalled();
  });

  it('the type rate wins over the central rate and the central table is not even queried', async () => {
    getExchangeRate.mockResolvedValue(900);
    await expect(getRemittanceExchangeRate('USD', 'CUP', 915)).resolves.toEqual({ rate: 915, source: 'type' });
    expect(getExchangeRate).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], [0], [-5], ['abc']])('type rate %j falls through to the central rate', async (typeRate) => {
    getExchangeRate.mockResolvedValue(900);
    await expect(getRemittanceExchangeRate('USD', 'CUP', typeRate)).resolves.toEqual({ rate: 900, source: 'configured' });
    expect(getExchangeRate).toHaveBeenCalledWith('USD', 'CUP');
  });

  it.each([[null], [undefined], [0], [-1], [NaN]])('central rate %j without a type rate throws the typed error (never rate 1)', async (central) => {
    getExchangeRate.mockResolvedValue(central);
    await expect(getRemittanceExchangeRate('USD', 'CUP', null)).rejects.toMatchObject(UNAVAILABLE);
  });

  it('a failing central lookup throws the typed error instead of returning the type rate or 1', async () => {
    getExchangeRate.mockRejectedValue(new Error('network down'));
    await expect(getRemittanceExchangeRate('USD', 'CUP', null)).rejects.toMatchObject(UNAVAILABLE);
  });

  it('the typed error names the pair so the UI/log can say which rate is missing', async () => {
    getExchangeRate.mockResolvedValue(null);
    await expect(getRemittanceExchangeRate('USD', 'CUP', null)).rejects.toMatchObject({
      context: expect.objectContaining({ from: 'USD', to: 'CUP' })
    });
  });
});

describe('calculateRemittance / calculateReverseRemittance / createRemittance fail closed', () => {
  const input = { remittance_type_id: 'type-1', recipient_name: 'Ana', recipient_phone: '+5355555555', amount: 100 };

  it('forward: type without a rate and no central rate throws, it does not calculate at rate 1', async () => {
    state.type = baseType({ exchange_rate: null });
    getExchangeRate.mockResolvedValue(null);
    await expect(calculateRemittance('type-1', 100)).rejects.toMatchObject(UNAVAILABLE);
  });

  it('forward: type without a rate uses the central rate', async () => {
    state.type = baseType({ exchange_rate: null, commission_percentage: 0 });
    getExchangeRate.mockResolvedValue(900);
    const r = await calculateRemittance('type-1', 100);
    expect(r.exchangeRate).toBe(900);
    expect(r.exchangeRateSource).toBe('configured');
    expect(r.amountToDeliver).toBe(90000);
  });

  it('reverse: type with a null rate asks the central table (no silent rate 1)', async () => {
    state.type = baseType({ exchange_rate: null, commission_percentage: 0 });
    getExchangeRate.mockResolvedValue(900);
    const r = await calculateReverseRemittance('type-1', 90000);
    expect(getExchangeRate).toHaveBeenCalledWith('USD', 'CUP');
    expect(r.exchangeRate).toBe(900);
    expect(r.amountToSend).toBe(100);
  });

  it('reverse: type with a null rate and no central rate throws the typed error', async () => {
    state.type = baseType({ exchange_rate: null });
    getExchangeRate.mockResolvedValue(null);
    await expect(calculateReverseRemittance('type-1', 90000)).rejects.toMatchObject(UNAVAILABLE);
  });

  it('a USD->USD type keeps working without any configured rate', async () => {
    state.type = baseType({ currency_code: 'USD', delivery_currency: 'USD', exchange_rate: null, commission_percentage: 0 });
    const r = await calculateRemittance('type-1', 50);
    expect(r.exchangeRate).toBe(1);
    expect(r.amountToDeliver).toBe(50);
    const rev = await calculateReverseRemittance('type-1', 50);
    expect(rev.exchangeRate).toBe(1);
    expect(getExchangeRate).not.toHaveBeenCalled();
  });

  it('createRemittance inserts nothing when no rate is available', async () => {
    state.type = baseType({ exchange_rate: null });
    getExchangeRate.mockResolvedValue(null);
    await expect(createRemittance(input)).rejects.toMatchObject(UNAVAILABLE);
    expect(state.insertPayload).toBeNull();
  });
});

describe('createRemittance real payload', () => {
  const input = { remittance_type_id: 'type-1', recipient_name: 'Ana', recipient_phone: '+5355555555', amount: 100 };

  it('stores the rate, currencies and commission of the calculation', async () => {
    await createRemittance(input);
    expect(state.insertPayload).toMatchObject({
      user_id: 'user-1',
      remittance_type_id: 'type-1',
      amount_sent: 100,
      exchange_rate: 915,
      commission_percentage: 3,
      commission_fixed: 0,
      commission_total: 3,
      amount_to_deliver: 88755,
      currency_sent: 'USD',
      currency_delivered: 'CUP',
      payment_method: 'zelle',
      zelle_account_id: 'zelle-1'
    });
  });

  it('sends no discount_amount without an offer, even if the caller passes one', async () => {
    await createRemittance({ ...input, discount_amount: 5 });
    expect(state.insertPayload).not.toHaveProperty('discount_amount');
    expect(state.insertPayload).not.toHaveProperty('offer_id');
  });

  it('with an offer, the stored discount is the one of the calculation', async () => {
    state.offer = { discount_type: 'percentage', discount_value: 50 };
    await createRemittance({ ...input, offer_id: 'offer-1' });
    expect(state.insertPayload.offer_id).toBe('offer-1');
    expect(state.insertPayload.discount_amount).toBe(1.5);
    expect(state.insertPayload.commission_total).toBe(1.5);
  });

  it('same-currency type stores rate 1 and the same currency on both sides', async () => {
    state.type = baseType({ delivery_currency: 'USD', exchange_rate: 1, commission_percentage: 0 });
    await createRemittance(input);
    expect(state.insertPayload).toMatchObject({ exchange_rate: 1, currency_sent: 'USD', currency_delivered: 'USD', amount_to_deliver: 100 });
  });
});
