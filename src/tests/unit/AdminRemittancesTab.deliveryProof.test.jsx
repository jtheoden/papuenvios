/**
 * W6a: confirming a remittance delivery never requires a photo; the dialog offers it as optional.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
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
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: true, isSuperAdmin: false }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
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
  confirmDelivery: vi.fn(async () => ({})),
  completeRemittance: vi.fn(),
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
import { confirmDelivery, getAllRemittances } from '@/lib/remittanceService';

const confirmButton = () => screen.findByRole('button', { name: 'remittances.admin.confirmDelivery' });

describe('AdminRemittancesTab - delivery without a mandatory photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    REMITTANCES = [row('1', 'processing')];
  });

  it('the Confirm delivery button is enabled with no delivery proof and no "required" toast', async () => {
    render(<AdminRemittancesTab />);
    const button = await confirmButton();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ description: 'remittances.admin.deliveryProofRequired' }));
  });

  it('confirms without a photo, with the typed notes, then reloads and closes the dialog', async () => {
    render(<AdminRemittancesTab />);
    fireEvent.click(await confirmButton());
    fireEvent.change(await screen.findByPlaceholderText('adminOrders.deliveryModal.notesPlaceholder'), { target: { value: 'handed to the sister' } });
    getAllRemittances.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'adminOrders.deliveryModal.submit' }));
    await waitFor(() => expect(confirmDelivery).toHaveBeenCalledWith('1', null, 'handed to the sister'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getAllRemittances).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'remittances.admin.deliveryConfirmedNoPhoto' }));
  });

  it('a delivered remittance without a photo shows the "no photo" badge in the detail only', async () => {
    REMITTANCES = [row('2', 'delivered')];
    render(<AdminRemittancesTab />);
    expect(screen.queryByText('remittances.admin.noDeliveryPhoto')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'remittances.admin.viewDetails' }));
    expect(await screen.findByText('remittances.admin.noDeliveryPhoto')).toBeTruthy();
  });
});
