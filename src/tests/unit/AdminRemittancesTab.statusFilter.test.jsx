import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const REMITTANCES = [
  { id: '1', remittance_number: 'REM-PENDING', status: 'payment_pending', created_at: '2026-01-01T10:00:00Z' },
  { id: '2', remittance_number: 'REM-PROOF', status: 'payment_proof_uploaded', created_at: '2026-01-02T10:00:00Z' },
  { id: '3', remittance_number: 'REM-REJECTED', status: 'payment_rejected', created_at: '2026-01-03T10:00:00Z' },
  { id: '4', remittance_number: 'REM-DONE', status: 'completed', created_at: '2026-01-04T10:00:00Z', amount_sent: 10 },
];

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true, isSuperAdmin: false }),
}));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} }),
}));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => '' }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: () => {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ImageProofModal', () => ({ default: () => null }));
vi.mock('@/components/TooltipButton', () => ({ default: () => null }));
vi.mock('@/components/RecipientLocation', () => ({ default: () => null }));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittances: vi.fn(async () => REMITTANCES),
  validatePayment: vi.fn(),
  rejectPayment: vi.fn(),
  startProcessing: vi.fn(),
  confirmDelivery: vi.fn(),
  completeRemittance: vi.fn(),
  calculateDeliveryAlert: vi.fn(() => ({ level: 'ok' })),
  generateProofSignedUrl: vi.fn(),
  getRemittanceBankAccountDetails: vi.fn(),
  getBankAccountByRecipientId: vi.fn(),
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

const hasRow = (number) => screen.queryAllByText(number).length > 0;

describe('AdminRemittancesTab - status filter and counters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers a payment_pending option that filters to remittances awaiting payment', async () => {
    render(<AdminRemittancesTab />);
    await waitFor(() => expect(hasRow('REM-PENDING')).toBe(true));

    const option = screen.getByRole('option', { name: 'remittances.status.paymentPending' });
    expect(option).toHaveValue('payment_pending');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'payment_pending' } });

    await waitFor(() => expect(hasRow('REM-PROOF')).toBe(false));
    expect(hasRow('REM-PENDING')).toBe(true);
    expect(hasRow('REM-DONE')).toBe(false);
  });

  it('counts rejected payments in the rejected stat card', async () => {
    const { container } = render(<AdminRemittancesTab />);
    await waitFor(() => expect(hasRow('REM-REJECTED')).toBe(true));

    const label = [...container.querySelectorAll('span.uppercase')].find(
      (el) => el.textContent === 'remittances.status.paymentRejected'
    );
    expect(label).toBeTruthy();
    expect(label.closest('div.rounded-lg')).toHaveTextContent(/1$/);
  });
});
