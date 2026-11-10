import { describe, it, expect, vi, beforeEach } from 'vitest';

const inMock = vi.fn();
const selectMock = vi.fn(() => ({ in: inMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) }
}));

import { fetchComboDefinitions } from '@/lib/orderComboService';

describe('fetchComboDefinitions', () => {
  beforeEach(() => {
    inMock.mockReset();
    fromMock.mockClear();
    selectMock.mockClear();
  });

  it('does not query when there are no combo ids', async () => {
    const result = await fetchComboDefinitions([]);
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('runs ONE query for all ids with components and product names embedded', async () => {
    inMock.mockResolvedValue({ data: [{ id: 'c1', combo_items: [] }, { id: 'c2', combo_items: [] }], error: null });
    const result = await fetchComboDefinitions(['c1', 'c2']);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('combo_products');
    expect(selectMock.mock.calls[0][0]).toMatch(/combo_items\(.*created_at.*products\(name_es, ?name_en, ?unit\)/s);
    expect(inMock).toHaveBeenCalledWith('id', ['c1', 'c2']);
    expect([...result.keys()]).toEqual(['c1', 'c2']);
  });

  it('degrades to an empty map when the query fails', async () => {
    inMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await fetchComboDefinitions(['c1']);
    expect(result.size).toBe(0);
  });

  it('retries once WITHOUT the unit column so combos still expand if products.unit is not migrated yet', async () => {
    inMock
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column products_1.unit does not exist' } })
      .mockResolvedValueOnce({ data: [{ id: 'c1', combo_items: [] }], error: null });
    const result = await fetchComboDefinitions(['c1']);
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(selectMock.mock.calls[0][0]).toMatch(/unit/);
    expect(selectMock.mock.calls[1][0]).not.toMatch(/unit/);
    expect([...result.keys()]).toEqual(['c1']);
  });

  it('does not retry on unrelated errors', async () => {
    inMock.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    const result = await fetchComboDefinitions(['c1']);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(0);
  });
});
