import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpcMock(...args)
  }
}));

import { bulkDeleteProducts, bulkDeleteCategories, previewBulkDeleteProducts, previewBulkDeleteCategories } from '@/lib/bulkDeleteService';

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

describe('previewBulkDeleteProducts', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls preview_bulk_delete_products and returns the cascade impact per item', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: 'p1', name: 'Producto 1', can_delete: true, block_reason: null,
          blocking_orders_count: 0, combos_to_deactivate: 2, inventory_rows: 3, inventory_movements: 5
        },
        {
          id: 'p2', name: 'Producto 2', can_delete: false, block_reason: 'blocking_orders',
          blocking_orders_count: 1, combos_to_deactivate: 0, inventory_rows: 1, inventory_movements: 0
        }
      ],
      error: null
    });

    const result = await previewBulkDeleteProducts(['p1', 'p2']);

    expect(rpcMock).toHaveBeenCalledWith('preview_bulk_delete_products', { p_ids: ['p1', 'p2'] });
    expect(result).toEqual([
      {
        id: 'p1', name: 'Producto 1', canDelete: true, blockReason: null,
        counts: { blockingOrders: 0, combosToDeactivate: 2, inventoryRows: 3, inventoryMovements: 5 }
      },
      {
        id: 'p2', name: 'Producto 2', canDelete: false, blockReason: 'blocking_orders',
        counts: { blockingOrders: 1, combosToDeactivate: 0, inventoryRows: 1, inventoryMovements: 0 }
      }
    ]);
  });

  it('throws on empty selection instead of calling the RPC', async () => {
    await expect(previewBulkDeleteProducts([])).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('previewBulkDeleteCategories', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls preview_bulk_delete_categories and returns the cascade impact per item', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { id: 'c1', name: 'Categoria 1', can_delete: true, block_reason: null, products_count: 0 },
        { id: 'c2', name: 'Categoria 2', can_delete: false, block_reason: 'has_products', products_count: 4 }
      ],
      error: null
    });

    const result = await previewBulkDeleteCategories(['c1', 'c2']);

    expect(rpcMock).toHaveBeenCalledWith('preview_bulk_delete_categories', { p_ids: ['c1', 'c2'] });
    expect(result).toEqual([
      { id: 'c1', name: 'Categoria 1', canDelete: true, blockReason: null, counts: { products: 0 } },
      { id: 'c2', name: 'Categoria 2', canDelete: false, blockReason: 'has_products', counts: { products: 4 } }
    ]);
  });
});
