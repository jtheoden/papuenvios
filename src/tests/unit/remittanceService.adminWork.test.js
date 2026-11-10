import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { calls: [], remittances: [], profiles: [], profilesError: null };

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => {
      const q = {
        select: (cols) => {
          state.calls.push({ table, select: cols });
          return q;
        },
        in: (col, values) => {
          state.calls.push({ table, in: col, values });
          return table === 'remittances'
            ? q
            : Promise.resolve({ data: state.profiles, error: state.profilesError });
        },
        order: (col, opts) => {
          state.calls.push({ table, order: col, opts });
          return Promise.resolve({ data: state.remittances, error: null });
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

import { getAdminWorkRemittances, REMITTANCE_WORK_GROUPS } from '@/lib/remittanceService';

describe('getAdminWorkRemittances', () => {
  beforeEach(() => {
    state.calls = [];
    state.remittances = [
      { id: 'r1', user_id: 'u1', status: 'payment_pending' },
      { id: 'r2', user_id: 'u2', status: 'processing' }
    ];
    state.profiles = [{ user_id: 'u1', full_name: 'Ana Perez', email: 'ana@test.com' }];
    state.profilesError = null;
  });

  it('queries only statuses that need admin work, oldest first', async () => {
    await getAdminWorkRemittances();
    const statusCall = state.calls.find((c) => c.in === 'status');
    expect(statusCall.table).toBe('remittances');
    expect([...statusCall.values].sort()).toEqual(Object.values(REMITTANCE_WORK_GROUPS).flat().sort());
    expect(state.calls.find((c) => c.order)).toMatchObject({ order: 'created_at', opts: { ascending: true } });
  });

  it('enriches each remittance with sender name and email from user_profiles', async () => {
    const result = await getAdminWorkRemittances();
    expect(result[0]).toMatchObject({ id: 'r1', sender_name: 'Ana Perez', sender_email: 'ana@test.com' });
    expect(result[1]).toMatchObject({ id: 'r2', sender_name: null, sender_email: null });
    const profileCall = state.calls.find((c) => c.table === 'user_profiles' && c.in);
    expect(profileCall).toMatchObject({ in: 'user_id', values: ['u1', 'u2'] });
  });

  it('still returns the remittances when the profile lookup fails', async () => {
    state.profilesError = { message: 'denied' };
    const result = await getAdminWorkRemittances();
    expect(result).toHaveLength(2);
    expect(result[0].sender_name).toBeNull();
  });
});
