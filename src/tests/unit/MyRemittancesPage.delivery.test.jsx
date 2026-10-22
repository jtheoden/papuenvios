/**
 * W6a: the customer sees "Delivered on {date}" with or without a photo, and has no (broken) upload-evidence button.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const DELIVERED = {
  id: 'r1',
  remittance_number: 'REM-1',
  status: 'delivered',
  created_at: '2026-01-01T10:00:00Z',
  delivered_at: '2026-01-05T15:00:00Z',
  amount_sent: 50,
  amount_to_deliver: 40000,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  recipient_name: 'Maria',
  delivery_proof_url: null,
  remittance_types: { name: 'USD-CUP', delivery_method: 'transfer', exchange_rate: 800 },
};

// Stable references: the page has effects keyed on t / user, a fresh object per render would loop.
const lang = vi.hoisted(() => ({ t: (key, params) => (params?.date ? `${key}|${params.date}` : key), language: 'en' }));
const auth = vi.hoisted(() => ({ user: { id: 'u1' }, isAdmin: false, isSuperAdmin: false }));
const business = vi.hoisted(() => ({ notificationSettings: {}, visualSettings: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => lang }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => business }));
const modal = vi.hoisted(() => ({ showModal: () => {} }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => modal }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshGuidedWhatsappPhone: vi.fn() }));
vi.mock('@/lib/whatsappService', () => ({
  ADMIN_NOTIFICATION_LANGUAGE: 'es',
  buildAdminNewPaymentProofWhatsAppUrl: vi.fn(),
  buildRemittanceNotificationPayload: vi.fn(),
  getAdminNotificationUrlBuilder: vi.fn(),
  openAdminNotification: vi.fn(),
}));
vi.mock('@/lib/remittanceService', () => ({
  getMyRemittances: vi.fn(async () => [DELIVERED]),
  getRemittanceDetails: vi.fn(async () => DELIVERED),
  uploadPaymentProof: vi.fn(),
  cancelRemittance: vi.fn(),
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

const openDetail = async () => {
  render(<MyRemittancesPage onNavigate={vi.fn()} />);
  await screen.findByText('REM-1');
  fireEvent.click(screen.getAllByRole('button', { name: /remittances\.user\.viewDetails/ })[0]);
  await waitFor(() => expect(screen.getByText('remittances.user.deliveryEvidenceTitle')).toBeTruthy());
};

describe('MyRemittancesPage - delivered without a photo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows "delivered on {date}" instead of "evidence pending", with no upload prompt', async () => {
    await openDetail();
    expect(screen.getByText(/remittances\.user\.deliveredOn\|/)).toBeTruthy();
    expect(screen.queryByText('remittances.user.deliveryEvidencePending')).toBeNull();
    expect(screen.queryByText('remittances.user.uploadDeliveryProof')).toBeNull();
  });

  it('has no customer upload-evidence button', async () => {
    await openDetail();
    expect(screen.queryByText('remittances.user.uploadDeliveryProofButton')).toBeNull();
    expect(screen.queryByText('remittances.user.uploadDeliveryProofTitle')).toBeNull();
  });
});
