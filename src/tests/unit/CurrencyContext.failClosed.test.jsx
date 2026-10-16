import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  getCurrenciesWithRates: vi.fn(),
  getConversionRate: vi.fn(),
  listeners: new Set()
}));

vi.mock('@/lib/currencyService', () => ({
  getCurrenciesWithRates: (...a) => svc.getCurrenciesWithRates(...a),
  getConversionRate: (...a) => svc.getConversionRate(...a),
  subscribeRatesChanged: (fn) => {
    svc.listeners.add(fn);
    return () => svc.listeners.delete(fn);
  }
}));

import { CurrencyProvider, useCurrency } from '@/contexts/CurrencyContext';

const USD = { id: 'usd', code: 'USD', symbol: '$', is_base: true };
const CUP = { id: 'cup', code: 'CUP', symbol: '$', is_base: false };

const wrapper = ({ children }) => <CurrencyProvider>{children}</CurrencyProvider>;

describe('CurrencyContext fails closed without a rate', () => {
  beforeEach(() => {
    svc.listeners.clear();
    svc.getCurrenciesWithRates.mockReset().mockResolvedValue([USD, CUP]);
    svc.getConversionRate.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('convertAmount is NaN (not the raw amount) when the rate could not be loaded', async () => {
    svc.getConversionRate.mockRejectedValue(new Error('no rate'));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(svc.getConversionRate).toHaveBeenCalled());
    expect(result.current.convertAmount(10, 'cup', 'usd')).toBeNaN();
    expect(result.current.ratesUnavailable).toBe(true);
  });

  it('convertAmountAsync rejects instead of returning amount * 1', async () => {
    svc.getConversionRate.mockRejectedValue(new Error('no rate'));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.convertAmountAsync(10, 'cup', 'usd')).rejects.toBeTruthy();
  });

  it('getConversionRateWithCache resolves null on failure', async () => {
    svc.getConversionRate.mockRejectedValue(new Error('no rate'));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.getConversionRateWithCache('cup', 'usd')).resolves.toBeNull();
  });

  it('converts with a loaded rate', async () => {
    svc.getConversionRate.mockResolvedValue(0.5);
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5));
    expect(result.current.ratesUnavailable).toBe(false);
  });

  it('drops cached rates after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    svc.getConversionRate.mockResolvedValueOnce(0.5).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5));
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(result.current.convertAmount(10, 'cup', 'usd')).toBeNaN();
  });

  it('refetches when rates are saved elsewhere (invalidation)', async () => {
    svc.getConversionRate.mockResolvedValueOnce(0.5).mockResolvedValue(0.25);
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5));
    act(() => svc.listeners.forEach((fn) => fn()));
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(2.5));
  });
});
