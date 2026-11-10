import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let financialSettings;
vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ financialSettings })
}));

import { useProfitMargin } from '@/hooks/useProfitMargin';

describe('useProfitMargin zero handling', () => {
  it('respects a 0% configured product margin', () => {
    financialSettings = { productProfit: 0, comboProfit: 0 };
    const { result } = renderHook(() => useProfitMargin({ itemType: 'product' }));
    expect(result.current.percentageValue).toBe(0);
    expect(result.current.multiplier).toBe(1);
    const combo = renderHook(() => useProfitMargin({ itemType: 'combo' }));
    expect(combo.result.current.percentageValue).toBe(0);
  });

  it.each([[undefined], [null], ['']])('falls back to 40/35 when settings are %j', (value) => {
    financialSettings = { productProfit: value, comboProfit: value };
    expect(renderHook(() => useProfitMargin({ itemType: 'product' })).result.current.percentageValue).toBe(40);
    expect(renderHook(() => useProfitMargin({ itemType: 'combo' })).result.current.percentageValue).toBe(35);
  });
});
