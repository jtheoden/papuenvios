import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: vi.fn() } }
}));

import { notifyAdminNewPayment } from '@/lib/whatsappService';

const ADMIN_PHONE = '+1 555 123 4567';

const order = {
  id: 'ord-1',
  order_number: 'ORD-1',
  total_amount: 25,
  currency: { code: 'USD' },
  payment_method: 'zelle',
  payment_reference: 'John Doe',
  payer_phone: ' +1 305 555 0100 ',
  user_name: 'John',
  user_email: 'john@example.com',
  order_items: [
    { item_name_es: 'Arroz', quantity: 2 },
    { item_name_en: 'Beans', quantity: 1 }
  ],
  recipient_info: JSON.stringify({
    fullName: 'Ana',
    phone: '+5355551234',
    province: 'La Habana',
    municipality: 'Plaza',
    address: 'Calle 1'
  })
};

const link = () => `${window.location.origin}/dashboard?tab=orders&id=ord-1`;

const EXPECTED_ES = () =>
  `🆕 *Nueva Orden Registrada*\n\n` +
  `📋 *Orden:* ORD-1\n` +
  `👤 *Cliente:* John\n` +
  `📧 *Email:* john@example.com\n\n` +
  `📦 *Items:*\n   1. Arroz (x2)\n   2. Beans (x1)\n\n` +
  `💰 *Total:* 25 USD\n` +
  `💳 *Método de Pago:* zelle\n` +
  `📝 *Titular/Empresa:* John Doe\n` +
  `📞 *Teléfono del pagador:* +1 305 555 0100\n\n` +
  `📍 *Destinatario para Entrega*\n` +
  `┌─────────────────────\n` +
  `│ 👤 Ana\n` +
  `│ 📱 +5355551234\n` +
  `│ 📍 La Habana, Plaza\n` +
  `│ 🏠 Calle 1\n` +
  `└─────────────────────\n\n` +
  `🔗 *Ver en sistema:*\n${link()}\n\n` +
  `_Mensaje desde PapuEnvíos_`;

const EXPECTED_EN = () =>
  `🆕 *New Order Registered*\n\n` +
  `📋 *Order:* ORD-1\n` +
  `👤 *Customer:* John\n` +
  `📧 *Email:* john@example.com\n\n` +
  `📦 *Items:*\n   1. Arroz (x2)\n   2. Beans (x1)\n\n` +
  `💰 *Total:* 25 USD\n` +
  `💳 *Payment Method:* zelle\n` +
  `📝 *Payer Name/Company:* John Doe\n` +
  `📞 *Payer Phone:* +1 305 555 0100\n\n` +
  `📍 *Delivery Recipient*\n` +
  `┌─────────────────────\n` +
  `│ 👤 Ana\n` +
  `│ 📱 +5355551234\n` +
  `│ 📍 La Habana, Plaza\n` +
  `│ 🏠 Calle 1\n` +
  `└─────────────────────\n\n` +
  `🔗 *View in system:*\n${link()}\n\n` +
  `_Message from PapuEnvíos_`;

describe('notifyAdminNewPayment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('message content (must stay byte-identical)', () => {
    it.each([
      ['es', EXPECTED_ES],
      ['en', EXPECTED_EN]
    ])('opens WhatsApp with the exact %s message', (language, expected) => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      notifyAdminNewPayment(order, ADMIN_PHONE, language);

      expect(openSpy).toHaveBeenCalledTimes(1);
      const [rawUrl, target] = openSpy.mock.calls[0];
      expect(target).toBe('_blank');
      expect(rawUrl.startsWith('https://wa.me/15551234567?text=')).toBe(true);
      expect(new URL(rawUrl).searchParams.get('text')).toBe(expected());
    });
  });

  describe('result contract', () => {
    it('returns { opened: true } and opens the chat on success', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      expect(notifyAdminNewPayment(order, ADMIN_PHONE, 'es')).toEqual({ opened: true });
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it.each([[undefined], [null], [''], [12345]])(
      'returns no_recipient without opening or alerting when admin phone is %j',
      (phone) => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        expect(notifyAdminNewPayment(order, phone, 'es')).toEqual({
          opened: false,
          reason: 'no_recipient'
        });
        expect(openSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
      }
    );

    it('returns invalid_url without opening when the phone cannot be formatted', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      expect(notifyAdminNewPayment(order, '---', 'es')).toEqual({
        opened: false,
        reason: 'invalid_url'
      });
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns invalid_order without opening when the order is not an object', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      expect(notifyAdminNewPayment(null, ADMIN_PHONE, 'es')).toEqual({
        opened: false,
        reason: 'invalid_order'
      });
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});
