import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
let insertPayload;
let updatePayload;

const chain = (result) => {
  const c = {};
  c.insert = vi.fn((p) => { insertPayload = p; return c; });
  c.update = vi.fn((p) => { updatePayload = p; return c; });
  c.eq = vi.fn(() => c);
  c.select = vi.fn(() => c);
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

import { createCategory, updateCategory, getCategories } from '@/lib/productService';

const base = { es: 'Alimentos', en: 'Food', description_es: '', description_en: '' };

describe('productService categories - profit_margin', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    insertPayload = undefined;
    updatePayload = undefined;
    fromMock.mockImplementation(() => chain({ data: { id: 'c1', slug: 'alimentos' }, error: null }));
  });

  describe('createCategory', () => {
    it('persists a valid margin as a number', async () => {
      await createCategory({ ...base, profit_margin: '25.5' });
      expect(insertPayload[0].profit_margin).toBe(25.5);
    });

    it('accepts 0 and the 999.99 upper bound', async () => {
      await createCategory({ ...base, profit_margin: 0 });
      expect(insertPayload[0].profit_margin).toBe(0);
      await createCategory({ ...base, profit_margin: 999.99 });
      expect(insertPayload[0].profit_margin).toBe(999.99);
    });

    it.each([[null], [''], [undefined]])('stores NULL (no category margin) for %j', async (value) => {
      await createCategory({ ...base, profit_margin: value });
      expect(insertPayload[0].profit_margin).toBeNull();
    });

    it.each([[-1], [1000], ['abc'], [999.995]])('rejects out-of-range or invalid margin %j', async (value) => {
      await expect(createCategory({ ...base, profit_margin: value })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED'
      });
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe('updateCategory', () => {
    it('persists a valid margin', async () => {
      await updateCategory('c1', { ...base, profit_margin: 12 });
      expect(updatePayload.profit_margin).toBe(12);
    });

    it('clears the margin with null or empty string', async () => {
      await updateCategory('c1', { ...base, profit_margin: null });
      expect(updatePayload.profit_margin).toBeNull();
      await updateCategory('c1', { ...base, profit_margin: '' });
      expect(updatePayload.profit_margin).toBeNull();
    });

    it('does not touch profit_margin when the caller omits it', async () => {
      await updateCategory('c1', base);
      expect(updatePayload).not.toHaveProperty('profit_margin');
    });

    it.each([[-0.01], [1000], ['x']])('rejects invalid margin %j', async (value) => {
      await expect(updateCategory('c1', { ...base, profit_margin: value })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED'
      });
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe('getCategories', () => {
    it('does not select profit_margin for the public catalog by default', async () => {
      const c = chain({ data: [], error: null });
      fromMock.mockImplementation(() => c);
      await getCategories();
      expect(c.select.mock.calls[0][0]).not.toContain('profit_margin');
    });

    it('reads profit_margin through the admin RPC only when includeMargin is requested (admin product form)', async () => {
      const c = chain({ data: [{ id: 'c1' }], error: null });
      fromMock.mockImplementation(() => c);
      rpcMock.mockResolvedValue({ data: [{ id: 'c1', profit_margin: 25 }], error: null });
      const rows = await getCategories({ includeMargin: true });
      expect(c.select.mock.calls[0][0]).not.toContain('profit_margin');
      expect(rpcMock).toHaveBeenCalledWith('admin_list_category_margins', { p_limit: 500, p_offset: 0, p_ids: null });
      expect(rows).toEqual([{ id: 'c1', profit_margin: 25 }]);
    });

    it('the public default never calls the admin RPC', async () => {
      fromMock.mockImplementation(() => chain({ data: [{ id: 'c1' }], error: null }));
      await getCategories();
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });
});
