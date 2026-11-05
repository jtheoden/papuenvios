/**
 * exchange_rates is writable by super_admin only (RLS policy exchange_rates_manage, already in production).
 * For anyone else the database answers an INSERT/upsert with 42501 "row-level security" and silently affects
 * 0 rows on UPDATE/DELETE. Neither may look like a saved change, nor like an expired session or a missing pair.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ responses: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'insert', 'upsert', 'update', 'delete', 'single', 'eq', 'in', 'or', 'order'].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.then = (resolve, reject) => Promise.resolve(db.responses.shift() ?? { data: [], error: null }).then(resolve, reject);
    return chain;
  };
  return { supabase: { from: () => makeChain() } };
});
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import {
  saveExchangeRate,
  saveExchangeRatePair,
  deleteExchangeRate,
  deleteExchangeRatePair,
  updateExchangeRatePair
} from '@/lib/currencyService';

const ok = (data) => ({ data, error: null });
const RLS = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "exchange_rates"' } };
const USD = '11111111-1111-4111-8111-111111111111';
const CUP = '22222222-2222-4222-8222-222222222222';
const REQUIRES_SUPER = { code: 'FORBIDDEN', context: expect.objectContaining({ requiredRole: 'super_admin' }) };

beforeEach(() => {
  db.responses = [];
});

describe('writes refused by RLS are reported as "only a super_admin can change rates"', () => {
  it('saveExchangeRate: 42501 row-level security', async () => {
    db.responses = [RLS];
    await expect(saveExchangeRate({ fromCurrencyId: USD, toCurrencyId: CUP, rate: 915 })).rejects.toMatchObject(REQUIRES_SUPER);
  });

  it('saveExchangeRatePair: the direct write is refused, nothing else is attempted', async () => {
    db.responses = [RLS];
    await expect(saveExchangeRatePair({ fromCurrencyId: USD, toCurrencyId: CUP, rate: 915 })).rejects.toMatchObject(REQUIRES_SUPER);
  });

  it('deleteExchangeRate: 0 rows affected is not a success', async () => {
    db.responses = [ok([])];
    await expect(deleteExchangeRate('rate-1')).rejects.toMatchObject(REQUIRES_SUPER);
  });

  it('deleteExchangeRate: still succeeds when the row was deactivated', async () => {
    db.responses = [ok([{ id: 'rate-1' }])];
    await expect(deleteExchangeRate('rate-1')).resolves.toBe(true);
  });

  it('deleteExchangeRatePair: 0 rows affected is not a success', async () => {
    db.responses = [ok([])];
    await expect(deleteExchangeRatePair(USD, CUP)).rejects.toMatchObject(REQUIRES_SUPER);
  });

  it('updateExchangeRatePair: 0 rows updated keeps the NOT_FOUND code but names the real reason', async () => {
    db.responses = [ok([]), ok([]), ok([])]; // pre-read, direct update (filtered by RLS), spare
    await expect(updateExchangeRatePair(USD, CUP, 915, '2026-11-04')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      context: expect.objectContaining({ requiredRole: 'super_admin' })
    });
  });

  it('updateExchangeRatePair: an RLS error on the update is reported the same way', async () => {
    db.responses = [ok([]), RLS];
    await expect(updateExchangeRatePair(USD, CUP, 915, '2026-11-04')).rejects.toMatchObject(REQUIRES_SUPER);
  });
});
