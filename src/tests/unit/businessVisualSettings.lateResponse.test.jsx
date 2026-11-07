import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { BRAND_PRESET } from '@/lib/brandPalette';

vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:1');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'unit-test-anon');
});
const single = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal()),
  supabase: { from: () => ({ select: () => ({ limit: () => ({ single }) }) }) },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, isAdmin: false }) }));
vi.mock('@/lib/notificationSettingsService', () => ({ DEFAULT_SETTINGS: {}, loadNotificationSettings: vi.fn(), getFreshNotificationSettings: vi.fn() }));
vi.mock('@/lib/financialSettingsService', () => ({ getMarginSettings: vi.fn() }));

let SettingsProvider, useSettings;
const Probe = () => {
  const { visualSettings, visualSettingsLoaded, setVisualSettings, refreshVisualSettings } = useSettings();
  return <>
    <output data-testid="settings">{visualSettings.companyName}</output>
    <output data-testid="ready">{String(visualSettingsLoaded)}</output>
    <button onClick={() => setVisualSettings({ ...BRAND_PRESET, companyName: 'Admin edit' })}>edit</button>
    <button onClick={refreshVisualSettings}>refresh</button>
  </>;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const row = (companyName) => ({ data: { settings: { ...BRAND_PRESET, companyName } }, error: null });
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const name = () => screen.getByTestId('settings').textContent;
const cachedName = () => JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY))?.data.companyName;

describe('visual settings after startup timeout', () => {
  let request;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ SettingsProvider, useSettings } = await import('@/contexts/SettingsContext'));
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    single.mockReset();
    request = deferred();
    single.mockReturnValueOnce(request.promise);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const mountAndTimeout = async () => {
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await advance(3499);
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
    await advance(1);
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  };

  it('releases startup at 3.5 s but applies and caches a verified success at 5 s', async () => {
    await mountAndTimeout();
    await advance(1500);
    await act(async () => request.resolve(row('Late brand')));
    expect(name()).toBe('Late brand');
    expect(document.documentElement.dataset.theme).toBe('papuenvios');
    expect(document.body.style.backgroundColor).toBe('rgb(250, 247, 240)');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(BRAND_PRESET.accentColor);
    expect(cachedName()).toBe('Late brand');
  });

  it.each(['error', 'rejection', 'missing row'])('ignores a late %s over good settings', async (kind) => {
    await mountAndTimeout();
    single.mockResolvedValueOnce(row('New brand'));
    await act(async () => fireEvent.click(screen.getByText('refresh')));
    const styles = document.documentElement.getAttribute('style');
    await act(async () => {
      if (kind === 'rejection') request.reject(new Error('offline'));
      else request.resolve({ data: null, error: { code: kind === 'missing row' ? 'PGRST116' : '503' } });
    });
    expect(name()).toBe('New brand');
    expect(cachedName()).toBe('New brand');
    expect(document.documentElement.getAttribute('style')).toBe(styles);
  });

  it('does not overwrite a newer successful refresh with an older late success', async () => {
    await mountAndTimeout();
    single.mockResolvedValueOnce(row('New brand'));
    await act(async () => fireEvent.click(screen.getByText('refresh')));
    await act(async () => request.resolve(row('Old brand')));
    expect(name()).toBe('New brand');
    expect(cachedName()).toBe('New brand');
  });

  it('does not overwrite an immediate admin edit, even before its debounced save', async () => {
    await mountAndTimeout();
    fireEvent.click(screen.getByText('edit'));
    await act(async () => request.resolve(row('Old brand')));
    expect(name()).toBe('Admin edit');
    expect(localStorage.getItem(LOCAL_CACHE_KEY)).toBeNull();
  });

  it('also applies a verified late success from a timed-out refresh', async () => {
    await mountAndTimeout();
    await act(async () => request.resolve(row('Initial brand')));
    const refresh = deferred();
    single.mockReturnValueOnce(refresh.promise);
    fireEvent.click(screen.getByText('refresh'));
    await advance(3500);
    await act(async () => refresh.resolve(row('Refreshed brand')));
    expect(name()).toBe('Refreshed brand');
    expect(cachedName()).toBe('Refreshed brand');
  });

  it('does not cache an old late success after a newer service load succeeds', async () => {
    const { loadVisualSettings } = await import('@/lib/businessVisualSettingsService');
    const late = vi.fn();
    const initial = loadVisualSettings({ onLateSettings: late });
    await advance(3500);
    await initial;
    single.mockResolvedValueOnce(row('New service brand'));
    await loadVisualSettings();
    await act(async () => request.resolve(row('Old service brand')));
    expect(late).not.toHaveBeenCalled();
    expect(cachedName()).toBe('New service brand');
  });

  it('does not cache an empty late response as verified settings', async () => {
    await mountAndTimeout();
    await act(async () => request.resolve({ data: null, error: null }));
    expect(localStorage.getItem(LOCAL_CACHE_KEY)).toBeNull();
    expect(document.documentElement.style.length).toBe(0);
    expect(document.body.style.length).toBe(0);
  });

  it('allows a newer service request to improve an already accepted older response', async () => {
    const { loadVisualSettings } = await import('@/lib/businessVisualSettingsService');
    const initial = loadVisualSettings();
    const newerRequest = deferred();
    single.mockReturnValueOnce(newerRequest.promise);
    const newer = loadVisualSettings();
    request.resolve(row('Older brand'));
    await initial;
    newerRequest.resolve(row('Newer brand'));
    expect((await newer).companyName).toBe('Newer brand');
    expect(cachedName()).toBe('Newer brand');
  });

  it('does not apply or cache a late result after the provider unmounts', async () => {
    await mountAndTimeout();
    cleanup();
    document.title = 'After unmount';
    await act(async () => request.resolve(row('Old brand')));
    expect(document.title).toBe('After unmount');
    expect(localStorage.getItem(LOCAL_CACHE_KEY)).toBeNull();
  });
});
