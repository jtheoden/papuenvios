import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ rates: [], currencies: [], calls: [] }));

vi.mock('@/lib/supabase', () => {
  const makeChain = (table) => {
    const call = { table, filters: [], or: null, inIds: null };
    db.calls.push(call);
    const chain = {};
    chain.select = () => chain;
    chain.eq = (column, value) => {
      call.filters.push([column, value]);
      return chain;
    };
    chain.or = (expr) => {
      call.or = expr;
      return chain;
    };
    chain.in = (column, ids) => {
      call.inIds = ids;
      return chain;
    };
    // Resolves like PostgREST would: applies the filters the service actually sent.
    chain.order = () => {
      if (table === 'exchange_rates') {
        const active = call.filters.some(([c, v]) => c === 'is_active' && v === true);
        return Promise.resolve({ data: db.rates.filter((r) => !active || r.is_active), error: null });
      }
      const allowed = (c) => {
        if (call.or === 'is_active.eq.true,is_base.eq.true') return c.is_active === true || c.is_base === true;
        return true; // any other filter shape would leak inactive currencies
      };
      const data = db.currencies.filter((c) => allowed(c) && (call.inIds || []).includes(c.id));
      return Promise.resolve({ data, error: null });
    };
    // exchange_rates query ends at .eq() (awaited directly)
    chain.then = (resolve, reject) => {
      const active = call.filters.some(([c, v]) => c === 'is_active' && v === true);
      return Promise.resolve({ data: db.rates.filter((r) => !active || r.is_active), error: null }).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table) } };
});

import { getCurrenciesWithRates } from '@/lib/currencyService';

describe('getCurrenciesWithRates does not expose inactive currencies', () => {
  beforeEach(() => {
    db.calls = [];
    db.rates = [];
    db.currencies = [
      { id: 'usd', code: 'USD', is_active: true, is_base: true },
      { id: 'cup', code: 'CUP', is_active: true, is_base: false },
      { id: 'eur', code: 'EUR', is_active: false, is_base: false }
    ];
  });

  it('omits an inactive currency even when an active rate references it (USD -> EUR loaded, EUR off)', async () => {
    db.rates = [
      { from_currency_id: 'usd', to_currency_id: 'eur', is_active: true },
      { from_currency_id: 'usd', to_currency_id: 'cup', is_active: true }
    ];
    const result = await getCurrenciesWithRates();
    expect(result.map((c) => c.code)).toEqual(['USD', 'CUP']);
    expect(result.some((c) => c.code === 'EUR')).toBe(false);
  });

  it('still asks the database for the EUR id but filters currencies by is_active OR is_base', async () => {
    db.rates = [{ from_currency_id: 'usd', to_currency_id: 'eur', is_active: true }];
    await getCurrenciesWithRates();
    const currencyQuery = db.calls.find((c) => c.table === 'currencies');
    expect(currencyQuery.or).toBe('is_active.eq.true,is_base.eq.true');
    expect(currencyQuery.inIds).toContain('eur');
  });
});
