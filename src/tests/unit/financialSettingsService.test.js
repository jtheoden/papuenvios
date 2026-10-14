import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) }
}));

import { getMarginSettings, saveMarginSettings } from '@/lib/financialSettingsService';

describe('getMarginSettings', () => {
  beforeEach(() => fromMock.mockReset());

  it('reads both margin keys from system_config', async () => {
    const inMock = vi.fn().mockResolvedValue({
      data: [
        { key: 'default_profit_margin', value_numeric: 42 },
        { key: 'default_combo_profit_margin', value_numeric: '33.5' }
      ],
      error: null
    });
    const selectMock = vi.fn().mockReturnValue({ in: inMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await getMarginSettings();

    expect(fromMock).toHaveBeenCalledWith('system_config');
    expect(inMock).toHaveBeenCalledWith('key', ['default_profit_margin', 'default_combo_profit_margin']);
    expect(result).toEqual({ productProfit: 42, comboProfit: 33.5 });
  });

  it('returns null for a key that is missing or has no numeric value', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        in: () => Promise.resolve({ data: [{ key: 'default_profit_margin', value_numeric: null }], error: null })
      })
    });

    expect(await getMarginSettings()).toEqual({ productProfit: null, comboProfit: null });
  });

  it('surfaces database errors instead of swallowing them', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        in: () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } })
      })
    });

    await expect(getMarginSettings()).rejects.toThrow();
  });
});

describe('saveMarginSettings', () => {
  beforeEach(() => fromMock.mockReset());

  const mockUpsert = (result = { error: null }) => {
    const upsertMock = vi.fn().mockResolvedValue(result);
    fromMock.mockReturnValue({ upsert: upsertMock });
    return upsertMock;
  };

  it('upserts both keys by key and returns normalized numbers', async () => {
    const upsertMock = mockUpsert();

    const result = await saveMarginSettings({ productProfit: '45', comboProfit: 30.5 });

    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('system_config');
    const [rows, options] = upsertMock.mock.calls[0];
    expect(options).toEqual({ onConflict: 'key' });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'default_profit_margin', value_numeric: 45 }),
      expect.objectContaining({ key: 'default_combo_profit_margin', value_numeric: 30.5 })
    ]));
    rows.forEach(row => expect(typeof row.updated_at).toBe('string'));
    expect(result).toEqual({ productProfit: 45, comboProfit: 30.5 });
  });

  it('never touches the products table (changing the global % must not reprice anything)', async () => {
    mockUpsert();
    await saveMarginSettings({ productProfit: 45, comboProfit: 30 });
    const tables = fromMock.mock.calls.map(([table]) => table);
    expect(tables).toEqual(['system_config']);
  });

  it.each([
    [{ productProfit: -1, comboProfit: 30 }],
    [{ productProfit: 40, comboProfit: 1000 }],
    [{ productProfit: NaN, comboProfit: 30 }],
    [{ productProfit: 40, comboProfit: '' }],
    [{ productProfit: undefined, comboProfit: 30 }]
  ])('rejects invalid input %j before any DB call', async (input) => {
    await expect(saveMarginSettings(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('surfaces database errors (e.g. RLS denial before the migration is applied)', async () => {
    mockUpsert({ error: { code: '42501', message: 'new row violates row-level security policy' } });

    await expect(saveMarginSettings({ productProfit: 40, comboProfit: 35 })).rejects.toThrow();
  });
});
