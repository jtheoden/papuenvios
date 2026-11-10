import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({ getCurrenciesWithRates: vi.fn(), getConversionRate: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/lib/currencyService', () => ({
  getCurrenciesWithRates: (...a) => svc.getCurrenciesWithRates(...a),
  getConversionRate: (...a) => svc.getConversionRate(...a),
  subscribeRatesChanged: () => () => {}
}));

import { CurrencyProvider, useCurrency } from '@/contexts/CurrencyContext';

const USD = { id: 'usd', code: 'USD', symbol: '$', is_base: true, show_in_selector: true };
const CUP = { id: 'cup', code: 'CUP', symbol: '$', is_base: false, show_in_selector: false };
const EUR = { id: 'eur', code: 'EUR', symbol: 'E', is_base: false };
const wrapper = ({ children }) => <CurrencyProvider>{children}</CurrencyProvider>;

describe('CurrencyContext selectorCurrencies', () => {
  beforeEach(() => {
    svc.getCurrenciesWithRates.mockReset().mockResolvedValue([USD, CUP, EUR]);
    svc.getConversionRate.mockReset().mockImplementation((from) => Promise.resolve(from === 'usd' ? 900 : 1 / 900));
  });

  it('hides show_in_selector=false from selectorCurrencies but keeps it in currencies', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currencies.map((c) => c.code)).toEqual(['USD', 'CUP', 'EUR']);
    // A row without the flag (older data) counts as visible.
    expect(result.current.selectorCurrencies.map((c) => c.code)).toEqual(['USD', 'EUR']);
  });

  it('keeps the base currency as the default selection', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.selectedCurrency).toBe('usd'));
  });

  it('still converts to and from a hidden currency', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.convertAmount(1, 'usd', 'cup')).toBe(900));
    await waitFor(() => expect(result.current.convertAmount(900, 'cup', 'usd')).toBeCloseTo(1));
    expect(result.current.getCurrencyById('cup')).toMatchObject({ code: 'CUP' });
  });
});
