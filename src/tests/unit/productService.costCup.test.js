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
  c.select = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue(result);
  c.then = (resolve) => resolve(result);
  return c;
};

vi.mock('@/lib/supabase', () => ({ supabase: { from: (...args) => fromMock(...args) } }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { createProduct, updateProduct } from '@/lib/productService';

const base = {
  name_es: 'Arroz',
  category_id: 'c1',
  basePrice: 3.28,
  base_currency_id: 'usd',
  profitMargin: 30,
  stock: 0
};

describe('productService cost_cup payload', () => {
  beforeEach(() => {
    fromMock.mockReset();
    insertPayload = undefined;
    updatePayload = undefined;
    fromMock.mockImplementation(() => chain({ data: { id: 'p1' }, error: null }));
  });

  it('createProduct sends cost_cup when defined', async () => {
    await createProduct({ ...base, costCup: 2950 });
    expect(insertPayload[0].cost_cup).toBe(2950);
  });

  it('createProduct omits the cost_cup key when undefined (code may deploy before the migration)', async () => {
    await createProduct(base);
    expect('cost_cup' in insertPayload[0]).toBe(false);
  });

  it('updateProduct sends cost_cup when defined', async () => {
    await updateProduct('p1', { ...base, costCup: 2950 });
    expect(updatePayload.cost_cup).toBe(2950);
  });

  it('updateProduct sends null to clear cost_cup', async () => {
    await updateProduct('p1', { ...base, costCup: null });
    expect('cost_cup' in updatePayload).toBe(true);
    expect(updatePayload.cost_cup).toBeNull();
  });

  it('updateProduct omits the cost_cup key when undefined', async () => {
    await updateProduct('p1', base);
    expect('cost_cup' in updatePayload).toBe(false);
  });

  it('updateProduct omits base_price and base_currency_id when basePrice is undefined', async () => {
    await updateProduct('p1', { ...base, basePrice: undefined, base_currency_id: undefined });
    expect('base_price' in updatePayload).toBe(false);
    expect('base_currency_id' in updatePayload).toBe(false);
  });
});
