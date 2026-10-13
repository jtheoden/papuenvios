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

const recipient = {
  fullName: 'Ana Perez',
  phone: '+5355551234',
  province: 'La Habana',
  municipality: 'Plaza de la Revolucion',
  address: 'Calle 23 #100'
};

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
  order_items: []
};

const renderModal = (recipient_info) =>
  render(
    <OrderDetailsModal
      order={{ ...baseOrder, recipient_info }}
      onClose={() => {}}
      formatDate={(d) => String(d)}
      formatCurrency={(v) => String(v)}
    />
  );

describe('OrderDetailsModal recipient contact', () => {
  it('shows phone and municipality/province for a double-encoded recipient_info string', () => {
    renderModal(JSON.stringify(JSON.stringify(recipient)));
    expect(screen.getByText('+5355551234')).toBeInTheDocument();
    expect(screen.getByText('Plaza de la Revolucion')).toBeInTheDocument();
    expect(screen.getByText('La Habana')).toBeInTheDocument();
  });

  it('shows phone and location for a plain object recipient_info', () => {
    renderModal(recipient);
    expect(screen.getByText('+5355551234')).toBeInTheDocument();
    expect(screen.getByText('Plaza de la Revolucion')).toBeInTheDocument();
  });

  it('renders no recipient section and does not crash for null recipient_info', () => {
    renderModal(null);
    expect(screen.queryByText('+5355551234')).toBeNull();
    expect(screen.queryByText('adminOrders.detail.recipient')).toBeNull();
  });

  it('omits rows for missing phone/municipality/province instead of printing N/A', () => {
    renderModal({ fullName: 'Ana Perez' });
    expect(screen.getByText('Ana Perez')).toBeInTheDocument();
    expect(screen.queryByText('common.phone:')).toBeNull();
    expect(screen.queryByText('recipients.municipalityLabel:')).toBeNull();
    expect(screen.queryByText('recipients.provinceLabel:')).toBeNull();
  });

  it('uses an i18n key for the payment reference label that exists in both locales', () => {
    renderModal(recipient);
    expect(screen.queryByText('remittances.paymentReferenceLabel')).toBeNull();
    const label = screen.getByText('remittances.admin.paymentReferenceLabel');
    expect(label).toBeInTheDocument();
    expect(screen.getByText('John Doe LLC')).toBeInTheDocument();
    expect(ES.remittances.admin.paymentReferenceLabel).toBeTruthy();
    expect(EN.remittances.admin.paymentReferenceLabel).toBeTruthy();
  });
});
