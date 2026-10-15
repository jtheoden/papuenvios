import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import { effectiveRate, changePercent, PAYMENT_FX_STATES, validatePaymentFxForm, getPaymentFxStatus, setPaymentFxRate } from '@/lib/paymentFxService';
import { PG_ERRORS, queryChain } from './helpers/bizumTestUtils';

const STATUS = {
  id: 'r1', mid_rate: 0.92, spread_pct: 1.5, effective_rate: 0.9338, source: 'manual', created_by: 'u1',
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

describe('validatePaymentFxForm', () => {
  it('accepts a valid manual rate', () => {
    expect(validatePaymentFxForm({ mid: '0.9234', spread: '1.5', note: '' })).toEqual({});
    expect(validatePaymentFxForm({ mid: '0,9234', spread: '1,5', note: '' })).toEqual({});
  });

  it('enforces 0.5-1.5 with at most 6 decimals for the mid rate', () => {
    expect(validatePaymentFxForm({ mid: '', spread: '1' }).mid).toBe('required');
    expect(validatePaymentFxForm({ mid: '0.49', spread: '1' }).mid).toBe('range');
    expect(validatePaymentFxForm({ mid: '1.51', spread: '1' }).mid).toBe('range');
    expect(validatePaymentFxForm({ mid: '0.1234567', spread: '1' }).mid).toBe('range');
    expect(validatePaymentFxForm({ mid: '0.9234567', spread: '1' }).mid).toBe('decimals');
  });

  it('enforces 0-10 with at most 2 decimals for the spread and 500 chars for the note', () => {
    expect(validatePaymentFxForm({ mid: '0.9', spread: '' }).spread).toBe('required');
    expect(validatePaymentFxForm({ mid: '0.9', spread: '10.01' }).spread).toBe('range');
    expect(validatePaymentFxForm({ mid: '0.9', spread: '1.234' }).spread).toBe('decimals');
    expect(validatePaymentFxForm({ mid: '0.9', spread: '1', note: 'n'.repeat(501) }).note).toBe('tooLong');
  });
});

describe('getPaymentFxStatus', () => {
  it('calls get_payment_fx_status and enriches the author name best-effort', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: STATUS, error: null });
    supabaseMock.from.mockReturnValue(queryChain({ data: [{ id: 'u1', full_name: 'Ana Admin' }], error: null }));
    const status = await getPaymentFxStatus();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_payment_fx_status');
    expect(status).toMatchObject({ ...STATUS, created_by_name: 'Ana Admin' });
  });

  it('keeps the status when the name lookup fails', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: STATUS, error: null });
    supabaseMock.from.mockReturnValue(queryChain({ data: null, error: { code: '42501', message: 'denied' } }));
    const status = await getPaymentFxStatus();
    expect(status.state).toBe('ok');
    expect(status.created_by_name).toBeNull();
  });

  it('skips the lookup for the none state', async () => {
    const none = { ...STATUS, id: null, mid_rate: null, spread_pct: null, effective_rate: null, created_by: null, created_at: null, age_hours: null, state: 'none' };
    supabaseMock.rpc.mockResolvedValue({ data: none, error: null });
    const status = await getPaymentFxStatus();
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(status.state).toBe('none');
  });

  it('maps a missing RPC to schemaMissing', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: PG_ERRORS.missingFunction });
    await expect(getPaymentFxStatus()).rejects.toMatchObject({ schemaMissing: true });
  });
});

describe('setPaymentFxRate', () => {
  it('sends the exact RPC payload (manual source, no confirmation by default)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { id: 'r2' }, error: null });
    await setPaymentFxRate({ mid: 0.9234, spread: 2.25, note: 'ECB 10:00' });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_payment_fx_rate', {
      p_mid: 0.9234, p_spread: 2.25, p_source: 'manual', p_note: 'ECB 10:00', p_confirm_large_change: false
    });
  });

  it('passes confirmLargeChange and nulls an empty note', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { id: 'r2' }, error: null });
    await setPaymentFxRate({ mid: 0.9, spread: 1, note: '  ', confirmLargeChange: true });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_payment_fx_rate', {
      p_mid: 0.9, p_spread: 1, p_source: 'manual', p_note: null, p_confirm_large_change: true
    });
  });

  it('rejects with the large_change token so the UI can ask for confirmation', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: PG_ERRORS.raise('payment_fx_large_change') });
    await expect(setPaymentFxRate({ mid: 1.2, spread: 1 })).rejects.toMatchObject({ token: 'payment_fx_large_change' });
  });
});

describe('effectiveRate / changePercent', () => {
  it('computes mid * (1 + spread/100) rounded to 6 decimals like the generated column', () => {
    expect(effectiveRate(0.9234, 1.5)).toBe(0.937251);
    expect(effectiveRate(1.2, 2.25)).toBe(1.227);
    expect(effectiveRate(0.5, 0)).toBe(0.5);
  });

  it('computes the signed percentage change between two effective rates', () => {
    expect(changePercent(0.937251, 1.227)).toBeCloseTo(30.91, 2);
    expect(changePercent(1, 0.9)).toBeCloseTo(-10, 5);
    expect(changePercent(0, 1)).toBeNaN();
  });
});
