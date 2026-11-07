/**
 * An admin can cancel a remittance still in payment_pending (no payment proof), with a required reason.
 * No other status offers the action (the server enforces the same matrix in remittance_admin_cancel).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const showModal = vi.hoisted(() => vi.fn());
let REMITTANCES = [];

const row = (id, status, extra = {}) => ({
  id,
  user_id: 'u1',
  remittance_number: `REM-${status}`,
  status,
  created_at: '2026-01-01T10:00:00Z',
  amount_sent: 100,
  amount_to_deliver: 78000,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  recipient_name: 'Maria',
  commission_total: 2.5,
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer' },
  ...extra,
});

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: true, isSuperAdmin: false, user: { id: 'admin-1' } }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: () => {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/components/ui/use-toast', () => ({ toast }));
vi.mock('@/components/ImageProofModal', () => ({ default: () => null }));
vi.mock('@/components/RecipientLocation', () => ({ default: () => null }));
vi.mock('@/components/TooltipButton', () => ({
  default: ({ onClick, children, title, disabled }) => (
    <button type="button" onClick={onClick} aria-label={title} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittances: vi.fn(async () => REMITTANCES),
  validatePayment: vi.fn(),
  rejectPayment: vi.fn(),
  startProcessing: vi.fn(),
  confirmDelivery: vi.fn(),
  completeRemittance: vi.fn(),
  adminCancelRemittance: vi.fn(async () => ({})),
  calculateDeliveryAlert: vi.fn(() => ({ level: 'ok' })),
  generateProofSignedUrl: vi.fn(async () => ({ success: false })),
  getRemittanceBankAccountDetails: vi.fn(),
  getBankAccountByRecipientId: vi.fn(),
  setRemittanceCommission: vi.fn(),
  getCommissionOverride: vi.fn(async () => null),
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

import AdminRemittancesTab from '@/components/AdminRemittancesTab';
import { adminCancelRemittance, getAllRemittances } from '@/lib/remittanceService';

const CANCEL = 'remittances.admin.cancelRemittance';

describe('AdminRemittancesTab - admin cancel of a pending remittance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    REMITTANCES = [row('p1', 'payment_pending')];
  });

  it('cancels a payment_pending remittance with the typed reason and reloads', async () => {
    showModal.mockResolvedValue('never paid');
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: CANCEL }));
    await waitFor(() => expect(adminCancelRemittance).toHaveBeenCalledWith('p1', 'never paid'));
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({
      input: true, required: true, type: 'danger', maxLength: 500,
      inputLabel: 'remittances.admin.cancelReason', message: 'remittances.admin.confirmCancelMessage'
    }));
    await waitFor(() => expect(getAllRemittances).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'remittances.admin.remittanceCancelled' }));
  });

  it('does nothing when the reason modal is dismissed', async () => {
    showModal.mockResolvedValue(false);
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: CANCEL }));
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    expect(adminCancelRemittance).not.toHaveBeenCalled();
  });

  it('a raw server error is never shown as is', async () => {
    showModal.mockResolvedValue('never paid');
    adminCancelRemittance.mockRejectedValueOnce(new Error('boom'));
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: CANCEL }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'remittances.admin.cancelFailed' }))
    );
  });

  it('a refused cancel (status changed meanwhile) shows the readable message and reloads the list', async () => {
    showModal.mockResolvedValue('never paid');
    adminCancelRemittance.mockRejectedValueOnce(
      Object.assign(new Error('Remittance p1 changed state'), { code: 'CONFLICT', context: { reason: 'invalid_transition' } })
    );
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: CANCEL }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'common.statusConflict' }))
    );
    await waitFor(() => expect(getAllRemittances).toHaveBeenCalledTimes(2));
  });

  it.each(['payment_proof_uploaded', 'payment_validated', 'payment_rejected', 'processing', 'delivered', 'completed', 'cancelled'])(
    'does not offer cancel in %s',
    async (status) => {
      REMITTANCES = [row('x', status)];
      render(<AdminRemittancesTab />);
      await waitFor(() => expect(getAllRemittances).toHaveBeenCalled());
      await screen.findAllByText(`REM-${status}`);
      expect(screen.queryByRole('button', { name: CANCEL })).toBeNull();
    }
  );
});
