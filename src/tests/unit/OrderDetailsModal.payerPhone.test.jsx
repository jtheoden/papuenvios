import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

vi.mock('@/lib/remittanceService', () => ({
  generateProofSignedUrl: vi.fn().mockResolvedValue({ success: false })
}));

import OrderDetailsModal from '@/components/admin/modals/OrderDetailsModal';

const baseOrder = {
  id: 'o1',
  order_number: 'ORD-1',
  created_at: '2026-01-01T00:00:00Z',
  order_type: 'product',
  payment_status: 'pending',
  status: 'pending',
  payment_method: 'zelle',
  payment_reference: 'John Doe LLC',
  total_amount: 10,
  order_items: [],
  recipient_info: null
};

const renderModal = (extra) =>
  render(
    <OrderDetailsModal
      order={{ ...baseOrder, ...extra }}
      onClose={() => {}}
      formatDate={(d) => String(d)}
      formatCurrency={(v) => String(v)}
    />
  );

describe('OrderDetailsModal payer phone', () => {
  it('shows the payer phone with its label when present', () => {
    renderModal({ payer_phone: '+1 305 555 0100' });
    expect(screen.getByText('adminOrders.detail.payerPhone')).toBeInTheDocument();
    expect(screen.getByText('+1 305 555 0100')).toBeInTheDocument();
  });

  it.each([[undefined], [null], ['']])('does not render the row when payer_phone is %j', (payer_phone) => {
    renderModal({ payer_phone });
    expect(screen.queryByText('adminOrders.detail.payerPhone')).toBeNull();
  });

  it('has the label key in both locales', () => {
    expect(ES.adminOrders.detail.payerPhone).toBeTruthy();
    expect(EN.adminOrders.detail.payerPhone).toBeTruthy();
  });
});
