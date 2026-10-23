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

const cardButtons = () => screen.queryAllByRole('button', { name: `${KEY}.adjustButton` });

describe('AdminRemittancesTab - commission adjustment from the list cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    OVERRIDE = null;
    getCommissionOverride.mockImplementation(async () => OVERRIDE);
    auth.isAdmin = true;
    auth.isSuperAdmin = false;
  });

  const roles = [
    ['admin', { isAdmin: true, isSuperAdmin: false }],
    ['super_admin', { isAdmin: false, isSuperAdmin: true }],
  ];

  describe.each(roles)('as %s', (_label, flags) => {
    beforeEach(() => Object.assign(auth, flags));

    it.each(['payment_pending', 'payment_rejected'])(
      'the card of a %s remittance has the adjust button, always-visible text and a 44px touch target',
      async (status) => {
        REMITTANCES = [row('1', status)];
        render(<AdminRemittancesTab />);
        await screen.findByRole('button', { name: 'remittances.admin.viewDetails' });
        const [button] = cardButtons();
        expect(button).toBeInTheDocument();
        expect(button.className).toContain('min-h-[44px]');
        expect(button).toHaveTextContent(`${KEY}.adjustButton`);
        expect(button.querySelector('.hidden')).toBeNull();
        expect(button.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      }
    );

    it.each(['payment_proof_uploaded', 'payment_validated', 'processing', 'delivered', 'completed', 'cancelled'])(
      'the card of a %s remittance has no adjust button',
      async (status) => {
        REMITTANCES = [row('1', status)];
        render(<AdminRemittancesTab />);
        await screen.findByRole('button', { name: 'remittances.admin.viewDetails' });
        expect(cardButtons()).toHaveLength(0);
      }
    );

    it('clicking it opens the modal with THAT card remittance', async () => {
      REMITTANCES = [row('1', 'payment_pending'), row('2', 'payment_rejected')];
      render(<AdminRemittancesTab />);
      await screen.findAllByRole('button', { name: 'remittances.admin.viewDetails' });
      const buttons = cardButtons();
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[1]);
      const dialog = await screen.findByRole('dialog', { name: `${KEY}.modalTitle` });
      expect(dialog).toHaveTextContent('REM-payment_rejected');
      expect(dialog).not.toHaveTextContent('REM-payment_pending');
      await waitFor(() => expect(getCommissionOverride).toHaveBeenCalledWith('2'));
    });
  });

  it('the detail button also meets the 44px touch target', async () => {
    REMITTANCES = [row('1', 'payment_pending')];
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'remittances.admin.viewDetails' }));
    await screen.findByText('remittances.admin.amountInfoTitle');
    const detailButton = cardButtons().find((b) => b.getAttribute('aria-describedby') === 'commission-adjust-help');
    expect(detailButton.className).toContain('min-h-[44px]');
  });

  const openFromCard = async () => {
    REMITTANCES = [row('1', 'payment_pending')];
    render(<AdminRemittancesTab />);
    await screen.findByRole('button', { name: 'remittances.admin.viewDetails' });
    fireEvent.click(cardButtons()[0]);
    return screen.findByRole('dialog', { name: `${KEY}.modalTitle` });
  };

  it('opened from a card it does not mount the detail underneath, nor leave it behind on Escape', async () => {
    const dialog = await openFromCard();
    expect(screen.queryByText('remittances.admin.amountInfoTitle')).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `${KEY}.modalTitle` })).not.toBeInTheDocument());
    expect(screen.queryByText('remittances.admin.amountInfoTitle')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'remittances.admin.viewDetails' })).toBeInTheDocument();
  });

  it('opened from the detail, closing the modal returns to the detail', async () => {
    REMITTANCES = [row('1', 'payment_pending')];
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'remittances.admin.viewDetails' }));
    await screen.findByText('remittances.admin.amountInfoTitle');
    fireEvent.click(cardButtons().find((b) => b.getAttribute('aria-describedby') === 'commission-adjust-help'));
    const dialog = await screen.findByRole('dialog', { name: `${KEY}.modalTitle` });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `${KEY}.modalTitle` })).not.toBeInTheDocument());
    expect(screen.getByText('remittances.admin.amountInfoTitle')).toBeInTheDocument();
  });

  it('keeps Save disabled while the previous override is still loading, then enables it', async () => {
    let resolveOverride;
    getCommissionOverride.mockImplementation(() => new Promise((resolve) => { resolveOverride = resolve; }));
    const dialog = await openFromCard();
    fireEvent.change(dialog.querySelector('#commission-override-value'), { target: { value: '1' } });
    fireEvent.change(dialog.querySelector('textarea'), { target: { value: 'A valid reason for the change' } });
    const save = screen.getByRole('button', { name: `${KEY}.confirm` });
    expect(save).toBeDisabled();
    resolveOverride(null);
    await waitFor(() => expect(save).not.toBeDisabled());
  });
});
