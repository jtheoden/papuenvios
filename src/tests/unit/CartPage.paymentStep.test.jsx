import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ─── Mutable test state read by the mocks ───────────────────────────────────
const state = {
  cart: [],
  zones: [],
  pick: { province: '', municipality: '' },
};

const USD = 'usd-id';
const VALID_PHONE = '+13055551234';

let nextId = 1;
const zone = (province, municipality, cost) => ({
  id: nextId++,
  province_name: province,
  municipality_name: municipality,
  shipping_cost: cost,
  free_shipping: false,
  is_active: true,
});

const liveZones = () => [
  zone('Artemisa', null, 0),
  zone('Camagüey', null, 0),
  zone('Camagüey', 'Guáimaro', 6),
];

// ─── Context mocks ───────────────────────────────────────────────────────────
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

// ─── Service / helper mocks ──────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn(async () => state.zones),
  calculateShippingCost: vi.fn(async (province, _total, municipality) => {
    const rows = state.zones.filter((z) => z.province_name === province);
    const row = rows.find((z) => z.municipality_name === municipality) || rows.find((z) => !z.municipality_name);
    return { cost: parseFloat(row.shipping_cost) };
  }),
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
vi.mock('@/lib/orderDiscountService', () => ({
  validateAndGetOffer: vi.fn(),
  recordOfferUsage: vi.fn(),
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/imageUtils', () => ({ processImage: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({
  getHeadingStyle: () => ({}),
  getPrimaryButtonStyle: () => ({}),
  getAlertStyle: () => ({}),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

// ─── Child component stubs (not under test) ──────────────────────────────────
vi.mock('@/components/RecipientSelector', () => ({
  default: ({ onSelect }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          isNew: true,
          formData: {
            full_name: 'Ana',
            phone: '+5355551234',
            province: state.pick.province,
            municipality: state.pick.municipality,
            address_line_1: 'Calle 1',
          },
        })
      }
    >
      pick-recipient
    </button>
  ),
}));
// The upload stub forwards the file input change exactly like the real component does.
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
import { buildAdminNewPaymentWhatsAppUrl } from '@/lib/whatsappService';

const confirmButton = () => screen.getByRole('button', { name: 'cart.payment.confirm' });

const reachPaymentStep = async () => {
  state.pick = { province: 'Camagüey', municipality: 'Guáimaro' };
  render(<CartPage onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-zelle' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
  await screen.findByText('$6.00');
  const next = screen.getByRole('button', { name: /Continuar al Pago/ });
  await waitFor(() => expect(next).not.toBeDisabled());
  fireEvent.click(next);
  await screen.findByTestId('proof-input');
};

const attachProof = async () => {
  const file = new File(['x'], 'proof.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
  // The proof is stored asynchronously (FileReader); the hint disappears once it is set
  await waitFor(() => expect(screen.queryByText('cart.payment.missingProof')).toBeNull());
};

const fillPayer = () => {
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPlaceholder'), {
    target: { value: 'John Payer' },
  });
};

const typePhone = (value) => {
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPhonePlaceholder'), {
    target: { value },
  });
};

describe('CartPage - payment step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cart = [{
      id: 'p1', name: 'Producto', name_es: 'Producto', base_price: 1, profit_margin: 45,
      final_price: 1.45, base_currency_id: USD, quantity: 2,
    }];
    state.zones = liveZones();
    createOrder.mockResolvedValue({ id: 'o1', order_number: 'ORD-1', payment_status: 'pending' });
    uploadPaymentProof.mockResolvedValue('https://files/proof.png');
  });

  describe('payer phone gate (PR-06b)', () => {
    it('keeps confirm disabled and never creates the order without a valid payer phone', async () => {
      await reachPaymentStep();
      await attachProof();
      fillPayer();

      expect(screen.getByText('cart.payment.missingPayerPhone')).toBeInTheDocument();
      expect(confirmButton()).toBeDisabled();
      fireEvent.click(confirmButton());

      typePhone('not-a-phone');
      expect(confirmButton()).toBeDisabled();
      fireEvent.click(confirmButton());

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(createOrder).not.toHaveBeenCalled();
      expect(uploadPaymentProof).not.toHaveBeenCalled();
    });

    it('creates the order once with the trimmed payer phone, only after the gate passes, then uploads the proof', async () => {
      await reachPaymentStep();
      await attachProof();
      fillPayer();
      typePhone('   ');
      fireEvent.click(confirmButton());
      expect(createOrder).not.toHaveBeenCalled();
      expect(uploadPaymentProof).not.toHaveBeenCalled();

      typePhone(`  ${VALID_PHONE}  `);
      await waitFor(() => expect(confirmButton()).not.toBeDisabled());
      fireEvent.click(confirmButton());

      await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
      expect(createOrder.mock.calls[0][0]).toMatchObject({ payerPhone: VALID_PHONE, userId: 'u1' });

      await waitFor(() => expect(uploadPaymentProof).toHaveBeenCalledTimes(1));
      expect(uploadPaymentProof.mock.calls[0].slice(1)).toEqual([
        'o1', 'u1', 'John Payer', { payerPhone: VALID_PHONE },
      ]);
      expect(createOrder.mock.invocationCallOrder[0])
        .toBeLessThan(uploadPaymentProof.mock.invocationCallOrder[0]);
    });
  });

  describe('guided admin notification after a successful order', () => {
    const submitValidOrder = async () => {
      await reachPaymentStep();
      await attachProof();
      fillPayer();
      typePhone(VALID_PHONE);
      await waitFor(() => expect(confirmButton()).not.toBeDisabled());
      fireEvent.click(confirmButton());
      await waitFor(() => expect(buildAdminNewPaymentWhatsAppUrl).toHaveBeenCalledTimes(1));
    };

    it('builds the wa.me URL with the payer phone and never opens a window by itself', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await submitValidOrder();

      const [orderForNotification, recipient] = buildAdminNewPaymentWhatsAppUrl.mock.calls[0];
      expect(recipient).toBe('+5355550000');
      expect(orderForNotification).toMatchObject({ order_number: 'ORD-1', payer_phone: VALID_PHONE });
      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe('shipping blocked (PR-08)', () => {
    it('does not reach the payment step nor create an order for an unavailable zone', async () => {
      state.pick = { province: 'Artemisa', municipality: 'Artemisa' };
      render(<CartPage onNavigate={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
      fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));

      expect(await screen.findByText('cart.shippingUnavailable')).toBeInTheDocument();
      const next = screen.getByRole('button', { name: /Continuar al Pago/ });
      await waitFor(() => expect(next).toBeDisabled());
      fireEvent.click(next);

      expect(screen.queryByTestId('proof-input')).toBeNull();
      expect(createOrder).not.toHaveBeenCalled();
      expect(uploadPaymentProof).not.toHaveBeenCalled();
    });
  });
});
