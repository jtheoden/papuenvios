import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { updateCalls: [], rpcCalls: [], remittance: null, rpcError: null };

const makeQuery = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    update: (payload) => {
      state.updateCalls.push({ table, payload });
      return q;
    },
    single: async () => ({ data: state.remittance, error: null }),
    then: (resolve) => resolve({ data: [], error: null })
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => makeQuery(table)),
    rpc: vi.fn(async (name, args) => {
      state.rpcCalls.push({ name, args });
      return state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: { id: args.p_remittance_id }, error: null };
    })
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshWhatsappRecipient: vi.fn(async () => '+15551234567')
}));

import { recalculateRemittanceAtCurrentRate } from '@/lib/remittanceService';

const MONEY_KEYS = [
  'exchange_rate',
  'commission_percentage',
  'commission_fixed',
  'commission_total',
  'amount_to_deliver',
  'amount_sent'
];

const buildRemittance = (status) => ({
  id: 'rem-1',
  user_id: 'user-1',
  status,
  amount_sent: 100,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  remittance_type_id: 'type-1',
  remittance_types: { id: 'type-1', exchange_rate: 300, commission_percentage: 2, commission_fixed: 1 }
});

describe('remittanceService.recalculateRemittanceAtCurrentRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.updateCalls = [];
    state.rpcCalls = [];
    state.rpcError = null;
    state.remittance = buildRemittance('payment_pending');
  });

  it('delegates the recalculation to the server-side RPC with the remittance id', async () => {
    await recalculateRemittanceAtCurrentRate('rem-1');
    expect(state.rpcCalls).toEqual([
      { name: 'recalculate_remittance_at_current_rate', args: { p_remittance_id: 'rem-1' } }
    ]);
  });

  it('never issues a client-side UPDATE on remittances', async () => {
    await recalculateRemittanceAtCurrentRate('rem-1');
    const remittanceUpdates = state.updateCalls.filter((c) => c.table === 'remittances');
    for (const call of remittanceUpdates) {
      for (const key of MONEY_KEYS) {
        expect(Object.keys(call.payload)).not.toContain(key);
      }
    }
    expect(remittanceUpdates).toHaveLength(0);
  });

  it('works for payment_rejected remittances', async () => {
    state.remittance = buildRemittance('payment_rejected');
    await recalculateRemittanceAtCurrentRate('rem-1');
    expect(state.rpcCalls).toHaveLength(1);
  });

  it.each(['payment_proof_uploaded', 'payment_validated', 'processing', 'delivered', 'completed', 'cancelled'])(
    'rejects status %s without calling the RPC',
    async (status) => {
      state.remittance = buildRemittance(status);
      await expect(recalculateRemittanceAtCurrentRate('rem-1')).rejects.toBeTruthy();
      expect(state.rpcCalls).toHaveLength(0);
    }
  );

  it('rejects a missing remittance id without calling the RPC', async () => {
    await expect(recalculateRemittanceAtCurrentRate('')).rejects.toBeTruthy();
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('propagates RPC errors', async () => {
    state.rpcError = { code: '42501', message: 'remittance_owner_update_forbidden' };
    await expect(recalculateRemittanceAtCurrentRate('rem-1')).rejects.toBeTruthy();
  });

  it('returns the remittance re-read with its joined type', async () => {
    const result = await recalculateRemittanceAtCurrentRate('rem-1');
    expect(result).toMatchObject({ id: 'rem-1', remittance_types: { id: 'type-1' } });
  });
});
