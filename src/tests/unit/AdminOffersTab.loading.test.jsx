import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  offers: null,
  auth: { user: { id: 'admin-1' } },
  business: { visualSettings: {} },
  language: { t: (key) => key, language: 'es' },
  currency: { currencySymbol: '$' }
}));

// Chainable query builder: every call returns itself and awaiting it yields `result`.
const query = (result) => {
  const builder = {};
  ['select', 'order', 'eq', 'in', 'gte', 'lte'].forEach((m) => { builder[m] = () => builder; });
  builder.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
  return builder;
};

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => mocks.language }));
vi.mock('@/contexts/CurrencyContext', () => ({ useCurrency: () => mocks.currency }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => mocks.business }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeOffers: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'admin-1' } } } }) },
    from: (table) => query(() => (table === 'offers' ? mocks.offers : { data: [], error: null }))
  }
}));

import AdminOffersTab from '@/components/AdminOffersTab';

const pending = () => {
  let resolve;
  mocks.offers = new Promise((res) => { resolve = res; });
  return (rows) => act(async () => { resolve({ data: rows, error: null }); });
};

describe('AdminOffersTab loading state', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a busy skeleton with the translated label, never "no offers" before the load ends', async () => {
    const resolve = pending();
    render(<AdminOffersTab />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No hay ofertas creadas aún')).not.toBeInTheDocument();
    expect(screen.queryByText('Cargando ofertas...')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();

    await resolve([]);
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('No hay ofertas creadas aún')).toBeInTheDocument();
  });
});
