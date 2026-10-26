/**
 * Customer side of the commission acceptance: notice, accept, decline, informed decrease, blocked proof upload and
 * silent degradation while the backend objects do not exist yet.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The refund section/block imports refundService, which imports the Supabase client (needs env vars): stub it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const row = (status, extra = {}) => ({
  id: 'r1',
  remittance_number: 'REM-1',
  status,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-02T10:00:00Z',
  amount_sent: 100,
  amount_to_deliver: 75200,
  exchange_rate: 800,
  commission_total: 6,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  recipient_name: 'Maria',
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer', exchange_rate: 800 },
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

const KEY = 'remittances.commissionChange';
const renderWith = async (status = 'payment_pending') => {
  svc.list = [row(status)];
  render(<MyRemittancesPage onNavigate={vi.fn()} />);
  await screen.findByText('REM-1');
};
const uploadButton = (status) =>
  screen.queryByRole('button', { name: status === 'payment_rejected' ? 'remittances.user.reUploadProof' : 'remittances.user.uploadProof' });

describe('MyRemittancesPage - commission change notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    prop.rows = [pendingProposal];
    prop.getOpenProposals.mockImplementation(async () => prop.rows);
    prop.acceptCommission.mockResolvedValue({ id: 'p1', status: 'accepted' });
    svc.getMyRemittances.mockImplementation(async () => svc.list);
    svc.cancelRemittance.mockResolvedValue({});
    modal.showModal.mockResolvedValue(true);
  });

  it.each(['payment_pending', 'payment_rejected'])('shows the pending raise as a live status in %s and blocks the proof upload', async (status) => {
    await renderWith(status);
    const alert = await screen.findByRole('status');
    expect(alert).toHaveTextContent('2.50');
    expect(alert).toHaveTextContent('6.00');
    expect(uploadButton(status)).toBeDisabled();
  });

  it('asks for the proposals of the listed remittances with explicit ids', async () => {
    await renderWith();
    await screen.findByRole('status');
    expect(prop.getOpenProposals).toHaveBeenCalledWith(['r1']);
  });

  it('accept calls the RPC wrapper, reloads and confirms', async () => {
    await renderWith();
    await screen.findByRole('status');
    prop.rows = [];
    const before = svc.getMyRemittances.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.accept` }));
    await waitFor(() => expect(prop.acceptCommission).toHaveBeenCalledWith('r1', 'p1'));
    await waitFor(() => expect(svc.getMyRemittances.mock.calls.length).toBeGreaterThan(before));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.accepted` }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(uploadButton('payment_pending')).not.toBeDisabled();
  });

  it('a replaced proposal (proposal_not_open) shows the translated message and reloads the proposals', async () => {
    prop.acceptCommission.mockRejectedValue({ code: 'CONFLICT', context: { reason: 'proposal_not_open' }, message: 'raw' });
    await renderWith();
    await screen.findByRole('status');
    const calls = prop.getOpenProposals.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.accept` }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`${KEY}.errors.notOpen`));
    expect(screen.getByRole('status')).not.toHaveTextContent('raw');
    await waitFor(() => expect(prop.getOpenProposals.mock.calls.length).toBeGreaterThan(calls));
  });

  it('decline in payment_pending confirms with the no-payment message and cancels with reason commission_declined', async () => {
    await renderWith('payment_pending');
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.decline` }));
    await waitFor(() => expect(svc.cancelRemittance).toHaveBeenCalledWith('r1', 'commission_declined'));
    const config = modal.showModal.mock.calls[0][0];
    expect(config.message).toBe(`${KEY}.declinePendingMessage|REM-1`);
    expect(config.input).toBeFalsy();
  });

  it('decline in payment_rejected shows the refund notice (CancelRefundMessage) before cancelling', async () => {
    await renderWith('payment_rejected');
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.decline` }));
    await waitFor(() => expect(svc.cancelRemittance).toHaveBeenCalledWith('r1', 'commission_declined'));
    const body = render(<div>{modal.showModal.mock.calls[0][0].message}</div>).container;
    expect(body).toHaveTextContent('remittances.user.cancelProofWarning|5');
  });

  it('does not cancel when the confirmation is dismissed', async () => {
    modal.showModal.mockResolvedValue(false);
    await renderWith();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.decline` }));
    await waitFor(() => expect(modal.showModal).toHaveBeenCalled());
    expect(svc.cancelRemittance).not.toHaveBeenCalled();
  });

  it('an informed decrease is a dismissible status and does NOT block the upload', async () => {
    prop.rows = [informedProposal];
    svc.list = [row('payment_pending', { commission_total: 1 })];
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    await screen.findByText('REM-1');
    const status = await screen.findByRole('status');
    expect(within(status).queryByRole('button', { name: `${KEY}.accept` })).toBeNull();
    expect(uploadButton('payment_pending')).not.toBeDisabled();
    fireEvent.click(within(status).getByRole('button', { name: `${KEY}.dismiss` }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('degrades silently when the proposals backend does not exist yet: no notice, upload enabled, no error toast', async () => {
    prop.rows = [];
    await renderWith();
    await waitFor(() => expect(prop.getOpenProposals).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
    expect(uploadButton('payment_pending')).not.toBeDisabled();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('the disabled upload button explains why (title) and points at the notice (aria-describedby)', async () => {
    await renderWith('payment_pending');
    await screen.findByRole('status');
    const button = uploadButton('payment_pending');
    expect(button).toHaveAttribute('title', `${KEY}.uploadBlocked`);
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).not.toBeNull();
  });

  it('a stale decrease notice is hidden: 6 -> 1 informed, then 1 -> 8 raised and accepted', async () => {
    // live commission is 8 now; the only open row left is the old informed one (new_commission 1)
    prop.rows = [informedProposal];
    svc.list = [row('payment_pending', { commission_total: 8 })];
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    await screen.findByText('REM-1');
    await waitFor(() => expect(prop.getOpenProposals).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the decrease notice is shown while the live commission is the announced one', async () => {
    prop.rows = [informedProposal];
    svc.list = [row('payment_pending', { commission_total: 1 })];
    render(<MyRemittancesPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows no notice for remittances already past the payment step', async () => {
    await renderWith('payment_proof_uploaded');
    expect(prop.getOpenProposals).not.toHaveBeenCalled(); // nothing that can carry a proposal is listed
    expect(screen.queryByRole('status')).toBeNull();
  });
});
