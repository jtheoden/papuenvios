/**
 * A5 - a rate pair (direct + inverse) is never left half written.
 *  - saveExchangeRatePair: direct, then inverse; if the inverse fails the direct one is rolled back.
 *  - updateExchangeRatePair: if the inverse update fails the direct row gets its previous values back.
 *  - deleteExchangeRatePair: ids are validated as UUIDs before they reach the PostgREST .or() filter.
 * A real transaction needs an RPC (Phase 3); this is the best-effort compensation available from the client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Scripted supabase mock: every awaited query consumes the next scripted response and is logged.
const db = vi.hoisted(() => ({ ops: [], responses: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = () => {
    const chain = { op: 'select', filters: [] };
    const record = (name) => (...args) => {
      chain.filters.push([name, ...args]);
      return chain;
    };
    chain.select = () => chain;
    chain.insert = (values) => { chain.op = 'insert'; chain.values = values; return chain; };
    chain.upsert = (values) => { chain.op = 'upsert'; chain.values = values; return chain; };
    chain.update = (values) => { chain.op = 'update'; chain.values = values; return chain; };
    chain.delete = () => { chain.op = 'delete'; return chain; };
    chain.single = () => chain;
    chain.eq = record('eq');
    chain.in = record('in');
    chain.or = record('or');
    chain.order = record('order');
    chain.then = (resolve, reject) => {
      db.ops.push({ op: chain.op, values: chain.values, filters: chain.filters });
      const result = db.responses.shift() ?? { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from: () => makeChain() } };
});
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import {
  saveExchangeRatePair,
  updateExchangeRatePair,
  deleteExchangeRatePair,
  subscribeRatesChanged
} from '@/lib/currencyService';

const ok = (data) => ({ data, error: null });
const fail = (message = 'boom') => ({ data: null, error: { code: 'XX000', message } });
const USD = '11111111-1111-4111-8111-111111111111';
const CUP = '22222222-2222-4222-8222-222222222222';

let changed;
let unsubscribe;
beforeEach(() => {
  db.ops = [];
  db.responses = [];
  changed = vi.fn();
  unsubscribe?.();
  unsubscribe = subscribeRatesChanged(changed);
});

describe('saveExchangeRatePair', () => {
  const input = { fromCurrencyId: USD, toCurrencyId: CUP, rate: '915', effectiveDate: '2026-11-04' };

  it('writes the direct rate and its inverse (1 / rate)', async () => {
    db.responses = [ok({ id: 'direct-1' }), ok({ id: 'inverse-1' })];
    await saveExchangeRatePair(input);
    const upserts = db.ops.filter((o) => o.op === 'upsert');
    expect(upserts).toHaveLength(2);
    expect(upserts[0].values).toMatchObject({ from_currency_id: USD, to_currency_id: CUP, rate: 915, effective_date: '2026-11-04', is_active: true });
    expect(upserts[1].values).toMatchObject({ from_currency_id: CUP, to_currency_id: USD, effective_date: '2026-11-04', is_active: true });
    expect(upserts[1].values.rate).toBeCloseTo(1 / 915, 12);
  });

  it('rolls the direct rate back (deactivates it by id) when the inverse fails, and still notifies the change', async () => {
    db.responses = [ok({ id: 'direct-1' }), fail('inverse failed'), ok([{ id: 'direct-1' }])];
    await expect(saveExchangeRatePair(input)).rejects.toBeDefined();

    const rollback = db.ops.find((o) => o.op === 'update');
    expect(rollback).toBeDefined();
    expect(rollback.values).toEqual({ is_active: false });
    expect(rollback.filters).toContainEqual(['eq', 'id', 'direct-1']);
    expect(changed).toHaveBeenCalled();
  });

  it('writes nothing else when the direct rate fails', async () => {
    db.responses = [fail('direct failed')];
    await expect(saveExchangeRatePair(input)).rejects.toBeDefined();
    expect(db.ops.filter((o) => o.op === 'upsert')).toHaveLength(1);
    expect(db.ops.some((o) => o.op === 'update')).toBe(false);
  });

  it('rejects an invalid rate before touching the database', async () => {
    await expect(saveExchangeRatePair({ ...input, rate: '0' })).rejects.toMatchObject({ code: expect.any(String) });
    await expect(saveExchangeRatePair({ ...input, rate: 'abc' })).rejects.toMatchObject({ code: expect.any(String) });
    expect(db.ops).toHaveLength(0);
  });
});

describe('updateExchangeRatePair partial failure', () => {
  const prevDirect = { id: 'd0', from_currency_id: USD, to_currency_id: CUP, rate: 900, effective_date: '2026-10-01' };

  it('restores the previous direct values when the inverse update fails, and notifies the change', async () => {
    db.responses = [
      ok([prevDirect]), // pre-read of the previous direct row
      ok([{ id: 'd0' }]), // direct update
      fail('inverse failed'), // inverse update
      ok([{ id: 'd0' }]) // restore
    ];
    await expect(updateExchangeRatePair(USD, CUP, 915, '2026-11-04')).rejects.toBeDefined();

    const updates = db.ops.filter((o) => o.op === 'update');
    expect(updates).toHaveLength(3);
    expect(updates[2].values).toEqual({ rate: 900, effective_date: '2026-10-01' });
    expect(updates[2].filters).toContainEqual(['eq', 'from_currency_id', USD]);
    expect(updates[2].filters).toContainEqual(['eq', 'to_currency_id', CUP]);
    expect(updates[2].filters).toContainEqual(['eq', 'is_active', true]);
    expect(changed).toHaveBeenCalled();
  });

  it('does not restore anything when the direct update itself fails', async () => {
    db.responses = [ok([prevDirect]), fail('direct failed')];
    await expect(updateExchangeRatePair(USD, CUP, 915, '2026-11-04')).rejects.toBeDefined();
    expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(1);
  });

  it('still succeeds and notifies when both updates work', async () => {
    db.responses = [ok([prevDirect]), ok([{ id: 'd0' }]), ok([{ id: 'i0' }])];
    await expect(updateExchangeRatePair(USD, CUP, 915, '2026-11-04')).resolves.toEqual({ updatedCount: 2 });
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('deleteExchangeRatePair id validation', () => {
  it.each([
    ['injection through the first id', ['abc),and(from_currency_id.neq.x', CUP]],
    ['injection through the second id', [USD, 'x,is_active.eq.true']],
    ['non-uuid ids', ['usd', 'cup']]
  ])('refuses %s without calling the database', async (_name, [from, to]) => {
    await expect(deleteExchangeRatePair(from, to)).rejects.toMatchObject({ code: expect.any(String) });
    expect(db.ops).toHaveLength(0);
  });

  it('deactivates both directions for valid UUIDs', async () => {
    db.responses = [ok([{ id: 'a' }, { id: 'b' }])];
    await expect(deleteExchangeRatePair(USD, CUP)).resolves.toEqual({ deletedCount: 2 });
    const update = db.ops.find((o) => o.op === 'update');
    expect(update.values).toEqual({ is_active: false });
    expect(JSON.stringify(update.filters)).toContain(USD);
  });
});
