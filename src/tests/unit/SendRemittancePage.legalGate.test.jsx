import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const NOTIFICATION_SETTINGS = { sentinel: 'notification-settings' };
const ZELLE_ON = [
  { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true },
];

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u@test.com' }, isAdmin: false, isSuperAdmin: false }),
}));
const ensureAccepted = vi.fn();
vi.mock('@/contexts/LegalAcceptanceContext', () => ({
  useLegalAcceptance: () => ({ ensureAccepted: (...args) => ensureAccepted(...args) }),
}));
vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ notificationSettings: NOTIFICATION_SETTINGS }),
}));

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
    {
      id: 't1',
      name: 'USD a CUP',
      currency_code: 'USD',
      delivery_currency: 'CUP',
      exchange_rate: 100,
      min_amount: 1,
      max_amount: 1000,
      delivery_method: 'cash',
    },
  ]),
  getRemittanceExchangeRate: vi.fn(async () => ({ rate: 100, source: 'configured' })),
  calculateRemittance: vi.fn(async () => ({
    amount: 50,
    currency: 'USD',
    totalCommission: 1,
    discountAmount: 0,
    amountToDeliver: 4900,
    deliveryCurrency: 'CUP',
  })),
  calculateReverseRemittance: vi.fn(),
  createRemittance: vi.fn(async () => ({ id: 'r1', remittance_number: 'REM-1', delivery_cost: 0 })),
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
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => '', getPrimaryButtonStyle: () => '' }));

vi.mock('@/components/RecipientSelector', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function RecipientSelectorMock({ onSelect }, _ref) {
      return (
        <button
          type="button"
          onClick={() =>
            onSelect({
              recipientId: 'rc1',
              addressId: 'ad1',
              recipientData: { full_name: 'Ana', phone: '555', addresses: [] },
            })
          }
        >
          pick-recipient
        </button>
      );
    }),
  };
});
vi.mock('@/components/ZelleAccountSelector', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ id: 'z1' })}>
      pick-zelle
    </button>
  ),
}));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({
  default: ({ isOpen, whatsappUrl, whatsappNumber, orderNumber, proofPending }) => (
    <div
      data-testid="confirmation-modal"
      data-open={String(Boolean(isOpen))}
      data-whatsapp-url={whatsappUrl ?? ''}
      data-whatsapp-number={whatsappNumber ?? ''}
      data-order-number={orderNumber ?? ''}
      data-proof-pending={String(Boolean(proofPending))}
    />
  ),
}));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));
vi.mock('@/components/ui/InfoTooltip', () => ({ InfoTooltip: () => null }));
vi.mock('@/components/shared/AmountDisplayCard', () => ({ default: () => null }));
vi.mock('@/components/shared/PaymentProofForm', () => ({
  default: ({ onSubmit, onUploadLater }) => (
    <div>
      <button type="button" onClick={() => onSubmit({ payerPhone: '' })}>
        submit-proof
      </button>
      <button type="button" onClick={() => onUploadLater()}>
        upload-later
      </button>
    </div>
  ),
}));

import SendRemittancePage from '@/components/SendRemittancePage';
import { createRemittance } from '@/lib/remittanceService';

const goToStepThree = async () => {
  const select = await screen.findByRole('combobox');
  await screen.findByRole('option', { name: 'USD a CUP' });
  fireEvent.change(select, { target: { value: 't1' } });
  fireEvent.change(await screen.findByPlaceholderText('remittances.wizard.placeholderSend'), {
    target: { value: '50' },
  });
  const continueBtn = () => screen.getByRole('button', { name: /remittances\.wizard\.continue/ });
  await waitFor(() => expect(continueBtn()).not.toBeDisabled());
  fireEvent.click(continueBtn());

  fireEvent.click(await screen.findByText('pick-zelle'));
  fireEvent.click(await screen.findByText('pick-recipient'));
  fireEvent.click(continueBtn());
  await screen.findByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ });
};

const confirmButton = () => screen.getByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ });

describe('SendRemittancePage - legal acceptance gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureAccepted.mockReset();
    createRemittance.mockResolvedValue({ id: 'r1', remittance_number: 'REM-1', delivery_cost: 0 });
  });

  it('does not create the remittance when the user declines the gate', async () => {
    ensureAccepted.mockResolvedValue(false);
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepThree();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(ensureAccepted).toHaveBeenCalledWith('remittance'));
    expect(createRemittance).not.toHaveBeenCalled();
    // Stays on the confirmation step with the button released so the user can retry
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(screen.queryByText('submit-proof')).toBeNull();
  });

  it('does not create the remittance while the gate is still open', async () => {
    ensureAccepted.mockReturnValue(new Promise(() => {}));
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepThree();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(ensureAccepted).toHaveBeenCalledTimes(1));
    expect(createRemittance).not.toHaveBeenCalled();
  });

  it('creates the remittance and moves to the proof step after the gate resolves true', async () => {
    ensureAccepted.mockResolvedValue(true);
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await goToStepThree();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(createRemittance).toHaveBeenCalledTimes(1));
    await screen.findByText('submit-proof');
  });
});
