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
// One preload reads every ordered pair (USD->CUP and CUP->USD): the first load answers `rate`, later calls `then()`.
const firstLoadThen = (rate, then) => {
  let calls = 0;
  return () => {
    calls += 1;
    return calls <= 2 ? Promise.resolve(rate) : then();
  };
};

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
    svc.getConversionRate.mockImplementation(firstLoadThen(0.5, () => Promise.reject(new Error('down'))));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5));
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(result.current.convertAmount(10, 'cup', 'usd')).toBeNaN();
  });

  it('while a background refresh runs an expired rate stays on screen, but only up to one extra TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    svc.getConversionRate.mockImplementation(firstLoadThen(0.5, () => new Promise(() => {}))); // refresh hangs
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5));

    vi.setSystemTime(Date.now() + 12 * 60 * 1000); // expired (10 min TTL), refresh starts when the tab comes back
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(svc.getConversionRate).toHaveBeenCalledTimes(4));
    expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5);

    vi.setSystemTime(Date.now() + 10 * 60 * 1000); // 22 min old: past the grace, even with the refresh still pending
    expect(result.current.convertAmount(10, 'cup', 'usd')).toBeNaN();
  });

  it('refetches when rates are saved elsewhere (invalidation)', async () => {
    svc.getConversionRate.mockImplementation(firstLoadThen(0.5, () => Promise.resolve(0.25)));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(5));
    act(() => svc.listeners.forEach((fn) => fn()));
    await waitFor(() => expect(result.current.convertAmount(10, 'cup', 'usd')).toBe(2.5));
  });
});

describe('CurrencyContext inputs that cannot be converted are never reported as converted or free (A6)', () => {
  beforeEach(() => {
    svc.listeners.clear();
    svc.getCurrenciesWithRates.mockReset().mockResolvedValue([USD, CUP]);
    svc.getConversionRate.mockReset().mockResolvedValue(0.5);
  });

  const loaded = async () => {
    const hook = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(hook.result.current.convertAmount(10, 'cup', 'usd')).toBe(5));
    return hook;
  };

  it('a refresh that never answers does not leave the conversion spinner on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    svc.getConversionRate.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(svc.getConversionRate).toHaveBeenCalled());
    expect(result.current.conversionLoading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(result.current.conversionLoading).toBe(false);
  });

  it('asymmetric pairs: the screen resolves each direction direct-first, like the live checkout path', async () => {
    // Production rates are not reciprocal: USD->CUP 915, CUP->USD 0.001111 (1/900)
    const rates = { 'usd>cup': 915, 'cup>usd': 0.001111 };
    svc.getConversionRate.mockImplementation(async (from, to) => rates[`${from}>${to}`]);
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSelectedCurrency('cup'));
    await waitFor(() => expect(svc.getConversionRate).toHaveBeenCalledWith('usd', 'cup'));
    // Rates saved elsewhere while browsing in CUP: the cache is rebuilt with CUP selected
    act(() => svc.listeners.forEach((fn) => fn()));
    await waitFor(() => expect(result.current.convertAmount(10, 'usd', 'cup')).toBe(9150));
    // A CUP product viewed in CUP is normalized to USD: 10000 CUP * 0.001111 = 11.11, never 10000 / 915 = 10.93
    await waitFor(() => expect(result.current.convertAmount(10000, 'cup', 'usd')).toBeCloseTo(11.11, 2));
    expect(result.current.convertAmount(10, 'usd', 'cup')).toBe(9150);
  });

  it('a NaN amount stays NaN instead of turning into 0', async () => {
    const { result } = await loaded();
    expect(result.current.convertAmount(NaN, 'cup', 'usd')).toBeNaN();
  });

  it.each([[0], [null], [undefined]])('an empty amount (%j) is 0', async (amount) => {
    const { result } = await loaded();
    expect(result.current.convertAmount(amount, 'cup', 'usd')).toBe(0);
  });

  it.each([
    ['missing source id', [undefined, 'usd']],
    ['missing target id', ['cup', null]],
    ['both ids missing', [undefined, undefined]]
  ])('%s is NaN, not the unconverted amount', async (_name, [from, to]) => {
    const { result } = await loaded();
    expect(result.current.convertAmount(10, from, to)).toBeNaN();
  });

  it('the same currency still returns the amount', async () => {
    const { result } = await loaded();
    expect(result.current.convertAmount(10, 'usd', 'usd')).toBe(10);
  });

  it('displayCurrency(NaN) and formatCurrency(NaN) show an unavailable marker, never $0.00', async () => {
    const { result } = await loaded();
    expect(result.current.displayCurrency(NaN)).not.toContain('0.00');
    expect(result.current.displayCurrency(NaN)).toContain('\u2014');
    expect(result.current.formatCurrency(NaN)).toBe('\u2014');
  });

  it('displayCurrency and formatCurrency keep formatting real numbers and empty values as before', async () => {
    const { result } = await loaded();
    expect(result.current.displayCurrency(12.5)).toBe('$12.50 USD');
    expect(result.current.formatCurrency(3)).toBe('3.00');
    expect(result.current.formatCurrency(null)).toBe('0.00');
    expect(result.current.formatCurrency(undefined)).toBe('0.00');
  });
});

