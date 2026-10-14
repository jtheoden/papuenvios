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

import { pickAvailableZelleAccount, registerZelleTransaction, getZelleAccountUsageSummary } from '@/lib/zelleService';

// ─── pickAvailableZelleAccount (read-only pick over computed usage) ─────────

describe('pickAvailableZelleAccount', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('picks via select_available_zelle_account then get_zelle_account_public, never mutating', async () => {
    rpcMock.mockImplementation((name) => Promise.resolve(
      name === 'select_available_zelle_account'
        ? { data: 'acc-1', error: null }
        : { data: [{ id: 'acc-1', account_holder: 'Juan', email: 'a@b.com', phone: '+1555' }], error: null }
    ));

    const account = await pickAvailableZelleAccount('remittance', 250);

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'select_available_zelle_account', {
      p_transaction_type: 'remittance',
      p_amount: 250
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'get_zelle_account_public', { p_id: 'acc-1' });
    const names = rpcMock.mock.calls.map(([name]) => name);
    expect(names).not.toContain('reserve_zelle_account');
    expect(names).not.toContain('update_zelle_account_usage');
    expect(account).toEqual({ id: 'acc-1', account_holder: 'Juan', email: 'a@b.com', phone: '+1555' });
    // Customer path must not read or write the table directly.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns hidden contact fields as null from get_zelle_account_public', async () => {
    rpcMock.mockImplementation((name) => Promise.resolve(
      name === 'select_available_zelle_account'
        ? { data: 'acc-2', error: null }
        : { data: [{ id: 'acc-2', account_holder: 'Ana', email: null, phone: '+1555' }], error: null }
    ));

    const account = await pickAvailableZelleAccount('product', 40);

    expect(account.email).toBeNull();
    expect(account.phone).toBe('+1555');
  });

  it('throws "No Zelle accounts available" when the pick returns null', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(pickAvailableZelleAccount('product', 50)).rejects.toThrow(/No Zelle accounts available/);
  });

  it('rejects an invalid transaction type or amount before calling the RPC', async () => {
    await expect(pickAvailableZelleAccount('order', 50)).rejects.toThrow();
    await expect(pickAvailableZelleAccount('product', 0)).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ─── admin computed usage with fallback ─────────────────────────────────────

describe('getZelleAccountUsageSummary (computed usage)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('maps get_zelle_accounts_usage rows to { dailyAmount, monthlyAmount } by account id', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { id: 'a1', daily_usage: '10.5', monthly_usage: '200' },
        { id: 'a2', daily_usage: 0, monthly_usage: 5 }
      ],
      error: null
    });

    const summary = await getZelleAccountUsageSummary();

    expect(rpcMock).toHaveBeenCalledWith('get_zelle_accounts_usage');
    expect(summary).toEqual({
      a1: { dailyAmount: 10.5, monthlyAmount: 200 },
      a2: { dailyAmount: 0, monthlyAmount: 5 }
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('falls back to the transaction history aggregation when the RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'nope', code: '42501' } });
    const gte = vi.fn().mockResolvedValue({ data: [], error: null });
    fromMock.mockReturnValue({ select: () => ({ gte }) });

    const summary = await getZelleAccountUsageSummary();

    expect(fromMock).toHaveBeenCalledWith('zelle_transaction_history');
    expect(summary).toEqual({});
  });
});

// ─── registerZelleTransaction no longer double-counts usage ────────────────

describe('registerZelleTransaction', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('inserts the history row and does not call update_zelle_account_usage (reservation already incremented counters)', async () => {
    fromMock.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({
            data: { id: 'txn-1', zelle_account_id: 'acc-1', amount: 250 },
            error: null
          })
        })
      })
    });

    const result = await registerZelleTransaction({
      zelle_account_id: 'acc-1',
      transaction_type: 'remittance',
      reference_id: 'rem-1',
      amount: 250
    });

    expect(result.id).toBe('txn-1');
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
