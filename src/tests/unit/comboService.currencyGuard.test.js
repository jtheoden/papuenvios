/**
 * A6/A10 - base_total_price is the sum of the components' base_price, which carries no currency.
 * A component priced in another currency must not be summed as if it were base currency:
 * the save is refused (converting is an owner decision). Components with no currency count as base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { products: [], baseCurrencies: [{ id: 'usd' }], comboInsert: null, comboUpdate: null, writes: 0 };
const fromMock = vi.fn();
const rpcMock = vi.fn();

const resolveTable = (table) => {
  if (table === 'products') return { data: state.products, error: null };
  if (table === 'currencies') return { data: state.baseCurrencies, error: null };
  return { data: { id: 'k1' }, error: null };
};

const chain = (table) => {
  const c = {};
  c.insert = vi.fn((p) => { state.writes += 1; if (table === 'combo_products') state.comboInsert = p[0]; return c; });
  c.update = vi.fn((p) => { state.writes += 1; if (table === 'combo_products') state.comboUpdate = p; return c; });
  c.delete = vi.fn(() => { state.writes += 1; return c; });
  ['eq', 'order', 'limit', 'in', 'select', 'is', 'maybeSingle'].forEach((m) => { c[m] = vi.fn(() => c); });
  c.single = vi.fn(async () => resolveTable(table));
  c.maybeSingle = vi.fn(async () => resolveTable(table));
  c.then = (resolve) => resolve(resolveTable(table));
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args), rpc: (...args) => rpcMock(...args) }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { createCombo, updateCombo } from '@/lib/comboService';

const combo = {
  name: 'Combo',
  description: '',
  profitMargin: 20,
  productsWithQuantities: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 2 }]
};

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  fromMock.mockImplementation((table) => chain(table));
  rpcMock.mockResolvedValue({
    data: [{ id: 'p1', base_price: 10, profit_margin: 35 }, { id: 'p2', base_price: 5, profit_margin: 35 }],
    error: null
  });
  state.products = [{ id: 'p1', base_currency_id: 'usd' }, { id: 'p2', base_currency_id: 'usd' }];
  state.baseCurrencies = [{ id: 'usd' }];
  state.comboInsert = null;
  state.comboUpdate = null;
  state.writes = 0;
});

describe('combo components must be priced in the base currency', () => {
  it('createCombo sums base_price x quantity when every component is in the base currency', async () => {
    await createCombo(combo);
    expect(state.comboInsert.base_total_price).toBe(20);
  });

  it('createCombo treats a component without currency as base currency', async () => {
    state.products = [{ id: 'p1', base_currency_id: null }, { id: 'p2', base_currency_id: 'usd' }];
    await createCombo(combo);
    expect(state.comboInsert.base_total_price).toBe(20);
  });

  it('createCombo refuses a component priced in another currency and writes nothing', async () => {
    state.products = [{ id: 'p1', base_currency_id: 'usd' }, { id: 'p2', base_currency_id: 'cup' }];
    await expect(createCombo(combo)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', i18nKey: 'vendor.combos.componentCurrencyMismatch' });
    expect(state.writes).toBe(0);
    expect(state.comboInsert).toBeNull();
  });

  it('updateCombo refuses it too and writes nothing', async () => {
    state.products = [{ id: 'p1', base_currency_id: 'eur' }, { id: 'p2', base_currency_id: 'usd' }];
    await expect(updateCombo('k1', combo)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', i18nKey: 'vendor.combos.componentCurrencyMismatch' });
    expect(state.writes).toBe(0);
  });

  it('refuses to guess when the base currency is not configured (no base row) and writes nothing', async () => {
    state.baseCurrencies = [];
    await expect(createCombo(combo)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.writes).toBe(0);
  });

  it('updateCombo without components does not look at currencies', async () => {
    await updateCombo('k1', { name: 'Combo', description: '', profitMargin: 20 });
    expect(fromMock.mock.calls.some(([t]) => t === 'products')).toBe(false);
  });
});
