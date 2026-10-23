import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const KEY = 'remittances.admin.commissionOverride';
const auth = { isAdmin: true, isSuperAdmin: false };

const row = (id, status, extra = {}) => ({
  id,
  remittance_number: `REM-${status}`,
  status,
  created_at: '2026-01-01T10:00:00Z',
  amount_sent: 100,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  exchange_rate: 800,
  commission_total: 2.5,
  amount_to_deliver: 78000,
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer' },
  ...extra,
});

let REMITTANCES = [];
let OVERRIDE = null;
const getCommissionOverride = vi.fn(async () => OVERRIDE);

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: () => {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ImageProofModal', () => ({ default: () => null }));
vi.mock('@/components/RecipientLocation', () => ({ default: () => null }));
vi.mock('@/components/TooltipButton', () => ({
  default: ({ onClick, children, title }) => (
    <button type="button" onClick={onClick} aria-label={title}>{children}</button>
  ),
}));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittances: vi.fn(async () => REMITTANCES),
  validatePayment: vi.fn(),
  rejectPayment: vi.fn(),
  startProcessing: vi.fn(),
  confirmDelivery: vi.fn(),
  completeRemittance: vi.fn(),
  calculateDeliveryAlert: vi.fn(() => ({ level: 'ok' })),
  generateProofSignedUrl: vi.fn(async () => ({ success: false })),
  getRemittanceBankAccountDetails: vi.fn(),
  getBankAccountByRecipientId: vi.fn(),
  setRemittanceCommission: vi.fn(),
  getCommissionOverride: (...args) => getCommissionOverride(...args),
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

// The list card now has its own adjust button too: the detail one is the one wired to the help text
const detailAdjustButton = () =>
  screen.getAllByRole('button', { name: `${KEY}.adjustButton` }).find((b) => b.getAttribute('aria-describedby') === 'commission-adjust-help');

const openDetail = async () => {
  render(<AdminRemittancesTab />);
  const button = await screen.findByRole('button', { name: 'remittances.admin.viewDetails' });
  fireEvent.click(button);
  await screen.findByText('remittances.admin.amountInfoTitle');
};

describe('AdminRemittancesTab - commission adjustment entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    OVERRIDE = null;
    getCommissionOverride.mockImplementation(async () => OVERRIDE);
    auth.isAdmin = true;
    auth.isSuperAdmin = false;
  });

  it.each(['payment_pending', 'payment_rejected'])(
    'an admin sees the ENABLED adjust button for %s',
    async (status) => {
      REMITTANCES = [row('1', status)];
      await openDetail();
      const button = detailAdjustButton();
      expect(button).toBeInTheDocument();
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    }
  );

  it.each(['payment_proof_uploaded', 'payment_validated'])(
    'is DISABLED for %s with the "commission frozen after payment" reason',
    async (status) => {
      REMITTANCES = [row('1', status)];
      await openDetail();
      const button = detailAdjustButton();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(document.getElementById(button.getAttribute('aria-describedby'))).toHaveTextContent(`${KEY}.frozenAfterPayment`);
      fireEvent.click(button);
      expect(screen.queryByRole('dialog', { name: `${KEY}.modalTitle` })).not.toBeInTheDocument();
    }
  );

  it('a super_admin sees it too', async () => {
    auth.isAdmin = false;
    auth.isSuperAdmin = true;
    REMITTANCES = [row('1', 'payment_pending')];
    await openDetail();
    expect(detailAdjustButton()).toBeInTheDocument();
  });

  it.each(['processing', 'delivered', 'completed', 'cancelled'])(
    'is always visible to admins but DISABLED for %s, explained with the reason and the current status',
    async (status) => {
      REMITTANCES = [row('1', status)];
      await openDetail();
      const button = detailAdjustButton();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      const reason = document.getElementById(button.getAttribute('aria-describedby'));
      expect(reason).toHaveTextContent(`${KEY}.disabledReason`);
      expect(reason).toHaveTextContent(`remittances.status.`);
      fireEvent.click(button);
      expect(screen.queryByRole('dialog', { name: `${KEY}.modalTitle` })).not.toBeInTheDocument();
    }
  );

  it('a non-admin session never reaches the detail (the whole tab is gated), so no button either', async () => {
    auth.isAdmin = false;
    auth.isSuperAdmin = false;
    REMITTANCES = [row('1', 'payment_pending')];
    render(<AdminRemittancesTab />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'remittances.admin.viewDetails' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: `${KEY}.adjustButton` })).not.toBeInTheDocument();
  });

  it('opens the modal with the remittance data', async () => {
    REMITTANCES = [row('1', 'payment_pending')];
    await openDetail();
    fireEvent.click(detailAdjustButton());
    await waitFor(() => expect(screen.getByRole('dialog', { name: `${KEY}.modalTitle` })).toBeInTheDocument());
  });

  it('shows the adjustment note with the reason read from the admin-only overrides table', async () => {
    REMITTANCES = [row('1', 'payment_pending', { commission_total: 5 })];
    OVERRIDE = { commission: 5, standard_commission: 2.5, reason: 'Cliente frecuente, acuerdo comercial' };
    await openDetail();
    expect(await screen.findByText(/Cliente frecuente, acuerdo comercial/)).toBeInTheDocument();
    expect(getCommissionOverride).toHaveBeenCalledWith('1');
  });

  it('shows no note when the remittance was never adjusted', async () => {
    REMITTANCES = [row('1', 'payment_pending')];
    await openDetail();
    await waitFor(() => expect(getCommissionOverride).toHaveBeenCalled());
    expect(screen.queryByText(`${KEY}.adjustedNote`)).not.toBeInTheDocument();
  });

  it('keeps the detail usable when the override cannot be read', async () => {
    REMITTANCES = [row('1', 'payment_pending')];
    getCommissionOverride.mockRejectedValueOnce(new Error('permission denied'));
    await openDetail();
    await waitFor(() => expect(getCommissionOverride).toHaveBeenCalled());
    expect(detailAdjustButton()).toBeInTheDocument();
  });

  it('never reads the override reason from the remittance row', async () => {
    REMITTANCES = [row('1', 'payment_pending', { commission_override_reason: 'LEAK from the row, must not render' })];
    await openDetail();
    await waitFor(() => expect(getCommissionOverride).toHaveBeenCalled());
    expect(screen.queryByText(/LEAK from the row/)).not.toBeInTheDocument();
  });
});
