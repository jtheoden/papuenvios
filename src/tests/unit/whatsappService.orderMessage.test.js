import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: vi.fn() } }
}));

import { notifyAdminNewPayment } from '@/lib/whatsappService';

const baseOrder = {
  id: 'ord-1',
  order_number: 'ORD-1',
  total_amount: 25,
  payment_method: 'zelle',
  payment_reference: 'John Doe',
  user_name: 'John',
  user_email: 'john@example.com',
  order_items: [{ item_name_es: 'Arroz', quantity: 2 }],
  recipient_info: { fullName: 'Ana', phone: '+5355551234', province: 'La Habana' }
};

const sentMessage = (order, language) => {
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  notifyAdminNewPayment(order, '+15551234567', language);
  const url = new URL(openSpy.mock.calls[0][0]);
  return url.searchParams.get('text');
};

describe('notifyAdminNewPayment payer phone line', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes the payer phone line in Spanish when present', () => {
    const message = sentMessage({ ...baseOrder, payer_phone: '  +1 305 555 0100 ' }, 'es');
    expect(message).toContain('📞 *Teléfono del pagador:* +1 305 555 0100');
  });

  it('includes the payer phone line in English when present', () => {
    const message = sentMessage({ ...baseOrder, payer_phone: '+1 305 555 0100' }, 'en');
    expect(message).toContain('📞 *Payer Phone:* +1 305 555 0100');
  });

  it.each([[undefined], [null], ['   ']])('omits the payer phone line when value is %j', (payer_phone) => {
    const es = sentMessage({ ...baseOrder, payer_phone }, 'es');
    expect(es).not.toContain('📞');
    expect(es).not.toContain('Teléfono del pagador');
    const en = sentMessage({ ...baseOrder, payer_phone }, 'en');
    expect(en).not.toContain('Payer Phone');
  });
});
