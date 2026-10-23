/**
 * The customer can cancel a remittance until the payment is validated (payment_pending, payment_rejected,
 * payment_proof_uploaded). With a proof already uploaded the confirmation warns that cancelling does not refund.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

const WARNING = 'remittances.user.cancelProofWarning';
const bodyOf = () => render(<div>{modal.showModal.mock.calls[0][0].message}</div>).container;
const cancelButton = () => screen.queryByRole('button', { name: 'common.cancel' });
const renderWith = async (status) => {
  svc.list = [row(status)];
  render(<MyRemittancesPage onNavigate={vi.fn()} />);
  await screen.findByText('REM-1');
};

describe('MyRemittancesPage - customer cancels before the payment is validated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.getMyRemittances.mockImplementation(async () => svc.list);
    modal.showModal.mockResolvedValue('');
    svc.cancelRemittance.mockResolvedValue({});
  });

  it.each(['payment_pending', 'payment_rejected', 'payment_proof_uploaded'])('offers cancel in %s', async (status) => {
    await renderWith(status);
    expect(cancelButton()).toBeInTheDocument();
  });

  it.each(['payment_validated', 'processing', 'delivered', 'completed', 'cancelled'])('does not offer cancel in %s', async (status) => {
    await renderWith(status);
    expect(cancelButton()).not.toBeInTheDocument();
  });

  it('warns with the policy text (days from legalConfig), links to the Terms refunds section and shows the contact when the proof is uploaded', async () => {
    await renderWith('payment_proof_uploaded');
    fireEvent.click(cancelButton());
    await waitFor(() => expect(svc.cancelRemittance).toHaveBeenCalledWith('r1', ''));
    const body = bodyOf();
    expect(body).toHaveTextContent(`${WARNING}|5`);
    expect(body.querySelector('a[href="/terms#refunds"]')).not.toBeNull();
    expect(body.querySelector('[data-testid="legal-contact"]')).not.toBeNull();
  });

  it('shows no refund note in payment_rejected (normally no money was received)', async () => {
    await renderWith('payment_rejected');
    fireEvent.click(cancelButton());
    await waitFor(() => expect(svc.cancelRemittance).toHaveBeenCalled());
    expect(typeof modal.showModal.mock.calls[0][0].message).toBe('string');
  });

  it('shows no refund note in payment_pending (no money moved)', async () => {
    await renderWith('payment_pending');
    fireEvent.click(cancelButton());
    await waitFor(() => expect(svc.cancelRemittance).toHaveBeenCalled());
    expect(typeof modal.showModal.mock.calls[0][0].message).toBe('string');
  });

  it('builds the dialog from translation keys, not hardcoded Spanish', async () => {
    await renderWith('payment_pending');
    fireEvent.click(cancelButton());
    await waitFor(() => expect(modal.showModal).toHaveBeenCalled());
    const config = modal.showModal.mock.calls[0][0];
    expect(config.title).toBe('remittances.user.cancelRemittanceTitle');
    expect(config.message).toBe('remittances.user.cancelRemittanceMessage');
    expect(config.confirmText).toBe('remittances.user.cancelRemittance');
    expect(config.inputLabel).toBe('remittances.user.cancelReasonLabel');
    expect(config.inputPlaceholder).toBe('remittances.user.cancelReasonPlaceholder');
  });

  it('ignores a second click while the confirmation dialog is open', async () => {
    modal.showModal.mockReturnValue(new Promise(() => {}));
    await renderWith('payment_pending');
    fireEvent.click(cancelButton());
    fireEvent.click(cancelButton());
    expect(modal.showModal).toHaveBeenCalledTimes(1);
  });

  it('reloads the list and reports the error when someone else already moved the remittance (status conflict)', async () => {
    svc.cancelRemittance.mockRejectedValue({ code: 'CONFLICT', context: { reason: 'invalid_transition' }, message: 'x' });
    await renderWith('payment_pending');
    const before = svc.getMyRemittances.mock.calls.length;
    fireEvent.click(cancelButton());
    await waitFor(() => expect(svc.getMyRemittances.mock.calls.length).toBeGreaterThan(before));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
});
