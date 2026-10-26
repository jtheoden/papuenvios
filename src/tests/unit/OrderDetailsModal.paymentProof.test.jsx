import { describe, it, expect, vi, beforeEach } from 'vitest';

// The refund section/block imports refundService, which imports the Supabase client (needs env vars): stub it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { render, screen, waitFor } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/lib/orderComboService', () => ({ fetchComboDefinitions: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/remittanceService', () => ({
  generateProofSignedUrl: vi.fn().mockResolvedValue({ success: false })
}));

const signMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/paymentProofService', () => ({
  getPaymentProofSignedUrl: (...a) => signMock(...a)
}));

import OrderDetailsModal from '@/components/admin/modals/OrderDetailsModal';

const LEGACY = 'https://x.supabase.co/storage/v1/object/public/order-documents/payment-proofs/p-1.png';

const renderModal = (extra) =>
  render(
    <OrderDetailsModal
      order={{
        id: 'o1',
        order_number: 'ORD-1',
        created_at: '2026-01-01T00:00:00Z',
        order_type: 'product',
        payment_status: 'proof_uploaded',
        status: 'pending',
        payment_method: 'zelle',
        total_amount: 10,
        order_items: [],
        recipient_info: null,
        ...extra
      }}
      onClose={() => {}}
      formatDate={(d) => String(d)}
      formatCurrency={(v) => String(v)}
    />
  );

beforeEach(() => signMock.mockReset());

describe('OrderDetailsModal payment proof', () => {
  it('renders the signed URL, never the stored value', async () => {
    signMock.mockResolvedValue({ success: true, signedUrl: 'https://signed.test/p?token=1' });
    renderModal({ payment_proof_url: LEGACY });
    const img = await screen.findByAltText('adminOrders.detail.paymentProof');
    expect(img).toHaveAttribute('src', 'https://signed.test/p?token=1');
    expect(signMock).toHaveBeenCalledWith(LEGACY);
    expect(screen.getByText(/adminOrders.detail.viewFullSize/).closest('a')).toHaveAttribute(
      'href',
      'https://signed.test/p?token=1'
    );
  });

  it('shows a visible error and does not crash when signing fails', async () => {
    signMock.mockResolvedValue({ success: false, error: 'Object not found' });
    renderModal({ payment_proof_url: LEGACY });
    expect(await screen.findByRole('alert')).toHaveTextContent('adminOrders.detail.paymentProofError');
    expect(screen.queryByAltText('adminOrders.detail.paymentProof')).toBeNull();
    expect(screen.getAllByText('ORD-1', { exact: false }).length).toBeGreaterThan(0);
  });

  it('does not request a signature when there is no proof', async () => {
    renderModal({ payment_proof_url: null });
    await waitFor(() => expect(screen.getByText('adminOrders.detail.noPaymentProof')).toBeInTheDocument());
    expect(signMock).not.toHaveBeenCalled();
  });

  it('has the error label in both locales', () => {
    expect(ES.adminOrders.detail.paymentProofError).toBeTruthy();
    expect(EN.adminOrders.detail.paymentProofError).toBeTruthy();
  });
});
