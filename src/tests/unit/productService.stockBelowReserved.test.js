import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { inventoryUpdateError: null };

const chain = (table) => {
  const c = {};
  let isInventoryUpdate = false;
  c.update = vi.fn(() => {
    isInventoryUpdate = table === 'inventory';
    return c;
  });
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.limit = vi.fn(async () => ({ data: [{ id: 'inv-1' }], error: null }));
  c.single = vi.fn(async () => ({ data: { id: 'p1' }, error: null }));
  c.then = (resolve) =>
    resolve({ data: null, error: isInventoryUpdate ? state.inventoryUpdateError : null });
  return c;
};

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table) => chain(table) } }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { updateProduct } from '@/lib/productService';
import { isStockBelowReservedError } from '@/lib/stockErrors';

const form = { name_es: 'x', name_en: 'x', stock: 1 };

describe('updateProduct - stock below reserved quantity (W3)', () => {
  beforeEach(() => {
    state.inventoryUpdateError = null;
  });

  it('surfaces the inventory_reserved_lte_quantity violation instead of swallowing it', async () => {
    state.inventoryUpdateError = {
      code: '23514',
      message: 'new row for relation "inventory" violates check constraint "inventory_reserved_lte_quantity"'
    };

    const error = await updateProduct('p1', form).catch((e) => e);

    expect(isStockBelowReservedError(error)).toBe(true);
    expect(error.context.reason).toBe('stock_below_reserved');
  });

  it('still tolerates other inventory errors (product update succeeds)', async () => {
    state.inventoryUpdateError = { code: '42501', message: 'denied' };

    await expect(updateProduct('p1', form)).resolves.toMatchObject({ id: 'p1' });
  });

  it('succeeds normally when the inventory update works', async () => {
    await expect(updateProduct('p1', form)).resolves.toMatchObject({ id: 'p1' });
  });
});
