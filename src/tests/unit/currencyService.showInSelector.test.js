import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ calls: [], response: { data: { id: 'cup', show_in_selector: false }, error: null } }));

vi.mock('@/lib/supabase', () => {
  const makeChain = (table) => {
    const call = { table, update: null, eq: null };
    db.calls.push(call);
    const chain = {};
    chain.update = (payload) => { call.update = payload; return chain; };
    chain.eq = (column, value) => { call.eq = [column, value]; return chain; };
    chain.select = () => chain;
    chain.single = () => chain;
    chain.then = (resolve, reject) => Promise.resolve(db.response).then(resolve, reject);
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table) } };
});
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import { setCurrencyShowInSelector } from '@/lib/currencyService';

describe('setCurrencyShowInSelector', () => {
  beforeEach(() => {
    db.calls = [];
    db.response = { data: { id: 'cup', show_in_selector: false }, error: null };
  });

  it('writes only show_in_selector (plus updated_at) on the given currency', async () => {
    const row = await setCurrencyShowInSelector('cup', false);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].table).toBe('currencies');
    expect(db.calls[0].eq).toEqual(['id', 'cup']);
    expect(Object.keys(db.calls[0].update).sort()).toEqual(['show_in_selector', 'updated_at']);
    expect(db.calls[0].update.show_in_selector).toBe(false);
    expect(row.show_in_selector).toBe(false);
  });

  it('rejects a missing id or a non-boolean value without touching the database', async () => {
    await expect(setCurrencyShowInSelector('', true)).rejects.toBeTruthy();
    await expect(setCurrencyShowInSelector('cup', 'no')).rejects.toBeTruthy();
    expect(db.calls).toHaveLength(0);
  });

  it('surfaces a database error', async () => {
    db.response = { data: null, error: { code: '23514', message: 'check constraint' } };
    await expect(setCurrencyShowInSelector('usd', false)).rejects.toBeTruthy();
  });
});
