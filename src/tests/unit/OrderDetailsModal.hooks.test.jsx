import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

vi.mock('@/lib/remittanceService', () => ({
  generateProofSignedUrl: vi.fn().mockResolvedValue({ success: false })
}));

import OrderDetailsModal from '@/components/admin/modals/OrderDetailsModal';

const order = {
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

const modal = (props) => (
  <OrderDetailsModal
    onClose={() => {}}
    formatDate={(d) => String(d)}
    formatCurrency={(v) => String(v)}
    {...props}
  />
);

describe('OrderDetailsModal behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the dialog with the order number', () => {
    render(modal({ order }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText(/ORD-1/).length).toBeGreaterThan(0);
  });

  it('renders nothing when there is no order', () => {
    const { container } = render(modal({ order: null }));
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when Escape is pressed while an order is shown', () => {
    const onClose = vi.fn();
    render(modal({ order, onClose }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not react to Escape once the order is cleared', () => {
    const onClose = vi.fn();
    const { rerender } = render(modal({ order, onClose }));
    rerender(modal({ order: null, onClose }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('OrderDetailsModal hook order', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('survives null -> order -> null without a hook-order error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = render(modal({ order: null }));
    expect(container).toBeEmptyDOMElement();

    rerender(modal({ order }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText(/ORD-1/).length).toBeGreaterThan(0);

    rerender(modal({ order: null }));
    expect(container).toBeEmptyDOMElement();
  });
});
