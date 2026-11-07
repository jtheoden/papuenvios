import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// "Before you pay" block on the confirm step: it shows the page's own values (no new formula).
// total to pay = amount sent + delivery cost (calcTotalToPay); a coupon lowers the fee, not the total.
const ZELLE_ON = [{ code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true }];
const state = vi.hoisted(() => ({ zones: [], addresses: [] }));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u@test.com' }, isAdmin: false, isSuperAdmin: false }),
}));
vi.mock('@/contexts/LegalAcceptanceContext', () => ({ useLegalAcceptance: () => ({ ensureAccepted: vi.fn() }) }));
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

const FULL = { amount: 100, currency: 'USD', exchangeRate: 100, totalCommission: 2, originalCommission: 2, discountAmount: 0, amountToDeliver: 9800, deliveryCurrency: 'CUP' };
const WITH_COUPON = { ...FULL, totalCommission: 1, discountAmount: 1, amountToDeliver: 9900 };

vi.mock('@/lib/remittanceService', () => ({
  getActiveRemittanceTypes: vi.fn(async () => [
    { id: 't1', name: 'USD a CUP', currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 100, min_amount: 1, max_amount: 1000, delivery_method: 'cash' },
  ]),
  getRemittanceExchangeRate: vi.fn(async () => ({ rate: 100, source: 'configured' })),
  calculateRemittance: vi.fn(async (_id, _amount, offer) => (offer ? WITH_COUPON : FULL)),
  calculateReverseRemittance: vi.fn(),
  createRemittance: vi.fn(),
  uploadPaymentProof: vi.fn(),
}));
vi.mock('@/lib/shippingService', () => ({ getActiveShippingZones: vi.fn(async () => state.zones) }));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/whatsappService', () => ({
  ADMIN_NOTIFICATION_LANGUAGE: 'es',
  buildAdminNewPaymentProofWhatsAppUrl: vi.fn(async () => ''),
  buildAdminNewRemittanceWhatsAppUrl: vi.fn(() => ''),
  buildRemittanceNotificationPayload: vi.fn((r) => r),
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshGuidedWhatsappPhone: vi.fn() }));
vi.mock('@/lib/orderDiscountService', () => ({
  validateRemittanceOffer: vi.fn(async () => ({ valid: true, offer: { id: 'of1', code: 'MENOS1' } })),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/components/RecipientSelector', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function RecipientSelectorMock({ onSelect }, _ref) {
      return (
        <button
          type="button"
          onClick={() => onSelect({ recipientId: 'rc1', addressId: 'ad1', recipientData: { full_name: 'Ana', phone: '555', addresses: state.addresses } })}
        >
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
vi.mock('@/components/shared/PaymentProofForm', () => ({ default: () => null }));

import SendRemittancePage from '@/components/SendRemittancePage';
import { calculateRemittance } from '@/lib/remittanceService';

const continueBtn = () => screen.getByRole('button', { name: /remittances\.wizard\.continue/ });

const fillAmount = async () => {
  const select = await screen.findByRole('combobox');
  await screen.findByRole('option', { name: 'USD a CUP' });
  fireEvent.change(select, { target: { value: 't1' } });
  fireEvent.change(await screen.findByPlaceholderText('remittances.wizard.placeholderSend'), { target: { value: '100' } });
};

const toConfirmStep = async () => {
  await waitFor(() => expect(continueBtn()).not.toBeDisabled());
  fireEvent.click(continueBtn());
  fireEvent.click(await screen.findByText('pick-zelle'));
  fireEvent.click(await screen.findByText('pick-recipient'));
  fireEvent.click(continueBtn());
  await screen.findByRole('button', { name: /remittances\.wizard\.confirmAndCreate/ });
  return screen.getByRole('region', { name: 'beforePaying.title' }).textContent;
};

describe('SendRemittancePage - before you pay block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.zones = [];
    state.addresses = [];
  });

  it('with a delivery cost: total to pay = amount sent + delivery cost; the recipient amount is untouched', async () => {
    state.zones = [{ id: 'zn1', province_name: 'Camagüey', municipality_name: null, is_active: true, shipping_cost: 7.5 }];
    state.addresses = [{ id: 'ad1', province: 'Camagüey', municipality: 'Guáimaro', address_line_1: 'Calle 1' }];
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await fillAmount();
    const text = await toConfirmStep();
    expect(text).toContain('7.50 USD');
    expect(text).toContain('107.50 USD');
    expect(text).toContain('2.00 USD');
    expect(text).toContain('9800.00 CUP');
  });

  it('with a coupon: the block shows the discounted fee from the coupon calculation and the same total', async () => {
    render(<SendRemittancePage onNavigate={vi.fn()} />);
    await fillAmount();
    fireEvent.change(screen.getByPlaceholderText('remittances.wizard.couponPlaceholder'), { target: { value: 'MENOS1' } });
    fireEvent.click(screen.getByRole('button', { name: 'remittances.wizard.applyCoupon' }));
    await screen.findByRole('button', { name: 'common.remove' });
    const text = await toConfirmStep();
    expect(calculateRemittance).toHaveBeenLastCalledWith('t1', 100, { id: 'of1', code: 'MENOS1' });
    expect(text).toContain('1.00 USD');
    expect(text).toContain('100.00 USD');
    expect(text).toContain('9900.00 CUP');
    expect(within(screen.getByRole('region', { name: 'beforePaying.title' })).queryByText(/2\.00 USD/)).toBeNull();
  });
});
