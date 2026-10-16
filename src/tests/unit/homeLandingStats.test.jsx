import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ES from '@/translations/ES.json';

const translate = (key) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  return typeof value === 'string' ? value : key;
};

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', currencySymbol: '$', formatCurrency: String, convertCurrency: (v) => v }),
}));
vi.mock('@/lib/carouselService', () => ({ getActiveCarouselSlides: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/testimonialService', () => ({ getTestimonials: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));
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

const statsTitle = ES.home.stats.title;
const currentYear = new Date().getFullYear();

const renderHome = () => render(<HomePage onNavigate={vi.fn()} />);

describe('Home landing stats', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        order: () => ({ limit: () => new Promise(() => {}) }),
      }),
    }));
  });

  it('reads the counters through the get_public_landing_stats RPC and never queries the private tables', async () => {
    rpc.mockResolvedValue({
      data: { users: 42, remittances_completed: 17, orders_completed: 9, first_year: currentYear - 2 },
      error: null,
    });
    renderHome();

    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith('get_public_landing_stats');
    expect(screen.getByText('17')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    const tables = from.mock.calls.map(([name]) => name);
    expect(tables).toContain('offers');
    for (const table of ['user_profiles', 'remittances', 'orders']) expect(tables).not.toContain(table);
  });

  it('clamps years to at least 1 when first_year is in the future', async () => {
    rpc.mockResolvedValue({
      data: { users: 5, remittances_completed: 6, orders_completed: 7, first_year: currentYear + 3 },
      error: null,
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('defaults the start year to 2020 when first_year is null', async () => {
    rpc.mockResolvedValue({
      data: { users: 5, remittances_completed: 6, orders_completed: 8, first_year: null },
      error: null,
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    expect(screen.getByText(String(currentYear - 2020 + 1))).toBeTruthy();
  });

  it.each([
    ['the function is missing (42883)', { data: null, error: { code: '42883', message: 'missing' } }],
    ['PostgREST cannot find it (PGRST202)', { data: null, error: { code: 'PGRST202', message: 'missing' } }],
    ['a null payload', { data: null, error: null }],
    ['a non-object payload', { data: 'oops', error: null }],
    ['a payload with non-integer counters', { data: { users: 'x', remittances_completed: 1, orders_completed: 1, first_year: 2020 }, error: null }],
    ['a payload with negative counters', { data: { users: -1, remittances_completed: 1, orders_completed: 1, first_year: 2020 }, error: null }],
  ])('hides the counters block instead of showing zeros when %s', async (_label, result) => {
    rpc.mockResolvedValue(result);
    renderHome();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(from).toHaveBeenCalledWith('offers'));
    expect(screen.queryByText(statsTitle)).toBeNull();
    expect(screen.queryByText(ES.home.stats.users)).toBeNull();
  });

  it('hides the counters block when the RPC call throws', async () => {
    rpc.mockRejectedValue(new Error('network'));
    renderHome();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(from).toHaveBeenCalledWith('offers'));
    expect(screen.queryByText(statsTitle)).toBeNull();
  });
});
