import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
let insertPayload;
let updatePayload;
let selectArgs;

const chain = (result) => {
  const c = {};
  c.insert = vi.fn((p) => { insertPayload = p; return c; });
  c.update = vi.fn((p) => { updatePayload = p; return c; });
  c.eq = vi.fn(() => c);
  c.select = vi.fn((arg) => { selectArgs.push(arg); return c; });
  c.order = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue(result);
  c.then = (resolve) => resolve(result);
  return c;
};

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args), rpc: (...args) => rpcMock(...args) }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { createProduct, updateProduct, getProductRows } from '@/lib/productService';

const base = {
  name_es: 'Arroz',
  name_en: 'Rice',
  category_id: 'c1',
  basePrice: '2',
  base_currency_id: 'usd',
  stock: 0
};

describe('productService unit of measure', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: [], error: null });
    insertPayload = undefined;
    updatePayload = undefined;
    selectArgs = [];
    fromMock.mockImplementation(() => chain({ data: { id: 'p1' }, error: null }));
  });

  it('includes unit in the product catalog projection', async () => {
    fromMock.mockImplementation(() => chain({ data: [{ id: 'p1' }], error: null }));
    await getProductRows(true);
    expect(selectArgs[0]).toMatch(/\bunit\b/);
  });

  it('createProduct persists the selected unit', async () => {
    await createProduct({ ...base, unit: 'lb' });
    expect(insertPayload[0].unit).toBe('lb');
  });

  it.each([[''], ['  '], [undefined], [null]])('createProduct stores NULL for blank unit %j', async (unit) => {
    await createProduct({ ...base, unit });
    expect(insertPayload[0].unit).toBeNull();
  });

  it('updateProduct persists the selected unit', async () => {
    await updateProduct('p1', { ...base, unit: 'kg' });
    expect(updatePayload.unit).toBe('kg');
  });

  it('updateProduct clears the unit when the admin picks the empty option', async () => {
    await updateProduct('p1', { ...base, unit: '' });
    expect(updatePayload).toHaveProperty('unit', null);
  });
});
