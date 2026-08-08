import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpcMock(...args),
    from: (...args) => fromMock(...args)
  }
}));

import { getPlatformResetStatus, executePlatformReset } from '@/lib/platformResetService';

describe('getPlatformResetStatus', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('returns enabled=true when the flag is set in the DB', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { enabled: true }, error: null })
        })
      })
    });

    const status = await getPlatformResetStatus();
    expect(status.enabled).toBe(true);
  });

  it('defaults to enabled=false on error instead of throwing (fail-closed for a status read)', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { message: 'RLS denied' } })
        })
      })
    });

    const status = await getPlatformResetStatus();
    expect(status.enabled).toBe(false);
  });
});

describe('executePlatformReset', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls execute_platform_reset with the literal confirmation text', async () => {
    rpcMock.mockResolvedValue({ data: { orders: 3, remittances: 1 }, error: null });

    const result = await executePlatformReset('RESETEAR');

    expect(rpcMock).toHaveBeenCalledWith('execute_platform_reset', { p_confirmation: 'RESETEAR' });
    expect(result).toEqual({ orders: 3, remittances: 1 });
  });

  it('throws when the RPC errors (e.g. flag not enabled or wrong confirmation)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'not enabled', code: '42501' } });

    await expect(executePlatformReset('RESETEAR')).rejects.toThrow();
  });

  it('rejects locally without calling the RPC if the confirmation text is wrong', async () => {
    await expect(executePlatformReset('borrar todo')).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
