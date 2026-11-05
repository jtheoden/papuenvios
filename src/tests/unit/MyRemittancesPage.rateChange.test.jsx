import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The refund section/block imports refundService, which imports the Supabase client (needs env vars): stub it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const row = (extra = {}) => ({
  id: 'r1',
  remittance_number: 'REM-1',
  status: 'payment_pending',
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-02T10:00:00Z',
  amount_sent: 100,
  amount_to_deliver: 90012.34,
  exchange_rate: 900.1234,
  commission_total: 3,
  discount_amount: 0,
  offer_id: null,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  recipient_name: 'Maria',
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer', exchange_rate: 915.5678, commission_percentage: 3, commission_fixed: 0 },
  ...extra,
});
const pendingProposal = { id: 'p1', remittance_id: 'r1', status: 'pending', direction: 'increase', baseline_commission: '2.50', new_commission: '6.00', created_at: '2026-01-02' };
const informedProposal = { id: 'p2', remittance_id: 'r1', status: 'informed', direction: 'decrease', baseline_commission: '2.50', new_commission: '1.00', created_at: '2026-01-02' };

const lang = vi.hoisted(() => ({
  t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key),
  language: 'en',
}));
const auth = vi.hoisted(() => ({ user: { id: 'u1' }, isAdmin: false, isSuperAdmin: false }));
const business = vi.hoisted(() => ({ notificationSettings: {}, visualSettings: {} }));
const modal = vi.hoisted(() => ({ showModal: vi.fn() }));
const svc = vi.hoisted(() => ({ list: [], cancelRemittance: vi.fn(), getMyRemittances: vi.fn() }));
const prop = vi.hoisted(() => ({ rows: [], getOpenProposals: vi.fn(), acceptCommission: vi.fn() }));
vi.mock('@/components/LegalContact', () => ({ default: () => <span data-testid="legal-contact" /> }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => lang }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => business }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => modal }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/use-toast', () => ({ toast }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshGuidedWhatsappPhone: vi.fn() }));
vi.mock('@/lib/whatsappService', () => ({
  ADMIN_NOTIFICATION_LANGUAGE: 'es',
  buildAdminNewPaymentProofWhatsAppUrl: vi.fn(),
  buildRemittanceNotificationPayload: vi.fn(),
  getAdminNotificationUrlBuilder: vi.fn(() => null),
  openAdminNotification: vi.fn(),
}));
vi.mock('@/lib/commissionProposalService', () => ({
  getOpenProposals: (...args) => prop.getOpenProposals(...args),
  acceptCommission: (...args) => prop.acceptCommission(...args),
}));
vi.mock('@/lib/remittanceService', () => ({
  getMyRemittances: (...args) => svc.getMyRemittances(...args),
  getRemittanceDetails: vi.fn(),
  uploadPaymentProof: vi.fn(),
  cancelRemittance: (...args) => svc.cancelRemittance(...args),
  calculateDeliveryAlert: vi.fn(() => ({ level: 'ok' })),
  generateProofSignedUrl: vi.fn(async () => ({ success: false })),
  recalculateRemittanceAtCurrentRate: vi.fn(),
  REMITTANCE_STATUS: {
    PAYMENT_PENDING: 'payment_pending',
    PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded',
    PAYMENT_VALIDATED: 'payment_validated',
    PAYMENT_REJECTED: 'payment_rejected',
    PROCESSING: 'processing',
    DELIVERED: 'delivered',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  },
}));

import MyRemittancesPage from '@/components/MyRemittancesPage';

const renderRow = async (extra) => {
  svc.list = [row(extra)];
  render(<MyRemittancesPage onNavigate={vi.fn()} />);
  await screen.findByText('REM-1');
};

describe('MyRemittancesPage - rate change alert (A7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    prop.rows = [];
    prop.getOpenProposals.mockImplementation(async () => []);
    svc.getMyRemittances.mockImplementation(async () => svc.list);
    modal.showModal.mockResolvedValue(true);
  });

  it('shows both rates with their real precision and the change, without promising a new amount', async () => {
    await renderRow();
    const alert = await screen.findByText(/remittances\.user\.rateChangedFrom/);
    expect(alert).toHaveTextContent('900.1234');
    expect(alert).toHaveTextContent('915.5678');
    expect(alert).toHaveTextContent('+1.72%');
    // the RPC may apply a commission override / offer the owner cannot see: no projected figure is shown
    expect(screen.queryByText(/remittances\.user\.newAmountWouldBe/)).toBeNull();
    expect(screen.getByRole('button', { name: /remittances\.user\.updateToNewRate/ })).toBeInTheDocument();
  });

  it('does not project an amount with an applied offer either', async () => {
    await renderRow({ offer_id: 'offer-1', discount_amount: 1 });
    expect(await screen.findByText(/remittances\.user\.rateChangedFrom/)).toBeInTheDocument();
    expect(screen.queryByText(/remittances\.user\.newAmountWouldBe/)).toBeNull();
  });

  it('shows no alert for a USD to USD remittance (rate 1 in SQL) even if the type carries another number', async () => {
    await renderRow({
      currency_delivered: 'USD',
      amount_to_deliver: 100,
      exchange_rate: 1,
      remittance_types: { name: 'USD-USD', delivery_method: 'cash', exchange_rate: 105, commission_percentage: 3, commission_fixed: 0, currency_code: 'USD', delivery_currency: 'USD' }
    });
    expect(screen.queryByText(/remittances\.user\.rateChangedFrom/)).toBeNull();
    expect(screen.queryByText(/remittances\.user\.rateChangedBannerTitle/)).toBeNull();
  });

  it('shows no alert and no NaN when the stored rate is missing', async () => {
    await renderRow({ exchange_rate: null });
    expect(screen.queryByText(/remittances\.user\.rateChangedFrom/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});
