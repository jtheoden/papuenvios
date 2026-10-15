import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  ANALYTICS_STORAGE_KEYS,
  getConsent,
  setAnalyticsConsent,
  subscribeConsent,
  initConsent,
  openConsentPreferences,
  subscribeConsentPreferencesRequests,
} from '@/lib/consent';
import { LEGAL_VERSION } from '@/lib/legalConfig';

const setGpc = (value) => {
  Object.defineProperty(window.navigator, 'globalPrivacyControl', {
    value,
    configurable: true,
  });
};

beforeEach(() => {
  localStorage.clear();
  setGpc(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getConsent defaults (opt-in)', () => {
  it('has analytics OFF and is undecided for a first-time visitor', () => {
    expect(getConsent()).toEqual({ analytics: false, decided: false, source: null, gpc: false });
  });

  it('does not write anything to storage just by reading', () => {
    getConsent();
    expect(localStorage.length).toBe(0);
  });
});

describe('setAnalyticsConsent', () => {
  it('persists an accept decision with version, timestamp and source', () => {
    setAnalyticsConsent(true);
    const stored = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY));
    expect(stored).toMatchObject({ version: LEGAL_VERSION, analytics: true, source: 'banner', gpc: false });
    expect(Number.isNaN(Date.parse(stored.timestamp))).toBe(false);
    expect(getConsent()).toEqual({ analytics: true, decided: true, source: 'banner', gpc: false });
  });

  it('persists a reject decision as decided with analytics off', () => {
    setAnalyticsConsent(false);
    expect(getConsent()).toEqual({ analytics: false, decided: true, source: 'banner', gpc: false });
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);
    setAnalyticsConsent(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ analytics: true }));
    unsubscribe();
    setAnalyticsConsent(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears the analytics storage keys when consent is withdrawn', () => {
    setAnalyticsConsent(true);
    for (const key of ANALYTICS_STORAGE_KEYS) localStorage.setItem(key, 'x');
    setAnalyticsConsent(false);
    for (const key of ANALYTICS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('does not clear the analytics keys when accepting', () => {
    for (const key of ANALYTICS_STORAGE_KEYS) localStorage.setItem(key, 'x');
    setAnalyticsConsent(true);
    for (const key of ANALYTICS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBe('x');
  });
});

describe('stored decision validity', () => {
  it('asks again when the stored version differs from the current one', () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ version: '1999-01-01', analytics: true, source: 'banner', timestamp: new Date().toISOString(), gpc: false })
    );
    expect(getConsent()).toEqual({ analytics: false, decided: false, source: null, gpc: false });
  });

  it('treats corrupt JSON as undecided', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(getConsent().decided).toBe(false);
    expect(getConsent().analytics).toBe(false);
  });

  it('treats a record with a non-boolean analytics value as undecided', () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ version: LEGAL_VERSION, analytics: 'yes', source: 'banner', timestamp: 'x', gpc: false })
    );
    expect(getConsent().analytics).toBe(false);
    expect(getConsent().decided).toBe(false);
  });
});

describe('storage failures', () => {
  it('works without storage: reads fall back to analytics OFF and writes do not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getConsent()).toEqual({ analytics: false, decided: false, source: null, gpc: false });
    expect(() => setAnalyticsConsent(true)).not.toThrow();
    expect(() => setAnalyticsConsent(false)).not.toThrow();
  });

  it('keeps the decision in memory for the session when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setAnalyticsConsent(true);
    expect(getConsent().analytics).toBe(true);
    expect(getConsent().decided).toBe(true);
    vi.restoreAllMocks();
    // Reset the in-memory fallback so later tests start clean.
    setAnalyticsConsent(false);
  });
});

describe('Global Privacy Control', () => {
  it('rejects analytics automatically and does not ask when GPC is on and nothing is stored', () => {
    setGpc(true);
    expect(getConsent()).toEqual({ analytics: false, decided: true, source: 'gpc', gpc: true });
  });

  it('ignores a non-true GPC value', () => {
    setGpc('true');
    expect(getConsent().gpc).toBe(false);
    expect(getConsent().decided).toBe(false);
  });

  it('wins over a decision stored before GPC was present', () => {
    setAnalyticsConsent(true);
    setGpc(true);
    expect(getConsent()).toEqual({ analytics: false, decided: true, source: 'gpc', gpc: true });
  });

  it('lets an explicit click made while GPC is on override it (recorded with gpc: true)', () => {
    setGpc(true);
    setAnalyticsConsent(true);
    expect(getConsent()).toEqual({ analytics: true, decided: true, source: 'banner', gpc: true });
  });
});

describe('initConsent', () => {
  it('purges analytics keys when analytics is not allowed', () => {
    for (const key of ANALYTICS_STORAGE_KEYS) localStorage.setItem(key, 'x');
    initConsent();
    for (const key of ANALYTICS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('purges analytics keys when GPC overrides a stored accept', () => {
    setAnalyticsConsent(true);
    for (const key of ANALYTICS_STORAGE_KEYS) localStorage.setItem(key, 'x');
    setGpc(true);
    initConsent();
    for (const key of ANALYTICS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps analytics keys when analytics is allowed', () => {
    setAnalyticsConsent(true);
    for (const key of ANALYTICS_STORAGE_KEYS) localStorage.setItem(key, 'x');
    initConsent();
    for (const key of ANALYTICS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBe('x');
  });
});

describe('preferences requests', () => {
  it('delivers an open request to subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsentPreferencesRequests(listener);
    openConsentPreferences();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    openConsentPreferences();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
