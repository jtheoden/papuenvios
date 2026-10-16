import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ calls: [], rows: {} }));

vi.mock('@/lib/supabase', () => {
  const makeChain = (table) => {
    const filters = {};
    const chain = {};
    ['select', 'order', 'limit', 'single'].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.eq = (column, value) => {
      filters[column] = value;
      return chain;
    };
    chain.maybeSingle = () => {
      const key = `${filters.from_currency_id}>${filters.to_currency_id}`;
      return Promise.resolve({ data: db.rows[`${table}:${key}`] ?? null, error: null });
    };
    return chain;
  };
  return {
    supabase: {
      from: (table) => {
        db.calls.push(table);
        return makeChain(table);
      }
    }
  };
});

import { getConversionRate, convertPrice } from '@/lib/currencyService';

describe('getConversionRate fails closed', () => {
  beforeEach(() => {
    db.calls = [];
    db.rows = {};
  });

  it('returns the direct active rate', async () => {
    db.rows['exchange_rates:usd>cup'] = { rate: '790' };
    await expect(getConversionRate('usd', 'cup')).resolves.toBe(790);
  });

  it('derives the inverse of the opposite pair', async () => {
    db.rows['exchange_rates:cup>usd'] = { rate: '0.5' };
    await expect(getConversionRate('usd', 'cup')).resolves.toBe(2);
  });

  it('rejects when no active pair exists instead of inventing a rate', async () => {
    await expect(getConversionRate('usd', 'cup')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('never queries official_currency_rates or falls back to static rates', async () => {
    await getConversionRate('usd', 'cup').catch(() => null);
    expect(db.calls).not.toContain('official_currency_rates');
    expect(db.calls.every((table) => table === 'exchange_rates')).toBe(true);
  });

  it('does not convert a price when the rate is missing', async () => {
    await expect(convertPrice(10, 'usd', 'cup')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
