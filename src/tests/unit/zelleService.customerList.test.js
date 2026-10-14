import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpcMock(...args),
    from: (...args) => fromMock(...args),
    auth: { getUser: vi.fn() }
  }
}));

vi.mock('@/lib/userAlertService', () => ({
  createZelleDeactivationAlerts: vi.fn()
}));

import { getZelleAccountsForCustomer } from '@/lib/zelleService';

describe('getZelleAccountsForCustomer', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('calls list_zelle_accounts_public with the usage and never reads the table directly', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'a1', account_name: 'Main', account_holder: 'Ana', email: 'a@b.com', phone: null, priority_order: 1 }],
      error: null
    });

    await getZelleAccountsForCustomer('products');

    expect(rpcMock).toHaveBeenCalledWith('list_zelle_accounts_public', { p_usage: 'products' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('passes p_amount when an amount is given and keeps the available flag', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'a1', account_name: 'Main', priority_order: 1, available: false }],
      error: null
    });

    const accounts = await getZelleAccountsForCustomer('products', 150);

    expect(rpcMock).toHaveBeenCalledWith('list_zelle_accounts_public', { p_usage: 'products', p_amount: 150 });
    expect(accounts[0].available).toBe(false);
  });

  it('omits p_amount when the amount is missing or not positive', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getZelleAccountsForCustomer('products', 0);
    await getZelleAccountsForCustomer('products', undefined);

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'list_zelle_accounts_public', { p_usage: 'products' });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'list_zelle_accounts_public', { p_usage: 'products' });
  });

  it('supports the remittances usage', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getZelleAccountsForCustomer('remittances');

    expect(rpcMock).toHaveBeenCalledWith('list_zelle_accounts_public', { p_usage: 'remittances' });
  });

  it('maps rows keeping NULLed contact fields and marking them active', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { id: 'a1', account_name: 'Main', account_holder: 'Ana', email: null, phone: '+1555', priority_order: 2, for_products: true, for_remittances: false }
      ],
      error: null
    });

    const accounts = await getZelleAccountsForCustomer('products');

    expect(accounts).toEqual([
      {
        id: 'a1',
        account_name: 'Main',
        account_holder: 'Ana',
        email: null,
        phone: '+1555',
        priority_order: 2,
        for_products: true,
        for_remittances: false,
        is_active: true
      }
    ]);
  });

  it('returns an empty array when the RPC returns null or no rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await getZelleAccountsForCustomer('products')).toEqual([]);

    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    expect(await getZelleAccountsForCustomer('remittances')).toEqual([]);
  });

  it('throws when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });

    await expect(getZelleAccountsForCustomer('products')).rejects.toThrow();
  });

  it('rejects an invalid usage before calling the RPC', async () => {
    await expect(getZelleAccountsForCustomer('combo')).rejects.toThrow();
    await expect(getZelleAccountsForCustomer(undefined)).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
