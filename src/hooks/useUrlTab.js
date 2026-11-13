import { useCallback, useEffect, useState } from 'react';

export const ADMIN_TAB_EVENT = 'admin-tab-change';

const readTab = (param, allowed, fallback) => {
  const candidate = new URLSearchParams(window.location.search).get(param);
  return allowed.includes(candidate) ? candidate : fallback;
};

/**
 * Keeps a page's selected tab addressable and refresh-safe. The URL is rewritten with replaceState (no history
 * entries, like the rest of the admin tabs) and an `admin-tab-change` event tells the help assistant which tab is active.
 */
export function useUrlTab(allowedTabs, fallback, param = 'tab') {
  const allowedKey = allowedTabs.join('|');
  const [tab, setTab] = useState(() => readTab(param, allowedTabs, fallback));

  useEffect(() => {
    const syncFromUrl = () => setTab(readTab(param, allowedKey.split('|'), fallback));
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [allowedKey, fallback, param]);

  const selectTab = useCallback((next) => {
    if (!allowedKey.split('|').includes(next)) return;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set(param, next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new CustomEvent(ADMIN_TAB_EVENT, { detail: { param, tab: next } }));
  }, [allowedKey, param]);

  return [tab, selectTab];
}
