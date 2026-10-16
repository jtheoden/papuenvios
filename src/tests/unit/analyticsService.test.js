import { describe, it, expect, beforeEach, vi } from 'vitest';

const insert = vi.fn();
const from = vi.fn(() => ({ insert }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args) => from(...args) },
}));

import { trackPageVisit } from '@/lib/analyticsService';
import { setAnalyticsConsent, ANALYTICS_STORAGE_KEYS, CONSENT_STORAGE_KEY } from '@/lib/consent';

beforeEach(() => {
  localStorage.clear();
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  from.mockClear();
  Object.defineProperty(window.navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
});

describe('trackPageVisit consent gate', () => {
  it('does nothing before any decision: no insert and no localStorage write', async () => {
    await trackPageVisit({ pageUrl: '/', userId: 'u1' });
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('does nothing after an explicit rejection', async () => {
    setAnalyticsConsent(false);
    const before = localStorage.length;
    await trackPageVisit({ pageUrl: '/', userId: null });
    expect(insert).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(before);
    for (const key of ANALYTICS_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it('does nothing when GPC is on, even without a stored decision', async () => {
    Object.defineProperty(window.navigator, 'globalPrivacyControl', { value: true, configurable: true });
    await trackPageVisit({ pageUrl: '/', userId: null });
    expect(insert).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('inserts the visit with a persisted session id after consent is granted', async () => {
    setAnalyticsConsent(true);
    await trackPageVisit({ pageUrl: '/products', userId: 'u1' });
    expect(from).toHaveBeenCalledWith('site_visits');
    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0][0];
    expect(payload).toMatchObject({ page_url: '/products', user_id: 'u1' });
    expect(typeof payload.session_id).toBe('string');
    expect(localStorage.getItem('site_visit_session_id')).toBe(payload.session_id);
  });

  it('stops tracking and removes the session id once consent is withdrawn', async () => {
    setAnalyticsConsent(true);
    await trackPageVisit({ pageUrl: '/a', userId: null });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('site_visit_session_id')).not.toBeNull();

    setAnalyticsConsent(false);
    expect(localStorage.getItem('site_visit_session_id')).toBeNull();
    expect(localStorage.getItem('site_visit_last_page')).toBeNull();

    await trackPageVisit({ pageUrl: '/b', userId: null });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('site_visit_session_id')).toBeNull();
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull();
  });
});
