import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', t: (key) => key }),
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ notificationSettings: {} }),
}));

import TermsPage from '@/components/TermsPage';
import PrivacyPage from '@/components/PrivacyPage';
import LegalLink from '@/components/LegalLink';

let scrollToSpy;
let scrollIntoViewMock;

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('scroll reset on legal pages', () => {
  it.each([
    ['Terms', TermsPage, '/terms'],
    ['Privacy', PrivacyPage, '/privacy'],
  ])('%s scrolls to the top on mount when there is no hash', (_n, Page, path) => {
    window.history.replaceState({}, '', path);
    render(<Page onNavigate={vi.fn()} />);
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('Terms scrolls to the anchored section on mount instead of the top', () => {
    window.history.replaceState({}, '', '/terms#refunds');
    render(<TermsPage onNavigate={vi.fn()} />);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock.mock.contexts[0].id).toBe('refunds');
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

describe('in-page anchor navigation', () => {
  it('scrolls to #refunds when a LegalLink is clicked while already on /terms', () => {
    window.history.replaceState({}, '', '/terms');
    const onNavigate = vi.fn();
    render(
      <>
        <LegalLink page="terms" hash="refunds" onNavigate={onNavigate}>
          go-refunds
        </LegalLink>
        <TermsPage onNavigate={onNavigate} />
      </>
    );
    scrollIntoViewMock.mockClear();
    scrollToSpy.mockClear();

    fireEvent.click(screen.getByRole('link', { name: 'go-refunds' }));

    expect(window.location.hash).toBe('#refunds');
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock.mock.contexts[0].id).toBe('refunds');
  });

  it('adds a history entry for in-page anchors so Back returns to the previous position', () => {
    window.history.replaceState({}, '', '/terms');
    const before = window.history.length;
    render(
      <LegalLink page="terms" hash="refunds" onNavigate={vi.fn()}>
        go-refunds
      </LegalLink>
    );
    fireEvent.click(screen.getByRole('link', { name: 'go-refunds' }));
    expect(window.history.length).toBe(before + 1);
  });

  it('reacts to hashchange (Back/Forward between anchors) on the Terms page', () => {
    window.history.replaceState({}, '', '/terms');
    render(<TermsPage onNavigate={vi.fn()} />);
    scrollIntoViewMock.mockClear();

    window.history.replaceState({}, '', '/terms#refunds');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock.mock.contexts[0].id).toBe('refunds');
  });
});
