import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ selects: [], updates: [], updateResults: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = () => {
    const chain = {};
    chain.select = (columns) => {
      db.selects.push(columns);
      return chain;
    };
    chain.update = (values) => {
      db.updates.push(values);
      return chain;
    };
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.then = (resolve, reject) => {
      const result = db.updates.length > 0 ? db.updateResults.shift() : { data: [], error: null };
      return Promise.resolve(result ?? { data: [], error: null }).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from: () => makeChain() } };
});

import { getAllExchangeRates, updateExchangeRatePair } from '@/lib/currencyService';

beforeEach(() => {
  db.selects = [];
  db.updates = [];
  db.updateResults = [];
});

describe('getAllExchangeRates', () => {
  it('selects updated_at so the admin can see how old each operative rate is', async () => {
    await getAllExchangeRates();
    expect(db.selects[0]).toMatch(/\bupdated_at\b/);
  });
});

describe('updateExchangeRatePair reports what it really updated', () => {
  it('counts the rows that were updated (direct and inverse)', async () => {
    db.updateResults = [
      { data: [{ id: 'a' }], error: null },
      { data: [{ id: 'b' }], error: null }
    ];
    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).resolves.toEqual({ updatedCount: 2 });
  });

  it('fails when the direct rate was not updated (pair deactivated or deleted meanwhile)', async () => {
    db.updateResults = [
      { data: [], error: null },
      { data: [{ id: 'b' }], error: null }
    ];
    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still succeeds when only the direct rate exists (inverse not configured)', async () => {
    db.updateResults = [
      { data: [{ id: 'a' }], error: null },
      { data: [], error: null }
    ];
    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).resolves.toEqual({ updatedCount: 1 });
  });
});
