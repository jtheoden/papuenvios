/**
 * Rate and commission of a remittance type (and creating types) are super_admin only. The database will enforce it
 * (Phase 3 migration); the UI must not offer to a plain admin what the server will refuse. Everything else
 * (name, limits, delivery, is_active, ...) stays editable for admins.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: auth.isSuperAdmin }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/currencyService', () => ({
  getCurrenciesWithRates: vi.fn(async () => [
    { id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar' },
    { id: 'cup', code: 'CUP', name_es: 'Peso', name_en: 'Peso' }
  ])
}));

const svc = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), types: [] }));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittanceTypes: vi.fn(async () => svc.types),
  createRemittanceType: (...args) => svc.create(...args),
  updateRemittanceType: (...args) => svc.update(...args),
  deleteRemittanceType: vi.fn(),
  getPendingRemittancesCountByType: vi.fn(async () => 0),
  DELIVERY_METHODS: { CASH: 'cash', TRANSFER: 'transfer', CARD: 'card' }
}));

import RemittanceTypesConfig from '@/components/RemittanceTypesConfig';

const TYPE = {
  id: 't1',
  name: 'Dollars to CUP',
  currency_code: 'USD',
  delivery_currency: 'CUP',
  exchange_rate: 915,
  commission_percentage: 3,
  commission_fixed: 1,
  min_amount: 5,
  max_amount: 1000,
  delivery_method: 'cash',
  max_delivery_days: 3,
  warning_days: 2,
  description: '',
  icon: 'dollar-sign',
  is_active: true,
  display_order: 0
};

const openEdit = async () => {
  fireEvent.click(await screen.findByTitle('common.edit'));
  return {
    name: await screen.findByDisplayValue('Dollars to CUP'),
    market: await screen.findByPlaceholderText('472.00'),
    delivery: await screen.findByPlaceholderText('470.00'),
    fixed: await screen.findByPlaceholderText('0.00')
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.types = [{ ...TYPE }];
  svc.update.mockResolvedValue({});
  svc.create.mockResolvedValue({});
});

describe('plain admin', () => {
  beforeEach(() => {
    auth.isSuperAdmin = false;
  });

  it('cannot create types: no "new type" button, with or without existing types', async () => {
    const { unmount } = render(<RemittanceTypesConfig />);
    await screen.findByText('Dollars to CUP');
    expect(screen.queryByRole('button', { name: /remittances\.admin\.newType/ })).toBeNull();
    unmount();

    svc.types = [];
    render(<RemittanceTypesConfig />);
    await waitFor(() => expect(screen.queryByText('Dollars to CUP')).toBeNull());
    expect(screen.queryByRole('button', { name: /remittances\.admin\.newType/ })).toBeNull();
  });

  it('edits with rate and commission fields locked, the reason visible, and the other fields open', async () => {
    render(<RemittanceTypesConfig />);
    const { name, market, delivery, fixed } = await openEdit();

    [market, delivery, fixed].forEach((input) => {
      expect(input).toBeDisabled();
      expect(input.getAttribute('aria-describedby')).toBe('remittance-rate-super-admin-only-note');
    });
    expect(document.getElementById('remittance-rate-super-admin-only-note')).toHaveTextContent('remittances.admin.rateFieldsSuperAdminOnly');
    expect(name).not.toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
  });

  it('still lets the admin activate/deactivate a type from the list', async () => {
    render(<RemittanceTypesConfig />);
    fireEvent.click(await screen.findByTitle('remittances.admin.deactivate'));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith('t1', { is_active: false }));
  });

  it('saves without sending rate or commission columns (a server restriction would reject them even if unchanged)', async () => {
    render(<RemittanceTypesConfig />);
    const { name } = await openEdit();
    fireEvent.change(name, { target: { value: 'Dollars to CUP (cash)' } });
    fireEvent.click(screen.getByRole('button', { name: /common\.save$/ }));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    const [id, payload] = svc.update.mock.calls[0];
    expect(id).toBe('t1');
    expect(payload).toMatchObject({ name: 'Dollars to CUP (cash)', min_amount: 5, delivery_method: 'cash', is_active: true });
    expect(payload).not.toHaveProperty('exchange_rate');
    expect(payload).not.toHaveProperty('commission_percentage');
    expect(payload).not.toHaveProperty('commission_fixed');
  });
});

describe('super_admin', () => {
  beforeEach(() => {
    auth.isSuperAdmin = true;
  });

  it('can create types', async () => {
    render(<RemittanceTypesConfig />);
    await screen.findByText('Dollars to CUP');
    expect(screen.getAllByRole('button', { name: /remittances\.admin\.newType/ }).length).toBeGreaterThan(0);
  });

  it('edits rate and commission fields and sends them', async () => {
    render(<RemittanceTypesConfig />);
    const { market, delivery, fixed } = await openEdit();
    [market, delivery, fixed].forEach((input) => expect(input).not.toBeDisabled());
    expect(document.getElementById('remittance-rate-super-admin-only-note')).toBeNull();

    fireEvent.change(market, { target: { value: '920' } });
    fireEvent.click(screen.getByRole('button', { name: /common\.save$/ }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update.mock.calls[0][1]).toMatchObject({ exchange_rate: 920, commission_fixed: 1 });
    expect(svc.update.mock.calls[0][1]).toHaveProperty('commission_percentage');
  });
});
