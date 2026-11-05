import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const REMITTANCES = [
  { id: '1', remittance_number: 'REM-PENDING', status: 'payment_pending', created_at: '2026-01-01T10:00:00Z' },
  { id: '2', remittance_number: 'REM-PROOF', status: 'payment_proof_uploaded', created_at: '2026-01-02T10:00:00Z' },
  { id: '3', remittance_number: 'REM-REJECTED', status: 'payment_rejected', created_at: '2026-01-03T10:00:00Z' },
  { id: '4', remittance_number: 'REM-DONE', status: 'completed', created_at: '2026-01-04T10:00:00Z', amount_sent: 10 },
  { id: '5', remittance_number: 'REM-DELIVERED', status: 'delivered', created_at: '2026-01-05T10:00:00Z', amount_sent: 5 },
];

const loader = vi.hoisted(() => ({ getAllRemittances: vi.fn() }));

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
  getAllRemittances: (...a) => loader.getAllRemittances(...a),
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

const pending = () => {
  let resolve;
  let reject;
  loader.getAllRemittances.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { resolve: (v) => act(async () => { resolve(v); }), reject: (e) => act(async () => { reject(e); }) };
};

describe('AdminRemittancesTab loading state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a busy skeleton with the label while remittances load, then the list', async () => {
    const load = pending();
    render(<AdminRemittancesTab />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('remittances.user.noRemittances')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();

    await load.resolve(REMITTANCES);
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryAllByText('REM-PENDING').length).toBeGreaterThan(0);
  });

  it('shows the empty state only after an empty load', async () => {
    const load = pending();
    render(<AdminRemittancesTab />);
    await load.resolve([]);
    expect(screen.getByText('remittances.user.noRemittances')).toBeInTheDocument();
  });

  it('drops the skeleton when the load fails', async () => {
    const load = pending();
    render(<AdminRemittancesTab />);
    await load.reject(new Error('boom'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
