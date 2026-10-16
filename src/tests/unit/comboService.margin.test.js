import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
let comboInsert;
let updatePayload;

const chain = (result, table) => {
  const c = {};
  c.insert = vi.fn((p) => { if (table === 'combo_products') comboInsert = p[0]; return c; });
  c.update = vi.fn((p) => { updatePayload = p; return c; });
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
  supabase: { from: (...args) => fromMock(...args) }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { createCombo, updateCombo } from '@/lib/comboService';

const base = {
  name: 'Combo',
  description: '',
  productsWithQuantities: [{ productId: 'p1', quantity: 1 }]
};

describe('comboService profit margin input', () => {
  beforeEach(() => {
    fromMock.mockReset();
    comboInsert = undefined;
    updatePayload = undefined;
    fromMock.mockImplementation((table) =>
      chain({ data: table === 'products' ? [{ id: 'p1', base_price: 10 }] : { id: 'k1' }, error: null }, table)
    );
  });

  it.each([[0, 0], ['0', 0], ['0.0', 0], [20, 20]])(
    'createCombo stores margin %j as %j',
    async (input, expected) => {
      await createCombo({ ...base, profitMargin: input });
      expect(comboInsert.profit_margin).toBe(expected);
    }
  );

  it.each([[0, 0], ['0', 0], ['0.0', 0], [20, 20]])(
    'updateCombo stores margin %j as %j',
    async (input, expected) => {
      await updateCombo('k1', { ...base, profitMargin: input });
      expect(updatePayload.profit_margin).toBe(expected);
    }
  );

  it.each([[undefined], [null], [''], [NaN]])(
    'create and update default to 35 when margin is %j',
    async (input) => {
      await createCombo({ ...base, profitMargin: input });
      expect(comboInsert.profit_margin).toBe(35);
      await updateCombo('k1', { ...base, profitMargin: input });
      expect(updatePayload.profit_margin).toBe(35);
    }
  );
});
