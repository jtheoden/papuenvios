import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ─── Mutable test state read by the mocks ───────────────────────────────────
const USD = 'usd-id';
const VALID_PHONE = '+13055551234';

const ZELLE_ON = [
  { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false },
  { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true },
];
const ZELLE_ORDERS_OFF = [ZELLE_ON[0], { ...ZELLE_ON[1], enabled_for_orders: false }];

const state = {
  cart: [],
  methods: ZELLE_ON,
  refresh: vi.fn(),
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    cart: state.cart,
    updateCartQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    financialSettings: { productProfit: 40, comboProfit: 35 },
    zelleAccounts: [],
    visualSettings: {},
    businessInfo: {},
    notificationSettings: {},
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'u1', email: 'u@test.com' } }),
}));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    selectedCurrency: USD,
    setSelectedCurrency: vi.fn(),
    currencies: [{ id: USD, code: 'USD', is_base: true }],
    currencyCode: 'USD',
    currencySymbol: '$',
    convertAmount: (amount) => amount,
  }),
}));
vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryInfo: { category: 'regular' }, categoryDiscountPercent: 0 }),
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
const ZONES = [
  { id: 1, province_name: 'Camagüey', municipality_name: null, shipping_cost: 0, free_shipping: false, is_active: true },
  { id: 2, province_name: 'Camagüey', municipality_name: 'Guáimaro', shipping_cost: 6, free_shipping: false, is_active: true },
];
vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn(async () => ZONES),
  calculateShippingCost: vi.fn(async () => ({ cost: 6 })),
}));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/currencyService', () => ({ convertCurrency: vi.fn(async (amount) => amount) }));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  generateWhatsAppURL: vi.fn(),
  buildAdminNewPaymentWhatsAppUrl: vi.fn(() => 'https://wa.me/5355550000?text=x'),
  openWhatsAppChat: vi.fn(),
}));
vi.mock('@/lib/notificationSettingsService', () => ({
  getActiveWhatsappRecipient: vi.fn(() => '+5355550000'),
  getFreshWhatsappRecipient: vi.fn(),
  getGuidedWhatsappPhone: vi.fn(() => '+5355550000'),
  getFreshNotificationSettings: vi.fn(async () => ({})),
}));
vi.mock('@/lib/orderService', () => ({ createOrder: vi.fn(), uploadPaymentProof: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  pickAvailableZelleAccount: vi.fn(async () => ({ id: 'z1' })),
  registerZelleTransaction: vi.fn(),
  ZELLE_TRANSACTION_TYPES: { PRODUCT: 'product' },
}));
vi.mock('@/lib/orderDiscountService', () => ({ validateAndGetOffer: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/imageUtils', () => ({ processImage: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({
  getHeadingStyle: () => ({}),
  getPrimaryButtonStyle: () => ({}),
  getAlertStyle: () => ({}),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/components/RecipientSelector', () => ({
  default: ({ onSelect }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          isNew: true,
          formData: { full_name: 'Ana', phone: '+5355551234', province: 'Camagüey', municipality: 'Guáimaro', address_line_1: 'Calle 1' },
        })
      }
    >
      pick-recipient
    </button>
  ),
}));
vi.mock('@/components/FileUploadWithPreview', () => ({
  default: ({ onChange }) => <input type="file" data-testid="proof-input" onChange={onChange} />,
}));
vi.mock('@/components/ZelleAccountSelector', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ id: 'z1', email: 'z@test.com' })}>
      pick-zelle
    </button>
  ),
}));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));

import CartPage from '@/components/CartPage';
import { createOrder, uploadPaymentProof } from '@/lib/orderService';
import { toast } from '@/components/ui/use-toast';

const checkoutButton = () => screen.getByRole('button', { name: 'cart.checkout' });
const confirmButton = () => screen.getByRole('button', { name: 'cart.payment.confirm' });

