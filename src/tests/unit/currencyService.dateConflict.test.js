import { describe, it, expect, vi, beforeEach } from 'vitest';

// Scripted supabase mock: every awaited query consumes the next scripted response and is logged.
const db = vi.hoisted(() => ({ ops: [], responses: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = (op) => {
    const chain = { op, filters: [] };
    const record = (name) => (...args) => {
      chain.filters.push([name, ...args]);
      return chain;
    };
    chain.update = (values) => { chain.op = 'update'; chain.values = values; return chain; };
    chain.delete = () => { chain.op = 'delete'; return chain; };
    chain.select = () => chain;
    chain.eq = record('eq');
    chain.neq = record('neq');
    chain.then = (resolve, reject) => {
      db.ops.push({ op: chain.op, values: chain.values, filters: chain.filters });
      const result = db.responses.shift() ?? { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from: () => makeChain('select') } };
});

import { updateExchangeRatePair } from '@/lib/currencyService';

const UNIQUE_VIOLATION = { code: '23505', message: 'duplicate key value violates unique constraint' };
const ok = (rows) => ({ data: rows, error: null });

beforeEach(() => {
  db.ops = [];
  db.responses = [];
});

describe('updateExchangeRatePair vs the unique (from, to, effective_date) key', () => {
  it('clears the inactive same-day row that blocks the date and retries the direct update', async () => {
    db.responses = [
      { data: null, error: UNIQUE_VIOLATION }, // direct update blocked
      ok([{ id: 'stale' }]), // delete of the inactive same-day duplicate
      ok([{ id: 'a' }]), // direct update retried
      ok([{ id: 'b' }]) // inverse update
    ];

    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).resolves.toEqual({ updatedCount: 2 });

    const deletion = db.ops.find((o) => o.op === 'delete');
    expect(deletion).toBeDefined();
    // It may only ever remove INACTIVE rows of the same pair and date, never the active one.
    expect(deletion.filters).toContainEqual(['eq', 'is_active', false]);
    expect(deletion.filters).toContainEqual(['eq', 'effective_date', '2026-10-16']);
    expect(deletion.filters).toContainEqual(['eq', 'from_currency_id', 'usd']);
    expect(deletion.filters).toContainEqual(['eq', 'to_currency_id', 'eur']);
  });

  it('does the same for the inverse direction', async () => {
    db.responses = [
      ok([{ id: 'a' }]),
      { data: null, error: UNIQUE_VIOLATION },
      ok([{ id: 'stale-inv' }]),
      ok([{ id: 'b' }])
    ];

    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).resolves.toEqual({ updatedCount: 2 });

    const deletion = db.ops.find((o) => o.op === 'delete');
    expect(deletion.filters).toContainEqual(['eq', 'from_currency_id', 'eur']);
    expect(deletion.filters).toContainEqual(['eq', 'to_currency_id', 'usd']);
  });

  it('does not delete anything when there is no conflict', async () => {
    db.responses = [ok([{ id: 'a' }]), ok([{ id: 'b' }])];
    await updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16');
    expect(db.ops.some((o) => o.op === 'delete')).toBe(false);
  });

  it('surfaces the error when the retry is still blocked (an ACTIVE row owns that date)', async () => {
    db.responses = [
      { data: null, error: UNIQUE_VIOLATION },
      ok([]), // nothing inactive to clear
      { data: null, error: UNIQUE_VIOLATION } // retry blocked again
    ];

    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).rejects.toBeDefined();
    // Exactly one clearing attempt and one retry: no loops.
    expect(db.ops.filter((o) => o.op === 'delete')).toHaveLength(1);
    expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(2);
  });

  it('does not touch other error kinds', async () => {
    db.responses = [{ data: null, error: { code: '42501', message: 'permission denied' } }];
    await expect(updateExchangeRatePair('usd', 'eur', 0.9, '2026-10-16')).rejects.toBeDefined();
    expect(db.ops.some((o) => o.op === 'delete')).toBe(false);
  });
});
