import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

import OrderActionButtons from '@/components/admin/OrderActionButtons';

const noop = () => {};
const handlers = () => ({
  onView: noop, onStartProcessing: vi.fn(), onValidatePayment: vi.fn(), onRejectPayment: vi.fn(),
  onMarkAsDispatched: vi.fn(), onUploadDeliveryProof: vi.fn(), onCompleteOrder: vi.fn(), onCancelOrder: vi.fn(), onRestockOrder: noop
});
const base = { id: 'o1', order_number: 'ORD-1' };

describe('OrderActionButtons - own operation (admin is the customer)', () => {
  it('disables validate / reject with the reason and shows the badge', () => {
    const h = handlers();
    render(<OrderActionButtons order={{ ...base, status: 'pending', payment_status: 'proof_uploaded' }} ownOperation {...h} />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('common.ownOperation');
    expect(note.textContent).toContain('common.ownOperationReason');
    for (const name of [/adminOrders\.action\.validatePayment/, /adminOrders\.action\.rejectPayment/]) {
      const button = screen.getByRole('button', { name });
      expect(button.disabled).toBe(true);
      // visible reason referenced by aria-describedby (a title alone is not accessible)
      expect(document.getElementById(button.getAttribute('aria-describedby'))).toBe(note);
      fireEvent.click(button);
    }
    expect(h.onValidatePayment).not.toHaveBeenCalled();
    expect(h.onRejectPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['validated', 'pending', /adminOrders\.action\.startProcessing/],
    ['validated', 'processing', /adminOrders\.action\.markAsDispatched/],
    ['validated', 'dispatched', /adminOrders\.action\.markAsDelivered/],
    ['validated', 'delivered', /adminOrders\.action\.completeOrder/]
  ])('disables the primary action (%s / %s)', (payment_status, status, name) => {
    render(<OrderActionButtons order={{ ...base, status, payment_status }} ownOperation {...handlers()} />);
    expect(screen.getByRole('button', { name }).disabled).toBe(true);
  });

  it('cancel stays enabled only where a customer could cancel (pending, payment not validated)', () => {
    const { unmount } = render(<OrderActionButtons order={{ ...base, status: 'pending', payment_status: 'pending' }} ownOperation {...handlers()} />);
    expect(screen.getByRole('button', { name: /common\.cancel/ }).disabled).toBe(false);
    unmount();
    render(<OrderActionButtons order={{ ...base, status: 'processing', payment_status: 'validated' }} ownOperation {...handlers()} />);
    expect(screen.getByRole('button', { name: /common\.cancel/ }).disabled).toBe(true);
  });

  it('without the prop nothing changes (degrades): buttons enabled, no badge', () => {
    render(<OrderActionButtons order={{ ...base, status: 'pending', payment_status: 'proof_uploaded' }} {...handlers()} />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: /adminOrders\.action\.validatePayment/ }).disabled).toBe(false);
  });
});
