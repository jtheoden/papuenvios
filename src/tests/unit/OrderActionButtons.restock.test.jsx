import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

import OrderActionButtons from '@/components/admin/OrderActionButtons';

const base = { id: 'o1', order_number: 'ORD-1', payment_status: 'validated' };
const noop = () => {};

const renderButtons = (order, extra = {}) =>
  render(
    <OrderActionButtons
      order={order}
      onView={noop}
      onStartProcessing={noop}
      onValidatePayment={noop}
      onRejectPayment={noop}
      onMarkAsDispatched={noop}
      onUploadDeliveryProof={noop}
      onCompleteOrder={noop}
      onCancelOrder={noop}
      onRestockOrder={noop}
      {...extra}
    />
  );

describe('OrderActionButtons - persistent "return to inventory" action', () => {
  it('shows it on a cancelled order that has consumed stock and calls onRestockOrder', () => {
    const onRestockOrder = vi.fn();
    renderButtons({ ...base, status: 'cancelled', has_consumed_stock: true }, { onRestockOrder });

    fireEvent.click(screen.getByRole('button', { name: /adminOrders\.action\.restock/ }));

    expect(onRestockOrder).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cancelled without consumed stock', { status: 'cancelled', has_consumed_stock: false }],
    ['cancelled, flag missing (unknown is not offered)', { status: 'cancelled' }],
    ['a live order even if it has consumed stock', { status: 'processing', has_consumed_stock: true }],
    ['a pending order', { status: 'pending', has_consumed_stock: true }]
  ])('does not show it for %s', (_label, patch) => {
    renderButtons({ ...base, ...patch });

    expect(screen.queryByRole('button', { name: /adminOrders\.action\.restock/ })).toBeNull();
  });
});
