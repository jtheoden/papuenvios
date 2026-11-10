import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

// Worst case of the startup chain, which is SEQUENTIAL: AuthProvider renders its children (the settings provider and
// StartupGate) only after auth settles, so a hung getSession (capped by TIMEOUTS.INIT_AUTH) is followed by a hung
// settings query (capped by VISUAL_SETTINGS_TIMEOUT_MS). Real AuthProvider, SettingsProvider, withTimeout and
// StartupGate; only the network (Supabase) never answers.

vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:1');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'unit-test-anon');
});

vi.mock('@/lib/supabase', async (importOriginal) => {
  const hang = () => new Promise(() => {});
  const chain = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : key === 'single' || key === 'maybeSingle' ? hang : () => chain) });
  return {
    ...(await importOriginal()),
    supabase: {
      auth: {
        getSession: vi.fn(hang),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn(hang),
      },
      from: () => chain,
      rpc: vi.fn(hang),
    },
  };
});
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'es' }) }));
vi.mock('@/components/AuthLoadingScreen', () => ({ default: () => <p>loading</p> }));
vi.mock('@/lib/activityLogger', () => ({ flushQueuedActivityLogs: vi.fn(), logActivity: vi.fn() }));
vi.mock('@/lib/userCategorizationService', () => ({ getUserCategory: vi.fn().mockResolvedValue(null) }));
// AnimatePresence finishes exits on animation frames, which fake timers do not drive: render the next child at once
// (the 200 ms fade itself is covered by StartupGate.test.jsx with real timers).
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal()),
  AnimatePresence: ({ children }) => children,
}));
vi.mock('@/contexts/BusinessContext', async () => {
  const { useSettings } = await import('@/contexts/SettingsContext');
  return { useBusiness: () => useSettings() };
});

import { TIMEOUTS } from '@/lib/constants';
import { VISUAL_SETTINGS_TIMEOUT_MS } from '@/lib/businessVisualSettingsService';
import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import StartupGate from '@/components/StartupGate';

const STEP = 50;
// Small steps: React flushes renders (and the effects that start the next stage) when each act() ends.
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const msUntil = async (done, limit) => {
  for (let t = 0; t <= limit; t += STEP) {
    if (done()) return t;
    await advance(STEP);
  }
  return Infinity;
};

describe('startup worst case: auth hung, then visual settings hung', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the app before 10 s: auth cap (6 s) + settings cap (3.5 s), never earlier than both', async () => {
    expect(TIMEOUTS.INIT_AUTH + VISUAL_SETTINGS_TIMEOUT_MS).toBeLessThan(10000);
    render(
      <AuthProvider>
        <SettingsProvider>
          <StartupGate>
            <p key="main">app</p>
          </StartupGate>
        </SettingsProvider>
      </AuthProvider>
    );

    const authGaveUpAt = await msUntil(() => screen.queryByTestId('startup-backdrop'), 20000); // StartupGate mounted
    const appAt = await msUntil(() => screen.queryByText('app'), 20000) + authGaveUpAt;

    expect(authGaveUpAt).toBeGreaterThanOrEqual(TIMEOUTS.INIT_AUTH);
    expect(appAt).toBeGreaterThanOrEqual(TIMEOUTS.INIT_AUTH + VISUAL_SETTINGS_TIMEOUT_MS);
    expect(appAt).toBeLessThan(10000);
  });
});
