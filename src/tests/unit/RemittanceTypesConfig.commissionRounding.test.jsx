/**
 * A9 - the commission percentage derived from market/delivery rates is rounded to the stored scale (2 decimals)
 * and the admin sees the delivery rate that will really apply.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/currencyService', () => ({ getCurrenciesWithRates: vi.fn(async () => []) }));

const svc = vi.hoisted(() => ({ create: vi.fn(), types: [] }));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittanceTypes: vi.fn(async () => svc.types),
  createRemittanceType: (...args) => svc.create(...args),
  updateRemittanceType: vi.fn(),
  deleteRemittanceType: vi.fn(),
  getPendingRemittancesCountByType: vi.fn(async () => 0),
  DELIVERY_METHODS: { CASH: 'cash', TRANSFER: 'transfer', CARD: 'card' }
}));

import RemittanceTypesConfig from '@/components/RemittanceTypesConfig';

const openForm = async () => {
  fireEvent.click((await screen.findAllByRole('button', { name: /remittances\.admin\.newType/ }))[0]);
  return {
    market: await screen.findByPlaceholderText('472.00'),
    delivery: await screen.findByPlaceholderText('470.00')
  };
};

describe('RemittanceTypesConfig commission derived from rates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.types = [];
  });

  it('shows the rounded percentage and the effective delivery rate it produces', async () => {
    render(<RemittanceTypesConfig />);
    const { market, delivery } = await openForm();
    fireEvent.change(market, { target: { value: '520' } });
    fireEvent.change(delivery, { target: { value: '500' } });

    // 3.846153...% is rounded to 2 decimals (A9): the UI shows what will be saved, not the raw float
    await waitFor(() => expect(screen.getByText('3.85%')).toBeInTheDocument());
    expect(screen.getByText('remittances.admin.effectiveDeliveryRate:')).toBeInTheDocument();
    expect(screen.getByTestId('effective-delivery-rate')).toHaveTextContent('499.98');
  });

  it('shows an exact percentage unchanged and an effective rate equal to the typed one', async () => {
    render(<RemittanceTypesConfig />);
    const { market, delivery } = await openForm();
    fireEvent.change(market, { target: { value: '800' } });
    fireEvent.change(delivery, { target: { value: '780' } });

    await waitFor(() => expect(screen.getByText('2.5%')).toBeInTheDocument());
    expect(screen.getByTestId('effective-delivery-rate')).toHaveTextContent('780.00');
  });
});
