import { describe, it, expect, vi, beforeEach } from 'vitest';

// Scripted supabase mock: every awaited query consumes the next scripted response and is logged.
const db = vi.hoisted(() => ({ ops: [], responses: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = (table) => {
    const chain = { table, calls: [] };
    ['select', 'eq', 'order', 'limit', 'maybeSingle'].forEach((name) => {
      chain[name] = (...args) => {
        chain.calls.push([name, ...args]);
        return chain;
      };
    });
    chain.then = (resolve, reject) => {
      db.ops.push(chain);
      return Promise.resolve(db.responses.shift() ?? { data: null, error: null }).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table) } };
});

import { getActiveRate, getActiveRatesMap } from '@/lib/currencyService';

const NOW = new Date('2026-10-27T16:00:00Z');
const row = (over = {}) => ({ rate: '830', effective_date: '2026-10-22', updated_at: '2026-10-22T09:00:00Z', ...over });

beforeEach(() => {
  db.ops = [];
  db.responses = [];
});

describe('getActiveRate (fail closed)', () => {
  it('returns rate, dates and age in hours for the active pair', async () => {
    db.responses = [{ data: row(), error: null }];
    await expect(getActiveRate('USD', 'CUP', { now: NOW })).resolves.toEqual({
      rate: 830,
      effective_date: '2026-10-22',
      updated_at: '2026-10-22T09:00:00Z',
      ageHours: 136
    });
  });

  it('reads only active rows of the pair, newest first, by currency code', async () => {
    db.responses = [{ data: row(), error: null }];
    await getActiveRate('usd', 'cup', { now: NOW });
    const calls = db.ops[0].calls;
    expect(db.ops[0].table).toBe('exchange_rates');
    expect(calls).toContainEqual(['eq', 'is_active', true]);
    expect(calls).toContainEqual(['eq', 'from_currency.code', 'USD']);
    expect(calls).toContainEqual(['eq', 'to_currency.code', 'CUP']);
    expect(calls).toContainEqual(['order', 'effective_date', { ascending: false }]);
    expect(calls).toContainEqual(['limit', 1]);
  });

  it('returns null (never 0) when there is no active rate', async () => {
    db.responses = [{ data: null, error: null }];
    await expect(getActiveRate('USD', 'CUP', { now: NOW })).resolves.toBeNull();
  });

  it.each(['0', 0, -1, 'abc', null])('returns null for an unusable stored rate (%s)', async (rate) => {
    db.responses = [{ data: row({ rate }), error: null }];
    await expect(getActiveRate('USD', 'CUP', { now: NOW })).resolves.toBeNull();
  });

  it('returns null without querying when a code is missing', async () => {
    await expect(getActiveRate('USD', '', { now: NOW })).resolves.toBeNull();
    expect(db.ops).toHaveLength(0);
  });

  it('throws on a load error so the UI can offer a retry (a failed read is not "no rate")', async () => {
    db.responses = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(getActiveRate('USD', 'CUP', { now: NOW })).rejects.toBeTruthy();
  });
});

describe('getActiveRatesMap', () => {
  it('builds the from-to id map of active rates', async () => {
    db.responses = [{ data: [
      { from_currency_id: 'a', to_currency_id: 'b', rate: 2 },
      { from_currency_id: 'b', to_currency_id: 'a', rate: 0.5 }
    ], error: null }];
    await expect(getActiveRatesMap()).resolves.toEqual({ 'a-b': 2, 'b-a': 0.5 });
    expect(db.ops[0].calls).toContainEqual(['eq', 'is_active', true]);
  });

  it('throws on a load error', async () => {
    db.responses = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(getActiveRatesMap()).rejects.toBeTruthy();
  });
});
