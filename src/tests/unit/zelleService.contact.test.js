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
  ])('creates %s-only accounts without requiring the other contact', async (type, data) => {
    await expect(createZelleAccount(data)).resolves.toEqual({ id: 'account' });
    expect(insertMock).toHaveBeenCalledWith([{ ...data, contact_type: type, ...(type === 'phone' ? { email: null } : { phone: null }) }]);
  });

  it.each([
    ['phone', account],
    ['email', { ...account, phone: '', email: 'pay@example.com', show_email: true, show_phone: false }]
  ])('updates %s-only accounts without requiring the other contact', async (type, data) => {
    await expect(updateZelleAccount('account', data)).resolves.toEqual({ id: 'account' });
    expect(updateMock).toHaveBeenCalledWith({ ...data, contact_type: type, ...(type === 'phone' ? { email: null } : { phone: null }) });
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

  it('does not revalidate an unchanged hidden legacy phone during an email edit', async () => {
    const original = { ...account, phone: '555.123.4567', email: 'pay@example.com', show_email: true, show_phone: false };
    await expect(updateZelleAccount('account', { ...original, account_name: 'Renamed' }, original)).resolves.toEqual({ id: 'account' });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ contact_type: 'email', phone: '555.123.4567' }));
  });

  it('rejects a changed hidden phone', async () => {
    const original = { ...account, email: 'pay@example.com', show_email: true, show_phone: false };
    await expect(updateZelleAccount('account', { ...original, phone: 'bad-phone' }, original)).rejects.toThrow('Invalid Zelle account data');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('omits contact_type when updating a legacy both-visible account', async () => {
    const data = { ...account, email: 'pay@example.com', show_email: true, contact_type: 'email' };
    await updateZelleAccount('account', data);
    const { contact_type: ignored, ...expected } = data;
    expect(updateMock).toHaveBeenCalledWith(expected);
  });

  it('preserves both-visible legacy behavior', async () => {
    const data = { ...account, email: 'pay@example.com', show_email: true };
    await expect(createZelleAccount(data)).resolves.toEqual({ id: 'account' });
    expect(insertMock).toHaveBeenCalledWith([data]);
  });
});
