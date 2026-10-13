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

import { reserveZelleAccount, registerZelleTransaction } from '@/lib/zelleService';

// ─── reserveZelleAccount (SEC-09 fix) ───────────────────────────────────────

describe('reserveZelleAccount', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('reserves via a single atomic RPC call, not the old two-step select+update pair', async () => {
    rpcMock.mockImplementation((name) => Promise.resolve(
      name === 'reserve_zelle_account'
        ? { data: 'acc-1', error: null }
        : { data: [{ id: 'acc-1', account_holder: 'Juan', email: 'a@b.com', phone: '+1555' }], error: null }
    ));

    const account = await reserveZelleAccount('remittance', 250);

    expect(rpcMock).toHaveBeenCalledWith('reserve_zelle_account', {
      p_transaction_type: 'remittance',
      p_amount: 250
    });
    // Must never call the old non-atomic pair.
    expect(rpcMock).not.toHaveBeenCalledWith('select_available_zelle_account', expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith('update_zelle_account_usage', expect.anything());
    expect(account).toEqual({ id: 'acc-1', account_holder: 'Juan', email: 'a@b.com', phone: '+1555' });
    // Customer path must not read the table directly (would bypass the visibility flags).
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns the account through get_zelle_account_public with hidden contact fields as null', async () => {
    rpcMock.mockImplementation((name) => Promise.resolve(
      name === 'reserve_zelle_account'
        ? { data: 'acc-2', error: null }
        : { data: [{ id: 'acc-2', account_holder: 'Ana', email: null, phone: '+1555' }], error: null }
    ));

    const account = await reserveZelleAccount('product', 40);

    expect(rpcMock).toHaveBeenCalledWith('get_zelle_account_public', { p_id: 'acc-2' });
    expect(account.email).toBeNull();
    expect(account.phone).toBe('+1555');
  });

  it('throws when no account is available (RPC returns null)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(reserveZelleAccount('product', 50)).rejects.toThrow();
  });

  it('rejects an invalid transaction type before calling the RPC', async () => {
    await expect(reserveZelleAccount('order', 50)).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
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