const reachPaymentStep = async () => {
  const utils = render(<CartPage onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-zelle' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
  await screen.findByText('$6.00');
  const next = await screen.findByRole('button', { name: /Continuar al Pago/ });
  await waitFor(() => expect(next).not.toBeDisabled());
  fireEvent.click(next);
  await screen.findByTestId('proof-input');
  return utils;
};

const fillPaymentForm = async () => {
  const file = new File(['x'], 'proof.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('cart.payment.missingProof')).toBeNull());
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPlaceholder'), { target: { value: 'John Payer' } });
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPhonePlaceholder'), { target: { value: VALID_PHONE } });
  await waitFor(() => expect(confirmButton()).not.toBeDisabled());
};

describe('CartPage - payment method gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cart = [{
      id: 'p1', name: 'Producto', name_es: 'Producto', base_price: 1, profit_margin: 45,
      final_price: 1.45, base_currency_id: USD, quantity: 2,
    }];
    state.methods = ZELLE_ON;
    state.refresh = vi.fn(async () => state.methods);
    createOrder.mockResolvedValue({ id: 'o1', order_number: 'ORD-1', payment_status: 'pending' });
    uploadPaymentProof.mockResolvedValue('https://files/proof.png');
  });

  it('shows no unavailable state while Zelle is enabled for orders', async () => {
    render(<CartPage onNavigate={vi.fn()} />);
    await screen.findByRole('button', { name: 'cart.checkout' });
    expect(screen.queryByText('paymentMethods.checkout.unavailableTitle')).not.toBeInTheDocument();
    expect(checkoutButton()).not.toBeDisabled();
  });

  it('shows an inline unavailable state and blocks checkout when Zelle is disabled for orders', async () => {
    state.methods = ZELLE_ORDERS_OFF;
    render(<CartPage onNavigate={vi.fn()} />);
    await screen.findByRole('button', { name: 'cart.checkout' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('paymentMethods.checkout.unavailableTitle');
    expect(alert).toHaveTextContent('paymentMethods.checkout.unavailableOrders');
    expect(checkoutButton()).toBeDisabled();
  });

  it('keeps the form and only blocks the final submit when the switch flips mid-checkout', async () => {
    const { rerender } = await reachPaymentStep();
    await fillPaymentForm();

    state.methods = ZELLE_ORDERS_OFF;
    rerender(<CartPage onNavigate={vi.fn()} />);

    expect(screen.getByText('paymentMethods.checkout.midCheckout').closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByTestId('proof-input')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('cart.payment.payerPlaceholder')).toHaveValue('John Payer');
    expect(screen.getByPlaceholderText('cart.payment.payerPhonePlaceholder')).toHaveValue(VALID_PHONE);
    expect(confirmButton()).toBeDisabled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('re-reads the status right before creating the order and stops if it was switched off', async () => {
    await reachPaymentStep();
    await fillPaymentForm();

    state.refresh = vi.fn(async () => ZELLE_ORDERS_OFF);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'paymentMethods.checkout.rejected', variant: 'destructive' })
      )
    );
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('locks the button while the pre-submit status read is pending (no double submit)', async () => {
    await reachPaymentStep();
    await fillPaymentForm();

    let release;
    state.refresh = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.click(confirmButton());

    const busy = await screen.findByRole('button', { name: 'cart.payment.processing' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);

    release(ZELLE_ON);
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it('releases the button again when the pre-submit read finds the method disabled', async () => {
    await reachPaymentStep();
    await fillPaymentForm();

    state.refresh = vi.fn(async () => ZELLE_ORDERS_OFF);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(toast).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'cart.payment.processing' })).not.toBeInTheDocument());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('still creates the order when the pre-submit status read fails (fails open)', async () => {
    await reachPaymentStep();
    await fillPaymentForm();

    state.refresh = vi.fn(async () => null);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  });

  it('maps the database rejection payment_method_disabled to a friendly message', async () => {
    await reachPaymentStep();
    await fillPaymentForm();

    createOrder.mockRejectedValue(Object.assign(new Error('payment_method_disabled'), { code: 'INTERNAL_SERVER_ERROR' }));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'paymentMethods.checkout.rejected', variant: 'destructive' })
      )
    );
    // The status is re-read so the inline alert catches up with the server.
    await waitFor(() => expect(state.refresh.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
