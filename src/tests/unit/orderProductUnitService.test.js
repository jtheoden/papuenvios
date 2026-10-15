import { describe, it, expect, vi, beforeEach } from 'vitest';

const inMock = vi.fn();
const selectMock = vi.fn(() => ({ in: inMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) }
}));

import { fetchProductUnits } from '@/lib/orderComboService';

describe('fetchProductUnits', () => {
  beforeEach(() => {
    inMock.mockReset();
    fromMock.mockClear();
    selectMock.mockClear();
  });

  it('does not query without ids', async () => {
    const result = await fetchProductUnits([]);
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('runs ONE batched query on products selecting only id and unit', async () => {
    inMock.mockResolvedValue({ data: [{ id: 'p1', unit: 'lb' }, { id: 'p2', unit: null }], error: null });
    const result = await fetchProductUnits(['p1', 'p2']);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('products');
    expect(selectMock).toHaveBeenCalledWith('id, unit');
    expect(inMock).toHaveBeenCalledWith('id', ['p1', 'p2']);
    expect(result.get('p1')).toBe('lb');
    expect(result.get('p2')).toBeNull();
  });

  it('degrades to an empty map when the query fails (e.g. column not migrated yet)', async () => {
    inMock.mockResolvedValue({ data: null, error: { code: '42703', message: 'column products.unit does not exist' } });
    const result = await fetchProductUnits(['p1']);
    expect(result.size).toBe(0);
  });

  it('degrades to an empty map when the request throws', async () => {
    inMock.mockRejectedValue(new Error('network'));
    const result = await fetchProductUnits(['p1']);
    expect(result.size).toBe(0);
  });
});
