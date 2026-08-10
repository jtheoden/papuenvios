import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpcMock(...args)
  }
}));

import { bulkDeleteProducts, bulkDeleteCategories } from '@/lib/bulkDeleteService';

describe('bulkDeleteProducts', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls bulk_delete_products with the given ids and splits deleted/blocked', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { deleted_id: 'p1', blocked_id: null, block_reason: null },
        { deleted_id: null, blocked_id: 'p2', block_reason: 'blocking_orders' }
      ],
      error: null
    });

    const result = await bulkDeleteProducts(['p1', 'p2']);

    expect(rpcMock).toHaveBeenCalledWith('bulk_delete_products', { p_ids: ['p1', 'p2'] });
    expect(result.deleted).toEqual(['p1']);
    expect(result.blocked).toEqual([{ id: 'p2', reason: 'blocking_orders' }]);
  });

  it('throws on empty selection instead of calling the RPC', async () => {
    await expect(bulkDeleteProducts([])).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws AppError when the RPC errors (e.g. non-super_admin caller)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });

    await expect(bulkDeleteProducts(['p1'])).rejects.toThrow();
  });
});

describe('bulkDeleteCategories', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls bulk_delete_categories with the given ids and splits deleted/blocked', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { deleted_id: 'c1', blocked_id: null, block_reason: null },
        { deleted_id: null, blocked_id: 'c2', block_reason: 'has_products' }
      ],
      error: null
    });

    const result = await bulkDeleteCategories(['c1', 'c2']);

    expect(rpcMock).toHaveBeenCalledWith('bulk_delete_categories', { p_ids: ['c1', 'c2'] });
    expect(result.deleted).toEqual(['c1']);
    expect(result.blocked).toEqual([{ id: 'c2', reason: 'has_products' }]);
  });
});
