import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
let insertPayload;
let updatePayload;

const chain = (result) => {
  const c = {};
  c.insert = vi.fn((p) => { insertPayload = p; return c; });
  c.update = vi.fn((p) => { updatePayload = p; return c; });
  c.eq = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.select = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue(result);
  c.then = (resolve) => resolve(result);
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { createProduct, updateProduct } from '@/lib/productService';

const base = {
  name_es: 'Arroz',
  name_en: 'Rice',
  category_id: 'c1',
  basePrice: '2',
  base_currency_id: 'usd',
  stock: 0
};

describe('productService profit margin input', () => {
  beforeEach(() => {
    fromMock.mockReset();
    insertPayload = undefined;
    updatePayload = undefined;
    fromMock.mockImplementation(() => chain({ data: { id: 'p1' }, error: null }));
  });

  it.each([[0, 0], ['0', 0], ['0.0', 0], [25, 25], ['12.5', 12.5]])(
    'createProduct stores margin %j as %j',
    async (input, expected) => {
      await createProduct({ ...base, profitMargin: input });
      expect(insertPayload[0].profit_margin).toBe(expected);
    }
  );

  it.each([[0, 0], ['0', 0], ['0.0', 0], [25, 25]])(
    'updateProduct stores margin %j as %j',
    async (input, expected) => {
      await updateProduct('p1', { ...base, profitMargin: input });
      expect(updatePayload.profit_margin).toBe(expected);
    }
  );

  it.each([[undefined], [null], [''], [NaN]])(
    'create and update default to 40 when margin is %j',
    async (input) => {
      await createProduct({ ...base, profitMargin: input });
      expect(insertPayload[0].profit_margin).toBe(40);
      await updateProduct('p1', { ...base, profitMargin: input });
      expect(updatePayload.profit_margin).toBe(40);
    }
  );
});
