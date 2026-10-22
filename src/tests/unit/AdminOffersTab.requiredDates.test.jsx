import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const insertMock = vi.fn(async () => ({ error: null }));
const toastMock = vi.fn();
// stable references: the component reloads when `user` changes identity
const AUTH = { user: { id: 'admin-1', email: 'a@x.test' } };
const LANG = { t: (k) => k, language: 'en' };
const BUSINESS = { visualSettings: {} };
const CURRENCY = { currencySymbol: '$' };

vi.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    order: async () => ({ data: [], error: null }),
    insert: (...a) => insertMock(...a),
    update: () => query,
    delete: () => query,
    eq: async () => ({ data: [], error: null })
  };
  return {
    supabase: {
      from: () => query,
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) }
    }
  };
});
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => LANG }));
vi.mock('@/contexts/CurrencyContext', () => ({ useCurrency: () => CURRENCY }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => AUTH }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => BUSINESS }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({})) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeOffers: () => {} }));

import AdminOffersTab from '@/components/AdminOffersTab';

const openForm = async () => {
  render(<AdminOffersTab />);
  fireEvent.click(screen.getByRole('button', { name: /New Offer/i }));
  return waitFor(() => {
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    return form;
  }).then(() => document.querySelector('form'));
};

const fillRequired = (form) => {
  fireEvent.change(screen.getByPlaceholderText('E.g: SUMMER20'), { target: { value: 'save10' } });
  const [discountValue] = form.querySelectorAll('input[type="number"]');
  fireEvent.change(discountValue, { target: { value: '10' } });
};

beforeEach(() => {
  insertMock.mockClear();
  toastMock.mockClear();
});

describe('AdminOffersTab: start and end dates are required', () => {
  it('marks both date inputs as required', async () => {
    const form = await openForm();
    const [start, end] = form.querySelectorAll('input[type="date"]');
    expect(start).toBeRequired();
    expect(end).toBeRequired();
  });

  it('refuses to save an offer without dates and says so (defends against a bypassed native validation)', async () => {
    const form = await openForm();
    fillRequired(form);

    fireEvent.submit(form);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(insertMock).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
  });

  it('refuses when only one of the dates is set', async () => {
    const form = await openForm();
    fillRequired(form);
    const [start] = form.querySelectorAll('input[type="date"]');
    fireEvent.change(start, { target: { value: '2026-11-01' } });

    fireEvent.submit(form);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('saves with both dates and sends them as-is (never null)', async () => {
    const form = await openForm();
    fillRequired(form);
    const [start, end] = form.querySelectorAll('input[type="date"]');
    fireEvent.change(start, { target: { value: '2026-11-01' } });
    fireEvent.change(end, { target: { value: '2026-11-30' } });

    fireEvent.submit(form);

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock.mock.calls[0][0][0]).toMatchObject({ start_date: '2026-11-01', end_date: '2026-11-30' });
  });
});
