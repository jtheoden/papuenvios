import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args) => rpc(...args) } }));

import { LEGAL_VERSION } from '@/lib/legalConfig';
import { checkCurrentAcceptance, recordLegalAcceptance } from '@/lib/legalAcceptanceService';

beforeEach(() => {
  rpc.mockReset();
});

describe('checkCurrentAcceptance', () => {
  it('calls has_current_legal_acceptance with the current legal version for both documents', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await checkCurrentAcceptance();
    expect(rpc).toHaveBeenCalledWith('has_current_legal_acceptance', {
      p_terms_version: LEGAL_VERSION,
      p_privacy_version: LEGAL_VERSION,
    });
  });

  it('returns accepted when the RPC says true', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(checkCurrentAcceptance()).resolves.toBe('accepted');
  });

  it('returns required when the RPC says false', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(checkCurrentAcceptance()).resolves.toBe('required');
  });

  it('returns unavailable when the function does not exist yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'missing' } });
    await expect(checkCurrentAcceptance()).resolves.toBe('unavailable');
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    await expect(checkCurrentAcceptance()).resolves.toBe('unavailable');
  });

  it('returns error (NOT unavailable) for any other failure so the caller blocks and lets the user retry', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'server' } });
    await expect(checkCurrentAcceptance()).resolves.toBe('error');
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
    await expect(checkCurrentAcceptance()).resolves.toBe('error');
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(checkCurrentAcceptance()).resolves.toBe('error');
  });

  it('returns error when the call throws (never throws itself)', async () => {
    rpc.mockImplementation(() => Promise.reject(new Error('offline')));
    await expect(checkCurrentAcceptance()).resolves.toBe('error');
  });
});

describe('recordLegalAcceptance', () => {
  it('calls record_legal_acceptance with versions, birth date and source, and no user id', async () => {
    rpc.mockResolvedValue({ data: { terms: LEGAL_VERSION, privacy: LEGAL_VERSION }, error: null });
    const result = await recordLegalAcceptance({ birthDate: '1990-05-01', source: 'checkout' });
    expect(rpc).toHaveBeenCalledWith('record_legal_acceptance', {
      p_terms_version: LEGAL_VERSION,
      p_privacy_version: LEGAL_VERSION,
      p_birth_date: '1990-05-01',
      p_source: 'checkout',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects an invalid or under-age date locally without calling the server', async () => {
    const invalid = await recordLegalAcceptance({ birthDate: 'nope', source: 'checkout' });
    expect(invalid).toEqual({ ok: false, code: 'invalid' });
    const under = await recordLegalAcceptance({ birthDate: '2999-01-01', source: 'checkout' });
    expect(under).toEqual({ ok: false, code: 'invalid' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports under_age locally for a minor', async () => {
    const year = new Date().getFullYear() - 10;
    const result = await recordLegalAcceptance({ birthDate: `${year}-01-01`, source: 'checkout' });
    expect(result).toEqual({ ok: false, code: 'under_age' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps server errors to stable codes', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'LEGAL_UNDER_AGE' } });
    await expect(recordLegalAcceptance({ birthDate: '1990-05-01', source: 'remittance' })).resolves.toEqual({
      ok: false,
      code: 'under_age',
    });
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'missing' } });
    await expect(recordLegalAcceptance({ birthDate: '1990-05-01', source: 'remittance' })).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('never throws', async () => {
    rpc.mockImplementation(() => Promise.reject(new Error('offline')));
    await expect(recordLegalAcceptance({ birthDate: '1990-05-01', source: 'remittance' })).resolves.toEqual({
      ok: false,
      code: 'unknown',
    });
  });

  it('rejects an unknown source without calling the server', async () => {
    const result = await recordLegalAcceptance({ birthDate: '1990-05-01', source: 'hack' });
    expect(result).toEqual({ ok: false, code: 'unknown' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
