import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import { PAYMENT_FX_STATES, getPaymentFxStatus } from '@/lib/paymentFxService';
import { PG_ERRORS } from './helpers/bizumTestUtils';

// get_payment_fx_status now reports the central USD->EUR row of exchange_rates (no author, constant source).
const STATUS = {
  id: 'r1', mid_rate: 0.92, spread_pct: 1.5, effective_rate: 0.9338, source: 'exchange_rates', created_by: null,
  created_at: '2026-10-15T10:00:00Z', age_hours: 3.5, state: 'ok', fx_warn_hours: 24, fx_block_hours: 96
};

beforeEach(() => {
  supabaseMock.rpc.mockReset();
  supabaseMock.from.mockReset();
});

describe('PAYMENT_FX_STATES', () => {
  it('lists the four server states', () => {
    expect(Object.values(PAYMENT_FX_STATES).sort()).toEqual(['blocked', 'none', 'ok', 'warn']);
  });
});

describe('getPaymentFxStatus', () => {
  it('calls get_payment_fx_status and returns the server status untouched', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: STATUS, error: null });
    const status = await getPaymentFxStatus();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_payment_fx_status');
    expect(status).toEqual(STATUS);
  });

  it('makes no extra query: there is no author to look up', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: STATUS, error: null });
    await getPaymentFxStatus();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('returns the none state as is', async () => {
    const none = { ...STATUS, id: null, mid_rate: null, spread_pct: null, effective_rate: null, created_at: null, age_hours: null, state: 'none' };
    supabaseMock.rpc.mockResolvedValue({ data: none, error: null });
    expect((await getPaymentFxStatus()).state).toBe('none');
  });

  it('maps a missing RPC to schemaMissing', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: PG_ERRORS.missingFunction });
    await expect(getPaymentFxStatus()).rejects.toMatchObject({ schemaMissing: true });
  });
});
