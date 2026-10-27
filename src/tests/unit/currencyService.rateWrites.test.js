import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ results: [] }));

// Thenable query builder: every method returns the chain, awaiting it pops the next queued { data, error }.
vi.mock('@/lib/supabase', () => {
  const chain = {};
  ['upsert', 'update', 'delete', 'select', 'single', 'eq', 'or', 'order'].forEach((m) => {
    chain[m] = () => chain;
  });
  chain.then = (resolve, reject) => Promise.resolve(db.results.shift() ?? { data: [], error: null }).then(resolve, reject);
  return { supabase: { from: () => chain } };
});

import {
  saveExchangeRate,
  deleteExchangeRate,
  deleteExchangeRatePair,
  updateExchangeRatePair
} from '@/lib/currencyService';
import { ERROR_CODES, isSessionExpiredError } from '@/lib/errorHandler';

const rlsViolation = { code: '42501', message: 'new row violates row-level security policy for table "exchange_rates"' };
const noGrant = { code: '42501', message: 'permission denied for table exchange_rates' };

const expectForbidden = async (promise) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeTruthy();
  expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
  // An RLS refusal is not an expired session: the page must not tell the admin to sign in again.
  expect(isSessionExpiredError(error)).toBe(false);
};

describe('exchange_rates writes under super_admin-only RLS', () => {
  beforeEach(() => {
    db.results = [];
  });

  it('saveExchangeRate turns an RLS violation (42501) into a clear FORBIDDEN error', async () => {
    db.results = [{ data: null, error: rlsViolation }];
    await expectForbidden(saveExchangeRate({ fromCurrencyId: 'a', toCurrencyId: 'b', rate: 1.5 }));
  });

  it('saveExchangeRate keeps a missing-grant 42501 as a session problem', async () => {
    db.results = [{ data: null, error: noGrant }];
    const error = await saveExchangeRate({ fromCurrencyId: 'a', toCurrencyId: 'b', rate: 1.5 }).then(() => null, (e) => e);
    expect(isSessionExpiredError(error)).toBe(true);
  });

  it('deleteExchangeRate never reports success when RLS filtered the row (0 rows)', async () => {
    db.results = [{ data: [], error: null }];
    await expectForbidden(deleteExchangeRate('rate-1'));
  });

  it('deleteExchangeRate succeeds when one row changed', async () => {
    db.results = [{ data: [{ id: 'rate-1' }], error: null }];
    await expect(deleteExchangeRate('rate-1')).resolves.toBe(true);
  });

  it('deleteExchangeRatePair never reports success when RLS filtered every row (0 rows)', async () => {
    db.results = [{ data: [], error: null }];
    await expectForbidden(deleteExchangeRatePair('a', 'b'));
  });

  it('deleteExchangeRatePair reports the real count otherwise', async () => {
    db.results = [{ data: [{ id: '1' }, { id: '2' }], error: null }];
    await expect(deleteExchangeRatePair('a', 'b')).resolves.toEqual({ deletedCount: 2 });
  });

  it('updateExchangeRatePair turns a 0-row update into an error that names the super_admin cause (NOT_FOUND kept)', async () => {
    db.results = [{ data: [], error: null }];
    const error = await updateExchangeRatePair('a', 'b', 1.2).then(() => null, (e) => e);
    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(error.message).toMatch(/super_admin/);
  });

  it('updateExchangeRatePair surfaces an RLS violation as FORBIDDEN', async () => {
    db.results = [{ data: null, error: rlsViolation }];
    await expectForbidden(updateExchangeRatePair('a', 'b', 1.2));
  });

  it('updateExchangeRatePair still succeeds for the direct and inverse rows', async () => {
    db.results = [{ data: [{ id: '1' }], error: null }, { data: [{ id: '2' }], error: null }];
    await expect(updateExchangeRatePair('a', 'b', 2)).resolves.toEqual({ updatedCount: 2 });
  });
});
