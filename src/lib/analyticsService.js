import { supabase } from '@/lib/supabase';
import { isAnalyticsAllowed, ANALYTICS_STORAGE_KEYS } from '@/lib/consent';

const [SESSION_STORAGE_KEY, LAST_PAGE_VIEW_KEY] = ANALYTICS_STORAGE_KEYS;

const getOrCreateSessionId = () => {
  if (typeof window === 'undefined') return null;

  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const globalCrypto = typeof crypto !== 'undefined' ? crypto : null;
    const newId = globalCrypto?.randomUUID
      ? globalCrypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(SESSION_STORAGE_KEY, newId);
    return newId;
  } catch (error) {
    console.warn('[Analytics] Unable to persist session id:', error);
    return null;
  }
};

// One visit per browser session and logical page (sessionStorage): re-renders, internal navigation back to the same
// page and reloads do not insert again (Supabase egress). A new tab/session counts again.
const shouldThrottleForPage = (pagePath) => {
  if (typeof window === 'undefined') return true;

  try {
    const raw = sessionStorage.getItem(LAST_PAGE_VIEW_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const logged = Array.isArray(parsed) ? parsed : [];
    if (logged.includes(pagePath)) return true;

    sessionStorage.setItem(LAST_PAGE_VIEW_KEY, JSON.stringify([...logged, pagePath]));
    return false;
  } catch (error) {
    console.warn('[Analytics] Unable to read/write the session page cache:', error);
    return false;
  }
};

export const trackPageVisit = async ({ pageUrl, userId }) => {
  if (typeof window === 'undefined') return;
  // Opt-in: no insert and no localStorage write unless the visitor accepted analytics.
  if (!isAnalyticsAllowed()) return;

  const page_path = pageUrl || window.location.pathname;
  if (shouldThrottleForPage(page_path)) return;

  const sessionId = getOrCreateSessionId();

  try {
    const payload = {
      page_url: page_path,
      referrer: document?.referrer || null,
      user_agent: navigator?.userAgent || null,
      session_id: sessionId,
      user_id: userId || null
    };

    const { error } = await supabase.from('site_visits').insert(payload);

    if (error) {
      console.warn('[Analytics] Failed to log page visit:', error);
    }
  } catch (err) {
    console.warn('[Analytics] Unexpected error logging page visit:', err);
  }
};
