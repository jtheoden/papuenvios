import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed.example/proof.png' },
          error: null
        })
      })
    }
  }
}));

vi.mock('@/lib/errorHandler', () => ({
  logError: vi.fn()
}));

import {
  buildAdminNewPaymentWhatsAppUrl,
  buildAdminNewPaymentProofWhatsAppUrl,
  buildAdminNewRemittanceWhatsAppUrl,
  notifyAdminNewPayment,
  notifyAdminNewPaymentProof
} from '@/lib/whatsappService';

const ADMIN_PHONE = '+1 (561) 601-1675';
const EXPECTED_PREFIX = 'https://wa.me/15616011675?text=';

const decodeText = (url) => decodeURIComponent(url.slice(EXPECTED_PREFIX.length));

const order = {
  id: 'order-uuid-1',
  order_number: 'ORD-2026-0001',
  total_amount: 120,
  payment_method: 'zelle',
  payment_reference: 'John Payer',
  user_name: 'John Doe',
  user_email: 'john@example.com',
  order_items: [{ item_name_es: 'Arroz', item_name_en: 'Rice', quantity: 2 }],
  recipient_info: { fullName: 'Maria', phone: '+53 555', province: 'La Habana', address: 'Calle 1' }
};

const remittance = {
  id: 'rem-uuid-1',
  remittance_number: 'REM-2026-0042',
  amount_sent: 100,
  currency_sent: 'USD',
  amount_to_deliver: 35000,
  currency_delivered: 'CUP',
  recipient_name: 'Pedro',
  recipient_phone: '+53 5555',
  recipient_province: 'Matanzas',
  payment_proof_url: 'user-1/rem-uuid-1/proof.png',
  payment_reference: 'Jane Payer',
  remittance_types: { name: 'Transfer' }
};

