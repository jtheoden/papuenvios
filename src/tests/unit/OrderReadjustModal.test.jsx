import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const readjustOrder = vi.fn();

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key), language: 'es' })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toast(...args) }));
vi.mock('@/lib/orderService', () => ({ readjustOrder: (...args) => readjustOrder(...args) }));

import OrderReadjustModal from '@/components/admin/OrderReadjustModal';

const KEY = 'adminOrders.readjust';
const REASON = 'La tasa vigente estaba mal al momento de la venta';

const order = (over = {}) => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'cancelled',
  payment_status: 'validated',
  subtotal: 248,
  discount_amount: 0,
  shipping_cost: 0,
  tax_amount: 0,
  total_amount: 248,
  order_items: [{ id: 'i1', item_name_es: 'Balita de Gas', item_name_en: 'Gas cylinder', quantity: 2, unit_price: 124 }],
  ...over
});

const setup = (o = order()) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<OrderReadjustModal order={o} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
};

const field = (name) => screen.getByLabelText(`${KEY}.${name}`);
const linePrice = () => screen.getByLabelText(`${KEY}.linePrice|Balita de Gas`);
const confirmButton = () => screen.getByRole('button', { name: `${KEY}.confirm` });

beforeEach(() => {
  vi.clearAllMocks();
  readjustOrder.mockResolvedValue({ id: 'o1' });
});

describe('OrderReadjustModal', () => {
  it('shows the current values, one price input per line and the status lists', () => {
    setup();
    expect(linePrice().value).toBe('124');
    expect(field('status').value).toBe('cancelled');
    expect(field('status').querySelectorAll('option')).toHaveLength(6);
    expect(field('paymentStatus').value).toBe('validated');
    expect(field('paymentStatus').querySelectorAll('option')).toHaveLength(4);
  });

  it('always shows the limits of the readjustment as a visible note', () => {
    setup();
    expect(screen.getAllByRole('note')[0].textContent).toContain(`${KEY}.limits`);
  });

  it('previews the new total and the difference with what was paid: 2 x 118.21 = 236.42, -11.58', () => {
    setup();
    fireEvent.change(linePrice(), { target: { value: '118.21' } });
    const preview = screen.getByTestId('order-readjust-preview').textContent;
    expect(preview).toContain('236.42');
    expect(preview).toContain('-11.58');
  });

  it('explains that reopening a cancelled order closes its refund and discounts the stock', () => {
    setup();
    expect(screen.queryByTestId('order-readjust-reopen')).toBeNull();
    fireEvent.change(field('status'), { target: { value: 'processing' } });
    expect(screen.getByTestId('order-readjust-reopen').textContent).toContain(`${KEY}.reopenNote`);
  });

  it('keeps confirm disabled until something changes and the reason is long enough', () => {
    setup();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(linePrice(), { target: { value: '118.21' } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(field('reason'), { target: { value: REASON } });
    expect(confirmButton().disabled).toBe(false);
  });

  it('sends only the changed values with the reason and reports the saved row', async () => {
    const { onSaved } = setup();
    fireEvent.change(linePrice(), { target: { value: '118.21' } });
    fireEvent.change(field('status'), { target: { value: 'processing' } });
    fireEvent.change(field('reason'), { target: { value: REASON } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(readjustOrder).toHaveBeenCalledTimes(1));
    expect(readjustOrder).toHaveBeenCalledWith('o1', { items: [{ id: 'i1', unitPrice: 118.21 }], status: 'processing' }, REASON);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'o1' }));
  });

  it('shows the server refusal and stays open', async () => {
    readjustOrder.mockRejectedValueOnce(new Error('stock_refused: insufficient_stock'));
    const { onSaved } = setup();
    fireEvent.change(field('status'), { target: { value: 'processing' } });
    fireEvent.change(field('reason'), { target: { value: REASON } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(onSaved).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(false);
  });
});
