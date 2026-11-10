/**
 * A remittance delivered by card or bank transfer is paid to the recipient's account: createRemittance must refuse to
 * store it unless the selected recipient has that account linked, active, and in the delivery currency.
 * Cash remittances do not use a bank account and are not affected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { type: null, link: null, insertPayload: null, linkQuery: null };

const baseType = (over = {}) => ({
  id: 'type-1',
  currency_code: 'USD',
  delivery_currency: 'USD',
  exchange_rate: 1.03,
  commission_percentage: 2.9126213592,
  commission_fixed: 0,
  min_amount: 1,
  max_amount: null,
  delivery_method: 'card',
  ...over
});

const makeQuery = (table) => {
  const filters = {};
  const q = {
    select: () => q,
    eq: (column, value) => {
      filters[column] = value;
      return q;
    },
    or: () => q,
    insert: (rows) => {
      state.insertPayload = rows[0];
      return q;
    },
    single: async () => {
      if (table === 'remittance_types') return { data: state.type, error: null };
      if (table === 'recipient_bank_accounts') {
        state.linkQuery = { ...filters };
        return state.link ? { data: state.link, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      if (table === 'remittances') return { data: { id: 'rem-1', remittance_number: 'REM-1', ...state.insertPayload }, error: null };
      return { data: null, error: null };
    },
    maybeSingle: async () => q.single()
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
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import { createRemittance } from '@/lib/remittanceService';

// 1.03 market rate on a same-currency type is the commission reference: 100 USD -> 2.91 commission -> 97.09 delivered
const expectedQuote = { amountSent: 100, amountToDeliver: 97.09, exchangeRate: 1, commissionTotal: 2.91 };
const input = {
  remittance_type_id: 'type-1',
  recipient_name: 'Ana',
  recipient_phone: '+5355555555',
  amount: 100,
  recipient_id: 'rec-1',
  recipient_bank_account_id: 'link-1',
  expectedQuote
};
const goodLink = (over = {}) => ({
  id: 'link-1',
  recipient_id: 'rec-1',
  is_active: true,
  bank_account: { is_active: true, deleted_at: null, currency: { code: 'USD' } },
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  state.type = baseType();
  state.link = goodLink();
  state.insertPayload = null;
  state.linkQuery = null;
});

describe('createRemittance with delivery by card or transfer', () => {
  it.each(['card', 'transfer', 'moneypocket'])('%s: stores the remittance when the recipient has that account linked, active and in the delivery currency', async (method) => {
    state.type = baseType({ delivery_method: method });
    await createRemittance(input);
    expect(state.insertPayload).toMatchObject({ recipient_id: 'rec-1', recipient_bank_account_id: 'link-1' });
    // looked up by the link id AND the selected recipient: another recipient's account never matches
    expect(state.linkQuery).toMatchObject({ id: 'link-1', recipient_id: 'rec-1' });
  });

  it('refuses a remittance without a selected bank account', async () => {
    const { recipient_bank_account_id: _omit, ...withoutAccount } = input;
    await expect(createRemittance(withoutAccount)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.insertPayload).toBeNull();
  });

  it('refuses a remittance without a recipient to hold the account', async () => {
    const { recipient_id: _omit, ...withoutRecipient } = input;
    await expect(createRemittance(withoutRecipient)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.insertPayload).toBeNull();
  });

  it('refuses an account that is not linked to the selected recipient (or is inactive)', async () => {
    state.link = null;
    await expect(createRemittance(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.insertPayload).toBeNull();
  });

  it.each([
    ['the bank account is inactive', { bank_account: { is_active: false, deleted_at: null, currency: { code: 'USD' } } }],
    ['the bank account was deleted', { bank_account: { is_active: true, deleted_at: '2026-11-01T00:00:00Z', currency: { code: 'USD' } } }],
    ['the account is in another currency than the delivery', { bank_account: { is_active: true, deleted_at: null, currency: { code: 'CUP' } } }]
  ])('refuses when %s', async (_name, over) => {
    state.link = goodLink(over);
    await expect(createRemittance(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.insertPayload).toBeNull();
  });
});

describe('createRemittance with cash delivery', () => {
  it('does not require nor look up a bank account', async () => {
    state.type = baseType({ delivery_method: 'cash' });
    state.link = null;
    const { recipient_bank_account_id: _omit, ...withoutAccount } = input;
    await expect(createRemittance(withoutAccount)).rejects.not.toMatchObject({ context: expect.objectContaining({ recipient_bank_account_id: expect.anything() }) });
    expect(state.linkQuery).toBeNull();
  });
});
