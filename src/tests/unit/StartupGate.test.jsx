import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import ES from '@/translations/ES.json';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { BRAND_PRESET } from '@/lib/brandPalette';

// StartupGate waits only for the visual settings (auth is gated earlier by AuthProvider):
// - before 300 ms: a themed background (same theme as AuthLoadingScreen), never the bare body, no splash text;
// - after 300 ms: the loading screen (AuthLoadingScreen look, platform message), kept at least 400 ms;
// - once ready: the app.

const state = vi.hoisted(() => ({ ready: false }));
const translate = (key) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  return typeof value === 'string' ? value : key;
};
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettingsLoaded: state.ready }) }));

import StartupGate from '@/components/StartupGate';

const App = () => (
  <StartupGate>
    <p key="main">app</p>
  </StartupGate>
);
const loadingText = () => screen.queryByText(ES.common.loadingPlatform);

// Real timers: AnimatePresence (mode="wait") needs real animation frames to finish exits.
const sleep = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('StartupGate', () => {
  beforeEach(() => localStorage.clear());

  it('shows the app with no loading screen when settings arrive within 300 ms', async () => {
    state.ready = false;
    const view = render(<App />);
    expect(screen.getByTestId('startup-backdrop')).toBeTruthy();
    expect(loadingText()).toBeNull();
    await sleep(150);
    state.ready = true;
    view.rerender(<App />);
    await waitFor(() => expect(screen.getByText('app')).toBeTruthy());
    await sleep(400);
    expect(loadingText()).toBeNull();
  });

  it('shows the loading screen after 300 ms and the app once ready', async () => {
    state.ready = false;
    const view = render(<App />);
    await waitFor(() => expect(loadingText()).toBeTruthy(), { timeout: 1000 });
    expect(screen.queryByText('app')).toBeNull();
    state.ready = true;
    view.rerender(<App />);
    await waitFor(() => expect(screen.getByText('app')).toBeTruthy(), { timeout: 2000 });
    expect(loadingText()).toBeNull();
  });

  it('paints the backdrop with the cached theme, like AuthLoadingScreen', () => {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data: { ...BRAND_PRESET }, timestamp: Date.now() }));
    state.ready = false;
    render(<App />);
    expect(screen.getByTestId('startup-backdrop').style.getPropertyValue('--ld-bg')).toBe(BRAND_PRESET.pageBgColor);
  });
});
