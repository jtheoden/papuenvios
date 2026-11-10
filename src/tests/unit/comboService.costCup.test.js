import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();
let comboInsert;

const chain = (result, table) => {
  const c = {};
  c.insert = vi.fn((p) => { if (table === 'combo_products') comboInsert = p[0]; return c; });
  c.update = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.select = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue(result);
  c.then = (resolve) => resolve(result);
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args), rpc: (...args) => rpcMock(...args) }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { createCombo } from '@/lib/comboService';

describe('comboService with cost_cup products', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    comboInsert = undefined;
    fromMock.mockImplementation((table) => {
      if (table === 'products') return chain({ data: [{ id: 'p1', base_currency_id: 'usd' }], error: null }, table);
      if (table === 'currencies') return chain({ data: [{ id: 'usd' }], error: null }, table);
      return chain({ data: { id: 'k1' }, error: null }, table);
    });
  });

  it('still sums base_price (USD) x quantity; cost_cup is never part of the total', async () => {
    // A product priced from cost_cup 2950 @900 carries base_price 3.28 and an extra cost_cup field
    rpcMock.mockResolvedValue({
      data: [{ id: 'p1', base_price: 3.28, profit_margin: 30, cost_cup: 2950 }],
      error: null
    });

    await createCombo({
      name: 'Combo',
      description: '',
      profitMargin: 20,
      productsWithQuantities: [{ productId: 'p1', quantity: 3 }]
    });

    expect(comboInsert.base_total_price).toBeCloseTo(9.84, 2);
  });
});
