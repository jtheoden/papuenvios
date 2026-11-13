/**
 * Only a super admin sees the "Readjust" action, on remittances in any status (the point is correcting what was
 * already made), never on an own remittance (the server refuses it). An ordinary admin never sees it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const auth = vi.hoisted(() => ({ isAdmin: true, isSuperAdmin: true, user: { id: 'admin-1' } }));
let REMITTANCES = [];

const row = (id, status, extra = {}) => ({
  id,
  user_id: 'u1',
  remittance_number: `REM-${status}`,
  status,
  created_at: '2026-01-01T10:00:00Z',
  amount_sent: 100,
  amount_to_deliver: 78000,
  exchange_rate: 800,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  recipient_name: 'Maria',
  commission_total: 2.5,
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer' },
  ...extra,
});

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
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
  adminCancelRemittance: vi.fn(),
  readjustRemittance: vi.fn(async () => ({})),
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

const BUTTON = 'remittances.admin.readjust.button';

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAdmin = true;
  auth.isSuperAdmin = true;
  REMITTANCES = [row('c1', 'completed')];
});

describe('AdminRemittancesTab - super admin readjustment', () => {
  it.each(['payment_pending', 'payment_validated', 'delivered', 'completed', 'cancelled'])(
    'a super admin can readjust a %s remittance',
    async (status) => {
      REMITTANCES = [row('x', status)];
      render(<AdminRemittancesTab />);
      expect(await screen.findByRole('button', { name: BUTTON })).toBeTruthy();
    }
  );

  it('an ordinary admin does not see it', async () => {
    auth.isSuperAdmin = false;
    render(<AdminRemittancesTab />);
    await screen.findByText('REM-completed');
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('a super admin does not see it on his own remittance', async () => {
    REMITTANCES = [row('own', 'completed', { user_id: 'admin-1' })];
    render(<AdminRemittancesTab />);
    await screen.findByText('REM-completed');
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('opens the readjustment dialog for that remittance', async () => {
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('REM-completed');
    expect(dialog.textContent).toContain('remittances.admin.readjust.modalTitle');
  });

  it('reloads nothing and closes the dialog after saving, showing the new values in the list', async () => {
    const { readjustRemittance } = await import('@/lib/remittanceService');
    readjustRemittance.mockResolvedValueOnce({ id: 'c1', status: 'cancelled' });
    render(<AdminRemittancesTab />);
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('remittances.admin.readjust.status'), { target: { value: 'cancelled' } });
    fireEvent.change(screen.getByLabelText('remittances.admin.readjust.reason'), {
      target: { value: 'Se cancela porque el cliente nunca pagó realmente' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'remittances.admin.readjust.confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
