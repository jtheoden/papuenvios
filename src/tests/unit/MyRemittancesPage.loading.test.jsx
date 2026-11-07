// Loading state of the customer remittances list (mocks shared with MyRemittancesPage.cancel.test.jsx).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The refund section/block imports refundService, which imports the Supabase client (needs env vars): stub it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { render, screen, act } from '@testing-library/react';

const row = (status) => ({
  id: 'r1',
  remittance_number: 'REM-1',
  status,
  created_at: '2026-01-01T10:00:00Z',
  amount_sent: 50,
  amount_to_deliver: 40000,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  recipient_name: 'Maria',
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer', exchange_rate: 800 },
});

const lang = vi.hoisted(() => ({ t: (key, params) => (params?.days ? `${key}|${params.days}` : key), language: 'en' }));
const auth = vi.hoisted(() => ({ user: { id: 'u1' }, isAdmin: false, isSuperAdmin: false }));
const business = vi.hoisted(() => ({ notificationSettings: {}, visualSettings: {} }));
const modal = vi.hoisted(() => ({ showModal: vi.fn() }));
const svc = vi.hoisted(() => ({ list: [], cancelRemittance: vi.fn(), getMyRemittances: vi.fn() }));
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
vi.mock('@/lib/commissionProposalService', () => ({ getOpenProposals: vi.fn(async () => []), acceptCommission: vi.fn() }));
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
import { useRealtimeRemittances } from '@/hooks/useRealtimeSubscription';

const pending = () => {
  let resolve;
  let reject;
  svc.getMyRemittances.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { resolve: (v) => act(async () => { resolve(v); }), reject: (e) => act(async () => { reject(e); }) };
};
const busy = () => screen.queryAllByRole('status').find(el => el.getAttribute('aria-busy') === 'true');

describe('MyRemittancesPage loading state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the skeleton with a visible loading label and aria-busy, then the list', async () => {
    const load = pending();
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    expect(busy()).toBeTruthy();
    expect(screen.queryByText('remittances.user.noRemittances')).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();

    await load.resolve([row('payment_pending')]);
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(busy()).toBeFalsy();
    expect(screen.getByText('REM-1')).toBeInTheDocument();
  });

  it('shows the empty state only after an empty load', async () => {
    const load = pending();
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    await load.resolve([]);
    expect(screen.getByText('remittances.user.noRemittances')).toBeInTheDocument();
  });

  it('drops the skeleton when the load fails', async () => {
    const load = pending();
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    await load.reject(new Error('boom'));
    expect(busy()).toBeFalsy();
  });
  // A reload with the list already on screen (realtime/after an action) must keep it visible: no skeleton.
  it('keeps the list visible and shows no skeleton while a realtime reload runs', async () => {
    const first = pending();
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    await first.resolve([row('payment_pending')]);
    expect(screen.getByText('REM-1')).toBeInTheDocument();

    const reload = pending();
    const { onUpdate } = useRealtimeRemittances.mock.calls.at(-1)[0];
    act(() => { onUpdate({ eventType: 'INSERT', new: {} }); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('REM-1')).toBeInTheDocument();
    expect(busy()).toBeFalsy();
    await reload.resolve([row('payment_pending')]);
  });
});
