import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

import OrderActionButtons from '@/components/admin/OrderActionButtons';

const noop = () => {};

describe('OrderActionButtons - dispatched order (the delivery photo is optional)', () => {
  it('offers "mark as delivered" (not "upload proof") and calls onUploadDeliveryProof', () => {
    const onUploadDeliveryProof = vi.fn();
    render(
      <OrderActionButtons
        order={{ id: 'o1', order_number: 'ORD-1', status: 'dispatched', payment_status: 'validated' }}
        onView={noop}
        onStartProcessing={noop}
        onValidatePayment={noop}
        onRejectPayment={noop}
        onMarkAsDispatched={noop}
        onUploadDeliveryProof={onUploadDeliveryProof}
        onCompleteOrder={noop}
        onCancelOrder={noop}
        onRestockOrder={noop}
      />
    );
    expect(screen.queryByRole('button', { name: /adminOrders\.action\.uploadProof/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /adminOrders\.action\.markAsDelivered/ }));
    expect(onUploadDeliveryProof).toHaveBeenCalledTimes(1);
  });
});
