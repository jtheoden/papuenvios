import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { calls: [], result: { count: 0, error: null } };

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => {
      const q = {
        select: (cols, opts) => {
          state.calls.push({ table, cols, opts });
          return q;
        },
        in: (col, values) => {
          state.calls.push({ in: col, values });
          return Promise.resolve(state.result);
        }
      };
      return q;
    })
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshWhatsappRecipient: vi.fn(async () => '+15551234567')
}));

import { getPendingRemittancesCount } from '@/lib/remittanceService';

describe('getPendingRemittancesCount', () => {
  beforeEach(() => {
    state.calls = [];
    state.result = { count: 0, error: null };
  });

  it('counts remittances the admin can act on (validate or deliver) with a head count query', async () => {
    state.result = { count: 3, error: null };

    await expect(getPendingRemittancesCount()).resolves.toBe(3);

    expect(state.calls[0]).toMatchObject({
      table: 'remittances',
      opts: { count: 'exact', head: true }
    });
    expect(state.calls[1]).toEqual({
      in: 'status',
      values: ['payment_proof_uploaded', 'payment_validated', 'processing']
    });
  });

  it('returns 0 when the query fails so the badge never breaks the header', async () => {
    state.result = { count: null, error: { message: 'boom' } };

    await expect(getPendingRemittancesCount()).resolves.toBe(0);
  });
});
