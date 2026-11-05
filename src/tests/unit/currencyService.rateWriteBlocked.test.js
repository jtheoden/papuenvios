/**
 * exchange_rates is writable by super_admin only (RLS policy exchange_rates_manage, already in production).
 * For anyone else the database answers an INSERT/upsert with 42501 "row-level security" and silently affects
 * 0 rows on UPDATE/DELETE. Neither may look like a saved change, nor like an expired session.
 * Only the RLS error PROVES the role problem (requiredRole: 'super_admin'); a 0-row result may also mean the rate no
 * longer exists, so it is a plain NOT_FOUND and the UI (which knows the role) chooses the text.
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
// A write that matched no row: NOT_FOUND with reason 'no_rows' and NO role claim (the rate may simply be gone).
const expectNoRows = async (promise) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toMatchObject({ code: 'NOT_FOUND', context: { reason: 'no_rows' } });
  expect(error.context).not.toHaveProperty('requiredRole');
};

beforeEach(() => {
  db.responses = [];
});

describe('writes that change nothing are reported by their real cause (RLS refusal vs no matching row)', () => {
  const NO_PREVIOUS = ok([]); // saveExchangeRatePair pre-reads a same-day direct row first

  it('saveExchangeRate: 42501 row-level security', async () => {
    db.responses = [RLS];
    await expect(saveExchangeRate({ fromCurrencyId: USD, toCurrencyId: CUP, rate: 915 })).rejects.toMatchObject(REQUIRES_SUPER);
  });

  it('saveExchangeRatePair: the direct write is refused, nothing else is attempted', async () => {
    db.responses = [NO_PREVIOUS, RLS];
    await expect(saveExchangeRatePair({ fromCurrencyId: USD, toCurrencyId: CUP, rate: 915 })).rejects.toMatchObject(REQUIRES_SUPER);
  });

  it('deleteExchangeRate: 0 rows affected is not a success, and does not claim a role problem', async () => {
    db.responses = [ok([])];
    await expectNoRows(deleteExchangeRate('rate-1'));
  });

  it('deleteExchangeRate: still succeeds when the row was deactivated', async () => {
    db.responses = [ok([{ id: 'rate-1' }])];
    await expect(deleteExchangeRate('rate-1')).resolves.toBe(true);
  });

  it('deleteExchangeRatePair: 0 rows affected is not a success, and does not claim a role problem', async () => {
    db.responses = [ok([])];
    await expectNoRows(deleteExchangeRatePair(USD, CUP));
  });

  it('updateExchangeRatePair: 0 rows updated is NOT_FOUND without claiming a role problem', async () => {
    db.responses = [ok([]), ok([]), ok([])]; // pre-read, direct update (nothing matched), spare
    await expectNoRows(updateExchangeRatePair(USD, CUP, 915, '2026-11-04'));
  });

  it('updateExchangeRatePair: an RLS error on the update is reported the same way', async () => {
    db.responses = [ok([]), RLS];
    await expect(updateExchangeRatePair(USD, CUP, 915, '2026-11-04')).rejects.toMatchObject(REQUIRES_SUPER);
  });
});
