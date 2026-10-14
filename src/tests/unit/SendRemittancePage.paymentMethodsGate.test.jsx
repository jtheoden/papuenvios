import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const ZELLE_ON = [
  { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false },
  { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true },
];
const ZELLE_REMITTANCES_OFF = [ZELLE_ON[0], { ...ZELLE_ON[1], enabled_for_remittances: false }];

const state = { methods: ZELLE_ON, refresh: vi.fn() };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u@test.com' }, isAdmin: false, isSuperAdmin: false }),
}));
vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('@/hooks/usePaymentMethods', async () => {
  const service = await import('@/lib/paymentMethodsService');
  return {
    usePaymentMethods: () => ({
      methods: state.methods,
      loading: false,
      error: null,
      refresh: (...a) => state.refresh(...a),
      isMethodEnabled: (code, flow) => service.isPaymentMethodEnabled(state.methods, code, flow),
      isFlowBlocked: (flow) => service.isFlowBlocked(state.methods, flow),
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
  calculateRemittance: vi.fn(),
  calculateReverseRemittance: vi.fn(),
  createRemittance: vi.fn(),
  uploadPaymentProof: vi.fn(),
}));
vi.mock('@/lib/shippingService', () => ({ getActiveShippingZones: vi.fn(async () => []) }));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/whatsappService', () => ({
  ADMIN_NOTIFICATION_LANGUAGE: 'es',
  buildAdminNewPaymentProofWhatsAppUrl: vi.fn(),
  buildAdminNewRemittanceWhatsAppUrl: vi.fn(),
  buildRemittanceNotificationPayload: vi.fn(),
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshGuidedWhatsappPhone: vi.fn(async () => null) }));
vi.mock('@/lib/orderDiscountService', () => ({ validateRemittanceOffer: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => '', getPrimaryButtonStyle: () => '' }));

vi.mock('@/components/RecipientSelector', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountSelector', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));
vi.mock('@/components/ui/InfoTooltip', () => ({ InfoTooltip: () => null }));
vi.mock('@/components/shared/AmountDisplayCard', () => ({ default: () => null }));
vi.mock('@/components/shared/PaymentProofForm', () => ({ default: () => null }));

import SendRemittancePage from '@/components/SendRemittancePage';

const continueButton = () => screen.getByRole('button', { name: /remittances\.wizard\.continue/ });

const fillStepOne = async () => {
  const select = await screen.findByRole('combobox');
  await screen.findByRole('option', { name: 'USD a CUP' });
  fireEvent.change(select, { target: { value: 't1' } });
  fireEvent.change(await screen.findByPlaceholderText('remittances.wizard.placeholderSend'), {
    target: { value: '50' },
  });
};

describe('SendRemittancePage - payment method gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.methods = ZELLE_ON;
    state.refresh = vi.fn(async () => state.methods);
  });

  it('lets the customer continue while Zelle is enabled for remittances', async () => {
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await fillStepOne();

    expect(screen.queryByText('paymentMethods.checkout.unavailableTitle')).not.toBeInTheDocument();
    await waitFor(() => expect(continueButton()).not.toBeDisabled());
  });

  it('shows the inline unavailable state and blocks the wizard when Zelle is disabled for remittances', async () => {
    state.methods = ZELLE_REMITTANCES_OFF;
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await fillStepOne();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('paymentMethods.checkout.unavailableTitle');
    expect(alert).toHaveTextContent('paymentMethods.checkout.unavailableRemittances');
    expect(continueButton()).toBeDisabled();
  });

  it('keeps the typed amount while blocked (nothing is reset)', async () => {
    state.methods = ZELLE_REMITTANCES_OFF;
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await fillStepOne();

    expect(screen.getByPlaceholderText('remittances.wizard.placeholderSend')).toHaveValue(50);
  });

  it('is not blocked by the ORDERS flow being disabled', async () => {
    state.methods = [ZELLE_ON[0], { ...ZELLE_ON[1], enabled_for_orders: false }];
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await fillStepOne();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(continueButton()).not.toBeDisabled());
  });
});
