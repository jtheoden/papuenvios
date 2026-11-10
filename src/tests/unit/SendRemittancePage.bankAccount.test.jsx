/**
 * Card / transfer remittances are paid into the recipient's account: the wizard must not let the customer continue
 * unless the selected recipient has an account in the delivery currency, and it must never reuse the account of a
 * previously selected recipient.
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
    { id: 't1', name: 'USD a tarjeta', currency_code: 'USD', delivery_currency: 'USD', exchange_rate: 1.03, min_amount: 1, max_amount: 1000, delivery_method: 'card' },
  ]),
  getRemittanceExchangeRate: vi.fn(async () => ({ rate: 100, source: 'configured' })),
  calculateRemittance: vi.fn(async () => ({
    amount: 50, currency: 'USD', exchangeRate: 1, totalCommission: 1.46, discountAmount: 0, amountToDeliver: 48.54, deliveryCurrency: 'USD',
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
  const pick = (onSelect, over) =>
    onSelect({ recipientId: 'rc1', addressId: 'ad1', recipientData: { full_name: 'Ana', phone: '555', addresses: [] }, ...over });
  return {
    default: React.forwardRef(function RecipientSelectorMock({ onSelect }, _ref) {
      return (
        <div>
          <button type="button" onClick={() => pick(onSelect, { recipient_bank_account_id: 'link-1', bank_account_details: { currency: { code: 'USD' } } })}>
            pick-recipient-with-card
          </button>
          <button type="button" onClick={() => pick(onSelect, { recipient_bank_account_id: 'link-2', bank_account_details: { currency: { code: 'CUP' } } })}>
            pick-recipient-with-cup-card
          </button>
          <button type="button" onClick={() => pick(onSelect, { recipient_bank_account_id: null, bank_account_details: null })}>
            pick-recipient-without-card
          </button>
        </div>
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

const continueBtn = () => screen.getByRole('button', { name: /remittances\.wizard\.continue/ });

const goToStepTwo = async () => {
  const select = await screen.findByRole('combobox');
  await screen.findByRole('option', { name: 'USD a tarjeta' });
  fireEvent.change(select, { target: { value: 't1' } });
  fireEvent.change(await screen.findByPlaceholderText('remittances.wizard.placeholderSend'), { target: { value: '50' } });
  await waitFor(() => expect(continueBtn()).not.toBeDisabled());
  fireEvent.click(continueBtn());
  fireEvent.click(await screen.findByText('pick-zelle'));
};

const tryToContinue = async () => {
  fireEvent.click(continueBtn());
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SendRemittancePage - card / transfer remittances need the recipient to have an account', () => {
  it('lets the customer continue with an account in the delivery currency', async () => {
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepTwo();
    fireEvent.click(await screen.findByText('pick-recipient-with-card'));

    await tryToContinue();

    await screen.findByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ });
  });

  it('blocks continuing when the recipient has no account', async () => {
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepTwo();
    fireEvent.click(await screen.findByText('pick-recipient-without-card'));

    await tryToContinue();

    await waitFor(() =>
      expect(ui.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'remittances.wizard.selectBankAccountCurrency', variant: 'destructive' }))
    );
    expect(screen.queryByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ })).toBeNull();
  });

  it('does not keep the account of a previous recipient after switching to one without account', async () => {
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepTwo();
    fireEvent.click(await screen.findByText('pick-recipient-with-card'));
    fireEvent.click(await screen.findByText('pick-recipient-without-card'));

    await tryToContinue();

    await waitFor(() => expect(ui.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(screen.queryByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ })).toBeNull();
  });

  it('blocks an account that is not in the delivery currency', async () => {
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepTwo();
    fireEvent.click(await screen.findByText('pick-recipient-with-cup-card'));

    await tryToContinue();

    await waitFor(() => expect(ui.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(screen.queryByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ })).toBeNull();
  });

  it('sends the recipient and the account to createRemittance', async () => {
    createRemittance.mockResolvedValue({ id: 'r1', remittance_number: 'REM-1', delivery_cost: 0 });
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepTwo();
    fireEvent.click(await screen.findByText('pick-recipient-with-card'));
    await tryToContinue();
    fireEvent.click(await screen.findByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ }));

    await waitFor(() => expect(createRemittance).toHaveBeenCalledTimes(1));
    expect(createRemittance.mock.calls[0][0]).toMatchObject({ recipient_id: 'rc1', recipient_bank_account_id: 'link-1' });
  });
});
