import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import { shouldShowFooterNotice } from '@/lib/routes';

const translate = (key, params = {}) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false }),
}));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'USD',
    formatCurrency: (v) => String(v),
    convertCurrency: (v) => v,
    getCurrencySymbol: () => '$',
  }),
}));
vi.mock('@/lib/carouselService', () => ({
  getActiveCarouselSlides: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/lib/publicationService', () => ({
  getPublications: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/lib/testimonialService', () => ({
  getTestimonials: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => new Promise(() => {}) }) }),
        order: () => ({ limit: () => new Promise(() => {}) }),
      }),
    }),
  },
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeSubscription: vi.fn(),
  useRealtimeCarouselSlides: vi.fn(),
}));

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import HomePage from '@/components/HomePage';
import Footer from '@/components/Footer';

describe('Home regulatory notice placement', () => {
  it('renders the strip once, right after the Hero section and outside it', () => {
    const { container } = render(<HomePage onNavigate={vi.fn()} />);
    const notes = screen.getAllByRole('note', { name: ES.legal.notice.title });
    expect(notes).toHaveLength(1);

    const root = container.firstElementChild;
    const [hero, strip, next] = Array.from(root.children);
    expect(hero.tagName).toBe('SECTION');
    expect(hero.contains(notes[0])).toBe(false);
    expect(strip).toBe(notes[0]);
    expect(next.tagName).toBe('SECTION');
  });
});

describe('One regulatory note per public route', () => {
  const notesFor = (page) => {
    const tree =
      page === 'home' ? (
        <>
          <HomePage onNavigate={vi.fn()} />
          <Footer onNavigate={vi.fn()} showNotice={shouldShowFooterNotice(page)} />
        </>
      ) : (
        <Footer onNavigate={vi.fn()} showNotice={shouldShowFooterNotice(page)} />
      );
    const { container, unmount } = render(tree);
    const count = within(container).queryAllByRole('note').length;
    unmount();
    return count;
  };

  it.each(['home', 'products', 'terms', 'login'])('%s has exactly one note', (page) => {
    expect(notesFor(page)).toBe(1);
  });
});