describe('whatsappService admin URL builders', () => {
  let openSpy;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildAdminNewPaymentWhatsAppUrl', () => {
    it('returns a wa.me URL for the formatted admin phone containing the order number', () => {
      const url = buildAdminNewPaymentWhatsAppUrl(order, ADMIN_PHONE, 'es');

      expect(url.startsWith(EXPECTED_PREFIX)).toBe(true);
      expect(decodeText(url)).toContain('ORD-2026-0001');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns empty string when admin phone is empty', () => {
      expect(buildAdminNewPaymentWhatsAppUrl(order, '', 'es')).toBe('');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns empty string when the recipient is a WhatsApp group URL (not a phone)', () => {
      expect(buildAdminNewPaymentWhatsAppUrl(order, 'https://chat.whatsapp.com/AbC123xyz', 'es')).toBe('');
    });

    it('returns empty string when order is null', () => {
      expect(buildAdminNewPaymentWhatsAppUrl(null, ADMIN_PHONE, 'es')).toBe('');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('buildAdminNewPaymentProofWhatsAppUrl', () => {
    it('resolves a wa.me URL containing the remittance number and the signed proof URL', async () => {
      const url = await buildAdminNewPaymentProofWhatsAppUrl(remittance, ADMIN_PHONE, 'es');

      expect(url.startsWith(EXPECTED_PREFIX)).toBe(true);
      const text = decodeText(url);
      expect(text).toContain('REM-2026-0042');
      expect(text).toContain('https://signed.example/proof.png');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('resolves empty string when admin phone is empty', async () => {
      await expect(buildAdminNewPaymentProofWhatsAppUrl(remittance, '', 'es')).resolves.toBe('');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('resolves empty string when the recipient is a WhatsApp group URL', async () => {
      await expect(buildAdminNewPaymentProofWhatsAppUrl(remittance, 'https://chat.whatsapp.com/AbC123xyz', 'es')).resolves.toBe('');
    });

    it('resolves empty string when remittance is missing', async () => {
      await expect(buildAdminNewPaymentProofWhatsAppUrl(null, ADMIN_PHONE, 'es')).resolves.toBe('');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('buildAdminNewRemittanceWhatsAppUrl', () => {
    const pendingRemittance = { ...remittance, payment_proof_url: null, payment_reference: null };

    it('returns a wa.me URL announcing the remittance with the proof pending (es)', () => {
      const url = buildAdminNewRemittanceWhatsAppUrl(pendingRemittance, ADMIN_PHONE, 'es');

      expect(url.startsWith(EXPECTED_PREFIX)).toBe(true);
      const text = decodeText(url);
      expect(text).toContain('REM-2026-0042');
      expect(text).toContain('Comprobante de pago: PENDIENTE (el cliente lo subirá después)');
      expect(text).toContain('/dashboard?tab=remittances&id=rem-uuid-1');
      expect(text).not.toContain('undefined');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('uses the english pending line when language is en', () => {
      const text = decodeText(buildAdminNewRemittanceWhatsAppUrl(pendingRemittance, ADMIN_PHONE, 'en'));

      expect(text).toContain('REM-2026-0042');
      expect(text).toContain('Payment proof: PENDING (the client will upload it later)');
      expect(text).not.toContain('undefined');
    });

    it('renders missing fields as N/A instead of undefined', () => {
      const text = decodeText(
        buildAdminNewRemittanceWhatsAppUrl({ id: 'rem-uuid-2', remittance_number: 'REM-2026-0043' }, ADMIN_PHONE, 'es')
      );

      expect(text).toContain('REM-2026-0043');
      expect(text).toContain('N/A');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    });

    it('renders N/A (not a bare currency) when the amount is missing but the currency is present', () => {
      const text = decodeText(
        buildAdminNewRemittanceWhatsAppUrl(
          { remittance_number: 'REM-2026-0044', currency_sent: 'USD', currency_delivered: 'CUP' },
          ADMIN_PHONE,
          'es'
        )
      );

      expect(text).toContain('Monto enviado: N/A\n');
      expect(text).toContain('Monto a entregar: N/A\n');
      expect(text).not.toContain('Monto enviado: USD');
      expect(text).not.toContain('Monto a entregar: CUP');
      expect(text).toContain('id=N/A');
      expect(text).not.toContain('undefined');
    });

    it('keeps 0 as a valid amount', () => {
      const text = decodeText(
        buildAdminNewRemittanceWhatsAppUrl(
          { ...pendingRemittance, amount_sent: 0, amount_to_deliver: 0 },
          ADMIN_PHONE,
          'es'
        )
      );

      expect(text).toContain('Monto enviado: 0 USD\n');
      expect(text).toContain('Monto a entregar: 0.00 CUP\n');
    });

    it('returns empty string when admin phone is empty or not a string', () => {
      expect(buildAdminNewRemittanceWhatsAppUrl(pendingRemittance, '', 'es')).toBe('');
      expect(buildAdminNewRemittanceWhatsAppUrl(pendingRemittance, undefined, 'es')).toBe('');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns empty string when the recipient is a WhatsApp group URL', () => {
      expect(buildAdminNewRemittanceWhatsAppUrl(pendingRemittance, 'https://chat.whatsapp.com/AbC123xyz', 'es')).toBe('');
    });

    it('returns empty string when remittance is null', () => {
      expect(buildAdminNewRemittanceWhatsAppUrl(null, ADMIN_PHONE, 'es')).toBe('');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('builders are side-effect free', () => {
    it('never call window.alert, even with invalid input', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      buildAdminNewPaymentWhatsAppUrl(order, ADMIN_PHONE, 'es');
      buildAdminNewPaymentWhatsAppUrl(null, '', 'es');
      await buildAdminNewPaymentProofWhatsAppUrl(remittance, ADMIN_PHONE, 'es');
      await buildAdminNewPaymentProofWhatsAppUrl(null, '', 'es');
      buildAdminNewRemittanceWhatsAppUrl(remittance, ADMIN_PHONE, 'es');
      buildAdminNewRemittanceWhatsAppUrl(null, '', 'es');
      buildAdminNewRemittanceWhatsAppUrl({}, 'https://chat.whatsapp.com/AbC123xyz', 'es');

      expect(alertSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('legacy notify wrappers', () => {
    it('notifyAdminNewPayment opens the same URL the builder produces', () => {
      notifyAdminNewPayment(order, ADMIN_PHONE, 'es');
      expect(openSpy).toHaveBeenCalledWith(buildAdminNewPaymentWhatsAppUrl(order, ADMIN_PHONE, 'es'), '_blank');
    });

    it('notifyAdminNewPayment does not open a blank tab when the URL cannot be built', () => {
      notifyAdminNewPayment(null, ADMIN_PHONE, 'es');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('notifyAdminNewPaymentProof does not open a blank tab when the URL cannot be built', async () => {
      await notifyAdminNewPaymentProof(null, ADMIN_PHONE, 'es');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});
