import { supabase } from '@/lib/supabase';

const SESSION_STORAGE_KEY = 'site_visit_session_id';
const LAST_PAGE_VIEW_KEY = 'site_visit_last_page';
const MIN_TIME_BETWEEN_LOGS_MS = 60_000; // 1 minute between logs of the same page

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

const shouldThrottleForPage = (pagePath) => {
  if (typeof window === 'undefined') return true;

  try {
    const raw = localStorage.getItem(LAST_PAGE_VIEW_KEY);
    const lastMap = raw ? JSON.parse(raw) : {};
    const lastTimestamp = lastMap[pagePath];

    if (lastTimestamp && Date.now() - lastTimestamp < MIN_TIME_BETWEEN_LOGS_MS) {
      return true;
    }

    lastMap[pagePath] = Date.now();
    localStorage.setItem(LAST_PAGE_VIEW_KEY, JSON.stringify(lastMap));
    return false;
  } catch (error) {
    console.warn('[Analytics] Unable to read/write last page view cache:', error);
    return false;
  }
};

export const trackPageVisit = async ({ pageUrl, userId }) => {
  if (typeof window === 'undefined') return;

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
