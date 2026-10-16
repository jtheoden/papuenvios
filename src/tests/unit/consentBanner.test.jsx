import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const lang = { current: 'es' };

const translate = (key, params = {}) => {
  const dict = lang.current === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: lang.current }),
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} }),
}));

import ConsentBanner from '@/components/ConsentBanner';
import Footer from '@/components/Footer';
import { CONSENT_STORAGE_KEY, getConsent, setAnalyticsConsent, openConsentPreferences } from '@/lib/consent';

const setGpc = (value) => {
  Object.defineProperty(window.navigator, 'globalPrivacyControl', { value, configurable: true });
};

beforeEach(() => {
  lang.current = 'es';
  localStorage.clear();
  setGpc(undefined);
});

afterEach(() => {
  cleanup();
});

describe('ConsentBanner', () => {
  it('shows a labelled region to a first-time visitor with two equally prominent choices', () => {
    render(<ConsentBanner onNavigate={vi.fn()} />);
    const region = screen.getByRole('region', { name: ES.cookieConsent.title });
    const accept = within(region).getByRole('button', { name: ES.cookieConsent.accept });
    const reject = within(region).getByRole('button', { name: ES.cookieConsent.reject });
    expect(accept.className).toBe(reject.className);
    expect(within(region).getByRole('link', { name: ES.cookieConsent.privacyLink })).toHaveAttribute('href', '/privacy');
  });

  it('writes nothing to storage while it is merely displayed', () => {
    render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('accepting records consent and hides the banner', () => {
    render(<ConsentBanner onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: ES.cookieConsent.accept }));
    expect(getConsent()).toMatchObject({ analytics: true, decided: true, source: 'banner' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('rejecting records the rejection and hides the banner', () => {
    render(<ConsentBanner onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: ES.cookieConsent.reject }));
    expect(getConsent()).toMatchObject({ analytics: false, decided: true });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('is not shown once a decision exists', () => {
    setAnalyticsConsent(false);
    render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('is not shown on suppressed pages for undecided visitors', () => {
    render(<ConsentBanner suppressed onNavigate={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(getConsent().analytics).toBe(false);
  });

  it('cannot be dismissed with Escape (only through the two choices)', () => {
    render(<ConsentBanner onNavigate={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('reopens on request even on a suppressed page and shows the current state', () => {
    setAnalyticsConsent(true);
    render(<ConsentBanner suppressed onNavigate={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
    act(() => openConsentPreferences());
    const region = screen.getByRole('region', { name: ES.cookieConsent.title });
    expect(within(region).getByText(ES.cookieConsent.statusOn)).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: ES.cookieConsent.reject }));
    expect(getConsent().analytics).toBe(false);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('moves focus into the region only when reopened by the user, not on first display', () => {
    const { unmount } = render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(screen.getByRole('region').contains(document.activeElement)).toBe(false);
    unmount();

    setAnalyticsConsent(true);
    render(<ConsentBanner onNavigate={vi.fn()} />);
    act(() => openConsentPreferences());
    expect(screen.getByRole('region').contains(document.activeElement)).toBe(true);
  });

  it('with GPC on: no automatic prompt; the reopened panel states the signal was honored', () => {
    setGpc(true);
    render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
    act(() => openConsentPreferences());
    const region = screen.getByRole('region');
    expect(within(region).getByText(ES.cookieConsent.gpcNote)).toBeInTheDocument();
    expect(within(region).getByText(ES.cookieConsent.statusOff)).toBeInTheDocument();
  });

  it('renders English copy', () => {
    lang.current = 'en';
    render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(screen.getByRole('region', { name: EN.cookieConsent.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN.cookieConsent.accept })).toBeInTheDocument();
  });

  it('purges leftover analytics keys at mount when analytics is not allowed', () => {
    localStorage.setItem('site_visit_session_id', 'old');
    render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(localStorage.getItem('site_visit_session_id')).toBeNull();
  });
});

describe('ConsentBanner focus restore and layout', () => {
  it('restores focus to the element that had it before reopening, once a choice is made', () => {
    setAnalyticsConsent(true);
    render(
      <>
        <button type="button">opener</button>
        <ConsentBanner onNavigate={vi.fn()} />
      </>
    );
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    act(() => openConsentPreferences());
    expect(screen.getByRole('region').contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: ES.cookieConsent.reject }));
    expect(document.activeElement).toBe(opener);
  });

  it('does not restore focus to an element that left the DOM', () => {
    setAnalyticsConsent(true);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    render(<ConsentBanner onNavigate={vi.fn()} />);
    outside.focus();
    act(() => openConsentPreferences());
    outside.remove();
    fireEvent.click(screen.getByRole('button', { name: ES.cookieConsent.accept }));
    expect(document.activeElement).not.toBe(outside);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('sits below modals (z-50) and toasts (z-[100])', () => {
    render(<ConsentBanner onNavigate={vi.fn()} />);
    const region = screen.getByRole('region');
    expect(region.className).toMatch(/\bz-40\b/);
    expect(region.className).not.toMatch(/z-\[60\]/);
  });

  it('reserves bottom space equal to its height while visible and releases it afterwards', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(document.body.style.paddingBottom).toBe('120px');
    fireEvent.click(screen.getByRole('button', { name: ES.cookieConsent.reject }));
    expect(document.body.style.paddingBottom).toBe('');
    spy.mockRestore();
  });

  it('releases the reserved space on unmount', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(90);
    const { unmount } = render(<ConsentBanner onNavigate={vi.fn()} />);
    expect(document.body.style.paddingBottom).toBe('90px');
    unmount();
    expect(document.body.style.paddingBottom).toBe('');
    spy.mockRestore();
  });
});

describe('Footer cookie preferences control', () => {
  it('is a real button that asks the banner to reopen', () => {
    render(
      <>
        <Footer onNavigate={vi.fn()} />
        <ConsentBanner onNavigate={vi.fn()} />
      </>
    );
    act(() => setAnalyticsConsent(true));
    expect(screen.queryByRole('region', { name: ES.cookieConsent.title })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ES.cookieConsent.preferencesLink }));
    expect(screen.getByRole('region', { name: ES.cookieConsent.title })).toBeInTheDocument();
  });
});

describe('cookieConsent translations', () => {
  it('has the same keys in ES and EN', () => {
    expect(Object.keys(EN.cookieConsent).sort()).toEqual(Object.keys(ES.cookieConsent).sort());
  });
});
