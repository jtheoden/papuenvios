import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { updateCalls: [], rpcCalls: [], rpcError: null, rpcData: null, selectCalls: [], overrideRow: null, overrideError: null };

const makeQuery = (table) => {
  const q = {
    select: (cols) => {
      state.selectCalls.push({ table, cols, filters: [] });
      return q;
    },
    eq: (col, val) => {
      state.selectCalls.at(-1)?.filters.push([col, val]);
      return q;
    },
    order: (col, opts) => {
      state.selectCalls.at(-1).order = [col, opts];
      return q;
    },
    limit: (n) => {
      state.selectCalls.at(-1).limit = n;
      return q;
    },
    maybeSingle: async () => ({ data: state.overrideRow, error: state.overrideError }),
    update: (payload) => {
      state.updateCalls.push({ table, payload });
      return q;
    },
    single: async () => ({ data: null, error: null })
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => makeQuery(table)),
    rpc: vi.fn(async (name, args) => {
      state.rpcCalls.push({ name, args });
      return state.rpcError ? { data: null, error: state.rpcError } : { data: state.rpcData, error: null };
    })
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshWhatsappRecipient: vi.fn() }));

import { setRemittanceCommission, getCommissionOverride } from '@/lib/remittanceService';

const REASON = 'Cliente frecuente, acuerdo comercial';

describe('remittanceService.setRemittanceCommission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.updateCalls = [];
    state.rpcCalls = [];
    state.rpcError = null;
    state.rpcData = { id: 'rem-1', commission_total: 5 };
    state.selectCalls = [];
    state.overrideRow = null;
    state.overrideError = null;
  });

  describe('getCommissionOverride (admin-only table, the reason never travels in the remittance row)', () => {
    it('reads the LATEST row of remittance_commission_overrides for that remittance', async () => {
      state.overrideRow = { commission: 5, standard_commission: 7.5, reason: REASON, set_by: 'admin-1', set_at: '2026-10-21T10:00:00Z' };
      await expect(getCommissionOverride('rem-1')).resolves.toEqual(state.overrideRow);
      expect(state.selectCalls).toHaveLength(1);
      expect(state.selectCalls[0]).toMatchObject({
        table: 'remittance_commission_overrides',
        filters: [['remittance_id', 'rem-1']],
        order: ['id', { ascending: false }],
        limit: 1
      });
    });

    it('returns null when the remittance has no override', async () => {
      await expect(getCommissionOverride('rem-1')).resolves.toBeNull();
    });

    it('returns null without querying when there is no id', async () => {
      await expect(getCommissionOverride('')).resolves.toBeNull();
      expect(state.selectCalls).toHaveLength(0);
    });

    it('throws an AppError when the query fails', async () => {
      state.overrideError = { code: '42501', message: 'permission denied' };
      await expect(getCommissionOverride('rem-1')).rejects.toMatchObject({ code: expect.any(String) });
    });
  });

  it('calls the admin RPC with the commission cleaned to cents (float noise removed) and the trimmed reason', async () => {
    await setRemittanceCommission('rem-1', 0.1 + 0.2, `  ${REASON}  `);
    expect(state.rpcCalls).toEqual([
      { name: 'admin_set_remittance_commission', args: { p_remittance_id: 'rem-1', p_commission: 0.3, p_reason: REASON } }
    ]);
  });

  it('accepts a commission of 0 and numeric strings', async () => {
    await setRemittanceCommission('rem-1', 0, REASON);
    await setRemittanceCommission('rem-1', '2.5', REASON);
    expect(state.rpcCalls.map((c) => c.args.p_commission)).toEqual([0, 2.5]);
  });

  it('returns the updated remittance', async () => {
    await expect(setRemittanceCommission('rem-1', 5, REASON)).resolves.toEqual({ id: 'rem-1', commission_total: 5 });
  });

  it('never writes money columns with a client UPDATE', async () => {
    await setRemittanceCommission('rem-1', 5, REASON);
    expect(state.updateCalls).toEqual([]);
  });

  it.each([
    ['a missing id', ['', 5, REASON]],
    ['a negative commission', ['rem-1', -1, REASON]],
    ['a commission with a third decimal', ['rem-1', 1.005, REASON]],
    ['a non-numeric commission', ['rem-1', 'abc', REASON]],
    ['a missing commission', ['rem-1', null, REASON]],
    ['an empty reason', ['rem-1', 5, '   ']],
    ['a reason shorter than 10 characters', ['rem-1', 5, 'too short']],
    ['a reason longer than 500 characters', ['rem-1', 5, 'x'.repeat(501)]]
  ])('rejects %s without calling the RPC', async (_label, args) => {
    await expect(setRemittanceCommission(...args)).rejects.toMatchObject({ code: expect.any(String) });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('propagates server errors as AppError', async () => {
    state.rpcError = { code: '22023', message: 'invalid_status: the commission can only be adjusted while the payment is pending or rejected' };
    await expect(setRemittanceCommission('rem-1', 5, REASON)).rejects.toMatchObject({ code: expect.any(String) });
  });
});
