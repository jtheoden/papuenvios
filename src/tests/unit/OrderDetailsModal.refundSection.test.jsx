import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/paymentProofService', () => ({ getPaymentProofSignedUrl: vi.fn().mockResolvedValue({ success: false }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/lib/orderComboService', () => ({ fetchComboDefinitions: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/remittanceService', () => ({ generateProofSignedUrl: vi.fn().mockResolvedValue({ success: false }) }));
vi.mock('@/components/refunds/OperationRefundSection', () => ({
  default: ({ kind, operationId }) => <div data-testid="refund-section">{`${kind}:${operationId}`}</div>
}));

import OrderDetailsModal from '@/components/admin/modals/OrderDetailsModal';

describe('OrderDetailsModal: refund section', () => {
  it('mounts the read-only refund section for the order', () => {
    render(
      <OrderDetailsModal
        order={{ id: 'o9', order_number: 'ORD-9', created_at: '2026-01-01T00:00:00Z', order_type: 'product', payment_status: 'pending', status: 'pending', payment_method: 'zelle', total_amount: 1, order_items: [], recipient_info: null }}
        onClose={() => {}}
        formatDate={String}
        formatCurrency={String}
      />
    );
    expect(screen.getByTestId('refund-section')).toHaveTextContent('order:o9');
  });
});
