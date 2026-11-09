// Classic must not pick up stored heading/button colours on the remittance pages (inline styles are brand-look only).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const business = vi.hoisted(() => ({ notificationSettings: {}, visualSettings: {} }));
const STORED = {
  useGradient: true, useHeadingGradient: true, useButtonGradient: true, gradientDirection: 45,
  primaryColor: '#113355', secondaryColor: '#7799bb', buttonBgColor: '#654321', buttonTextColor: '#ffeecc', headingColor: '#123456',
};

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => business }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'u@test.com' }, isAdmin: false, isSuperAdmin: false }) }));
vi.mock('@/contexts/LegalAcceptanceContext', () => ({ useLegalAcceptance: () => ({ ensureAccepted: vi.fn() }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: vi.fn() }));
vi.mock('@/hooks/usePaymentMethods', () => ({
  usePaymentMethods: () => ({ methods: [], loading: false, error: null, refresh: vi.fn(), isMethodEnabled: () => true, isFlowBlocked: () => false }),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/LegalContact', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountSelector', () => ({ default: () => null }));
vi.mock('@/components/RecipientSelector', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));
vi.mock('@/components/shared/AmountDisplayCard', () => ({ default: () => null }));
vi.mock('@/components/shared/PaymentProofForm', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/ui/InfoTooltip', () => ({ InfoTooltip: () => null }));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/shippingService', () => ({ getActiveShippingZones: vi.fn(async () => []) }));
vi.mock('@/lib/orderDiscountService', () => ({ validateRemittanceOffer: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshGuidedWhatsappPhone: vi.fn() }));
vi.mock('@/lib/commissionProposalService', () => ({ getOpenProposals: vi.fn(async () => []), acceptCommission: vi.fn() }));
vi.mock('@/lib/whatsappService', () => ({
  ADMIN_NOTIFICATION_LANGUAGE: 'es',
  buildAdminNewPaymentProofWhatsAppUrl: vi.fn(), buildAdminNewRemittanceWhatsAppUrl: vi.fn(),
  buildRemittanceNotificationPayload: vi.fn(), getAdminNotificationUrlBuilder: vi.fn(() => null), openAdminNotification: vi.fn(),
}));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return { AnimatePresence: ({ children }) => children, motion: new Proxy({}, { get: (_, tag) => React.forwardRef(function Motion({ initial, animate, transition, whileHover, whileTap, ...props }, ref) {
    return React.createElement(tag, { ...props, ref });
  }) }) };
});
vi.mock('@/lib/remittanceService', () => ({
  getActiveRemittanceTypes: vi.fn(async () => []),
  getMyRemittances: vi.fn(async () => []),
  getRemittanceExchangeRate: vi.fn(), calculateRemittance: vi.fn(), calculateReverseRemittance: vi.fn(),
  createRemittance: vi.fn(), uploadPaymentProof: vi.fn(), getRemittanceDetails: vi.fn(), cancelRemittance: vi.fn(),
  calculateDeliveryAlert: vi.fn(() => ({ level: 'ok' })), generateProofSignedUrl: vi.fn(async () => ({ success: false })),
  recalculateRemittanceAtCurrentRate: vi.fn(),
  REMITTANCE_STATUS: { PAYMENT_PENDING: 'payment_pending', PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded', PAYMENT_VALIDATED: 'payment_validated', PAYMENT_REJECTED: 'payment_rejected', PROCESSING: 'processing', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled' },
}));

import RemittancesPage from '@/components/RemittancesPage';
import SendRemittancePage from '@/components/SendRemittancePage';
import MyRemittancesPage from '@/components/MyRemittancesPage';

const pages = { RemittancesPage, SendRemittancePage, MyRemittancesPage };
const settle = (container) => waitFor(() => expect(container.querySelector('h1')).toBeTruthy());
afterEach(cleanup);

describe.each(Object.entries(pages))('%s theme-scoped inline styles', (name, Page) => {
  beforeEach(() => { business.visualSettings = {}; });

  it('classic with stored gradient/colours: heading and buttons carry no inline style', async () => {
    business.visualSettings = { ...STORED, activeTheme: 'classic' };
    const { container } = render(<Page onNavigate={vi.fn()} />);
    await settle(container);
    expect(container.querySelector('h1').getAttribute('style') || '').toBe('');
    expect(container.innerHTML).not.toMatch(/linear-gradient|101, 67, 33|#654321/i);
    // Without inline style the CTAs must still paint themselves: a transparent button must not pass.
    const ctas = [...container.querySelectorAll('button')].filter((b) => /(?<![\w:-])bg-theme-accent(?![\w-])/.test(b.className));
    expect(ctas.length).toBeGreaterThan(0);
    ctas.forEach((b) => expect(b.className).toMatch(/(?<![\w-])text-theme-on-accent(?![\w-])/));
  });

  it('brand look keeps the stored heading and button styles', async () => {
    business.visualSettings = { ...STORED, activeTheme: 'papuenvios' };
    const { container } = render(<Page onNavigate={vi.fn()} />);
    await settle(container);
    expect(container.querySelector('h1').getAttribute('style')).toMatch(/linear-gradient/);
    expect(container.innerHTML).toMatch(/background: linear-gradient\(45deg, rgb\(17, 51, 85\)/);
  });
});
