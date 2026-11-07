import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock, getUserMock, insertMock, updateMock } = vi.hoisted(() => ({
  fromMock: vi.fn(), getUserMock: vi.fn(), insertMock: vi.fn(), updateMock: vi.fn()
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, auth: { getUser: getUserMock } }
}));
vi.mock('@/lib/userAlertService', () => ({ createZelleDeactivationAlerts: vi.fn() }));
import { createZelleAccount, updateZelleAccount } from '@/lib/zelleService';

const account = {
  account_name: 'Main', account_holder: 'Jane', phone: '+15551234567', email: '',
  show_email: false, show_phone: true
};

describe('Zelle service contact validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null });
    const chain = {
      select: () => chain, eq: () => chain,
      single: async () => ({ data: { id: 'account' }, error: null })
    };
    insertMock.mockReturnValue(chain);
    updateMock.mockReturnValue(chain);
    fromMock.mockReturnValue({ insert: insertMock, update: updateMock });
  });

  it.each([
    ['phone', account],
    ['email', { ...account, phone: '', email: 'pay@example.com', show_email: true, show_phone: false }]
  ])('creates %s-only accounts without requiring the other contact', async (_, data) => {
    await expect(createZelleAccount(data)).resolves.toEqual({ id: 'account' });
    expect(insertMock).toHaveBeenCalledWith([data]);
  });

  it.each([
    ['phone', account],
    ['email', { ...account, phone: '', email: 'pay@example.com', show_email: true, show_phone: false }]
  ])('updates %s-only accounts without requiring the other contact', async (_, data) => {
    await expect(updateZelleAccount('account', data)).resolves.toEqual({ id: 'account' });
    expect(updateMock).toHaveBeenCalledWith(data);
  });

  it.each([
    { phone: '' },
    { phone: 'invalid-phone' },
    { email: 'invalid-email' },
    { show_phone: false },
    { account_name: ' ' },
    { account_holder: '' }
  ])('rejects invalid contact/required fields before insert: %j', async (overrides) => {
    await expect(createZelleAccount({ ...account, email: 'pay@example.com', ...overrides })).rejects.toThrow('Invalid Zelle account data');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('preserves both-visible legacy behavior', async () => {
    const data = { ...account, email: 'pay@example.com', show_email: true };
    await expect(createZelleAccount(data)).resolves.toEqual({ id: 'account' });
    expect(insertMock).toHaveBeenCalledWith([data]);
  });
});
