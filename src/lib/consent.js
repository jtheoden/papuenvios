/**
 * Visitor consent for non-essential processing (opt-in model).
 *
 * Categories:
 *  - necessary: always on (Supabase Auth session, pending checkout state). Not stored here.
 *  - analytics: OFF until the visitor accepts. Controls the page-visit log (site_visits)
 *    and the localStorage keys that support it.
 *
 * Global Privacy Control: `navigator.globalPrivacyControl === true` is treated as a rejection of
 * analytics (source 'gpc') unless the visitor explicitly clicked accept WHILE the signal was on
 * (that record carries `gpc: true`), which is an informed override. A decision stored before the
 * signal appeared never overrides the signal.
 */
import { LEGAL_VERSION } from '@/lib/legalConfig';

export const CONSENT_STORAGE_KEY = 'papuenvios_consent';

/** Consent record version: bump together with the legal texts so visitors are asked again. */
export const CONSENT_VERSION = LEGAL_VERSION;

/** localStorage keys that exist only to support analytics; removed on withdrawal. */
export const ANALYTICS_STORAGE_KEYS = ['site_visit_session_id', 'site_visit_last_page'];

const PREFERENCES_EVENT = 'papuenvios:open-consent-preferences';

const UNDECIDED = Object.freeze({ analytics: false, decided: false, source: null, gpc: false });

let memoryRecord = null;
const listeners = new Set();

export const hasGpcSignal = () =>
  typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true;

const readRecord = () => {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return memoryRecord;
  }
};

const isValidRecord = (record) =>
  Boolean(record) &&
  record.version === CONSENT_VERSION &&
  typeof record.analytics === 'boolean' &&
  (record.source === 'banner' || record.source === 'gpc');

const removeAnalyticsKeys = () => {
  for (const key of ANALYTICS_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable: nothing was persisted.
    }
  }
};

/**
 * @returns {{analytics: boolean, decided: boolean, source: 'banner'|'gpc'|null, gpc: boolean}}
 *  `decided` is false only when the visitor must still be asked.
 */
export const getConsent = () => {
  const gpc = hasGpcSignal();
  const record = readRecord();
  const valid = isValidRecord(record);

  if (gpc && !(valid && record.gpc === true && record.source === 'banner')) {
    return { analytics: false, decided: true, source: 'gpc', gpc: true };
  }
  if (!valid) return { ...UNDECIDED, gpc };
  return { analytics: record.analytics, decided: true, source: record.source, gpc };
};

export const isAnalyticsAllowed = () => getConsent().analytics;

const notify = () => {
  const state = getConsent();
  listeners.forEach((listener) => listener(state));
};

/**
 * Records the visitor's decision. Withdrawing consent removes the analytics localStorage keys.
 * @param {boolean} granted
 * @param {'banner'|'gpc'} [source]
 */
export const setAnalyticsConsent = (granted, source = 'banner') => {
  const record = {
    version: CONSENT_VERSION,
    analytics: Boolean(granted),
    source,
    timestamp: new Date().toISOString(),
    gpc: hasGpcSignal(),
  };
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    memoryRecord = null;
  } catch {
    // Storage unavailable: the decision lives in memory for this page session.
    memoryRecord = record;
  }
  if (!record.analytics) removeAnalyticsKeys();
  notify();
};

/** Subscribes to consent changes. @returns {() => void} unsubscribe */
export const subscribeConsent = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Call once at startup: guarantees no analytics leftovers while analytics is not allowed. */
export const initConsent = () => {
  if (!isAnalyticsAllowed()) removeAnalyticsKeys();
};

/** Asks the banner to reopen (used by the "Cookie preferences" footer control). */
export const openConsentPreferences = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
};

/** @returns {() => void} unsubscribe */
export const subscribeConsentPreferencesRequests = (listener) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PREFERENCES_EVENT, listener);
  return () => window.removeEventListener(PREFERENCES_EVENT, listener);
};
