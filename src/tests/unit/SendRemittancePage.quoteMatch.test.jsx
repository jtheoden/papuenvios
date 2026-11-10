/**
 * What the form shows to send and to receive must be exactly what is stored. The wizard hands createRemittance the
 * quote on screen; when the live numbers moved (rate, commission, type edit) the service refuses and the wizard
 * goes back to the review step with the NEW quote, without creating anything.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const ZELLE_ON = [{ code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true }];
const ui = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u@test.com' }, isAdmin: false, isSuperAdmin: false }),
}));
vi.mock('@/contexts/LegalAcceptanceContext', () => ({ useLegalAcceptance: () => ({ ensureAccepted: vi.fn(async () => true) }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ notificationSettings: {} }) }));
vi.mock('@/hooks/usePaymentMethods', async () => {
  const service = await import('@/lib/paymentMethodsService');
  return {
    usePaymentMethods: () => ({
      methods: ZELLE_ON,
      loading: false,
      error: null,
      refresh: vi.fn(async () => ZELLE_ON),
      isMethodEnabled: (code, flow) => service.isPaymentMethodEnabled(ZELLE_ON, code, flow),
      isFlowBlocked: (flow) => service.isFlowBlocked(ZELLE_ON, flow),
    }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/remittanceService', () => ({
  getActiveRemittanceTypes: vi.fn(async () => [
    { id: 't1', name: 'USD a CUP', currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 100, min_amount: 1, max_amount: 1000, delivery_method: 'cash' },
  ]),
  getRemittanceExchangeRate: vi.fn(async () => ({ rate: 100, source: 'configured' })),
  calculateRemittance: vi.fn(async () => ({
    amount: 50, currency: 'USD', exchangeRate: 100, totalCommission: 1, discountAmount: 0, amountToDeliver: 4900, deliveryCurrency: 'CUP',
  })),
  calculateReverseRemittance: vi.fn(),
  createRemittance: vi.fn(),
  uploadPaymentProof: vi.fn(),
}));
vi.mock('@/lib/shippingService', () => ({ getActiveShippingZones: vi.fn(async () => []) }));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/whatsappService', () => ({
  ADMIN_NOTIFICATION_LANGUAGE: 'es',
  buildAdminNewPaymentProofWhatsAppUrl: vi.fn(async () => 'https://wa.me/proof'),
  buildAdminNewRemittanceWhatsAppUrl: vi.fn(() => 'https://wa.me/remittance'),
  buildRemittanceNotificationPayload: vi.fn((r) => r),
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshGuidedWhatsappPhone: vi.fn() }));
vi.mock('@/lib/orderDiscountService', () => ({ validateRemittanceOffer: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => ui.toast(...args) }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/components/RecipientSelector', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function RecipientSelectorMock({ onSelect }, _ref) {
      return (
        <button type="button" onClick={() => onSelect({ recipientId: 'rc1', addressId: 'ad1', recipientData: { full_name: 'Ana', phone: '555', addresses: [] } })}>
          pick-recipient
        </button>
      );
    }),
  };
});
vi.mock('@/components/ZelleAccountSelector', () => ({
  default: ({ onSelect }) => <button type="button" onClick={() => onSelect({ id: 'z1' })}>pick-zelle</button>,
}));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));
vi.mock('@/components/ui/InfoTooltip', () => ({ InfoTooltip: () => null }));
vi.mock('@/components/shared/AmountDisplayCard', () => ({ default: () => null }));
vi.mock('@/components/shared/PaymentProofForm', () => ({
  default: ({ onSubmit }) => <button type="button" onClick={() => onSubmit({ payerPhone: '' })}>submit-proof</button>,
}));

import SendRemittancePage from '@/components/SendRemittancePage';
import { createRemittance } from '@/lib/remittanceService';
import { AppError, ERROR_CODES } from '@/lib/errorHandler';

const continueBtn = () => screen.getByRole('button', { name: /remittances\.wizard\.continue/ });
const confirmButton = () => screen.getByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ });

const goToStepThree = async () => {
  const select = await screen.findByRole('combobox');
  await screen.findByRole('option', { name: 'USD a CUP' });
  fireEvent.change(select, { target: { value: 't1' } });
  fireEvent.change(await screen.findByPlaceholderText('remittances.wizard.placeholderSend'), { target: { value: '50' } });
  await waitFor(() => expect(continueBtn()).not.toBeDisabled());
  fireEvent.click(continueBtn());
  fireEvent.click(await screen.findByText('pick-zelle'));
  fireEvent.click(await screen.findByText('pick-recipient'));
  fireEvent.click(continueBtn());
  await screen.findByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SendRemittancePage - the quote on screen is the quote that gets stored', () => {
  it('hands createRemittance the amounts the customer is looking at', async () => {
    createRemittance.mockResolvedValue({ id: 'r1', remittance_number: 'REM-1', delivery_cost: 0 });
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepThree();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(createRemittance).toHaveBeenCalledTimes(1));
    expect(createRemittance.mock.calls[0][0].expectedQuote).toEqual({
      amountSent: 50,
      amountToDeliver: 4900,
      exchangeRate: 100,
      commissionTotal: 1,
    });
  });

  it('when the live quote moved it shows the new amounts for review and creates nothing', async () => {
    createRemittance.mockRejectedValue(
      new AppError('changed', ERROR_CODES.REMITTANCE_QUOTE_CHANGED, 409, {
        expected: { amountSent: 50, amountToDeliver: 4900, exchangeRate: 100, commissionTotal: 1 },
        actual: { amountSent: 50, amountToDeliver: 5100, exchangeRate: 102, commissionTotal: 1, discountAmount: 0.5 },
      })
    );
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepThree();

    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(ui.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'remittances.wizard.quoteChanged', variant: 'destructive' })
      )
    );
    // back on the review step, showing what the recipient would really get now
    await waitFor(() => expect(document.body.textContent).toContain('5100.00 CUP'));
    // the coupon discount moves with the rest of the quote, it is not left at the old value
    expect(document.body.textContent).toContain('+0.50 USD');
    expect(screen.queryByText('submit-proof')).toBeNull();
    expect(createRemittance).toHaveBeenCalledTimes(1);
  });
});
