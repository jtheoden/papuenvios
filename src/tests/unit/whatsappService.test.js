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
  buildRemittanceNotificationPayload,
  openAdminNotification,
  getAdminNotificationUrlBuilder,
  ADMIN_NOTIFICATION_TIMEOUT_MS
} from '@/lib/whatsappService';
import * as whatsappService from '@/lib/whatsappService';

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

  describe('buildRemittanceNotificationPayload', () => {
    it('adds user_email and user_name from a full user', () => {
      const user = { email: 'jane@example.com', user_metadata: { full_name: 'Jane Roe', name: 'jane' } };
      const payload = buildRemittanceNotificationPayload(remittance, user);

      expect(payload).toEqual({ ...remittance, user_email: 'jane@example.com', user_name: 'Jane Roe' });
      expect(payload).not.toBe(remittance);
    });

    it('falls back to metadata name, then to the email local part', () => {
      expect(
        buildRemittanceNotificationPayload(remittance, { email: 'jane@example.com', user_metadata: { name: 'jane' } }).user_name
      ).toBe('jane');
      expect(buildRemittanceNotificationPayload(remittance, { email: 'jane.roe@example.com' }).user_name).toBe('jane.roe');
    });

    it('tolerates a null user', () => {
      const payload = buildRemittanceNotificationPayload(remittance, null);

      expect(payload.remittance_number).toBe('REM-2026-0042');
      expect(payload.user_email).toBeUndefined();
      expect(payload.user_name).toBeUndefined();
    });

    it('feeds the proof URL with the reference and amounts of the uploaded row', async () => {
      const uploadedRow = {
        ...remittance,
        status: 'payment_proof_uploaded',
        payment_reference: 'Row Payer LLC',
        amount_sent: 250,
        amount_to_deliver: 87500
      };
      const payload = buildRemittanceNotificationPayload(uploadedRow, { email: 'jane@example.com' });
      const text = decodeText(await buildAdminNewPaymentProofWhatsAppUrl(payload, ADMIN_PHONE, 'es'));

      expect(text).toContain('Titular/Empresa: Row Payer LLC');
      expect(text).toContain('Monto enviado: 250 USD');
      expect(text).toContain('Monto a entregar: 87500.00 CUP');
      expect(text).toContain('https://signed.example/proof.png');
      expect(text).toContain('jane@example.com');
    });
  });

  const URL_BUILT = `${EXPECTED_PREFIX}hola`;
  const APP_URL = 'https://app.example/';
  const makeWindow = (tab) => ({ open: vi.fn(() => tab), location: { href: APP_URL } });
  const makeTab = () => ({ close: vi.fn(), location: { href: 'about:blank' } });

  describe('openAdminNotification', () => {
    it('opens a blank tab synchronously before awaiting, then navigates it to the built URL', async () => {
      const tab = makeTab();
      const windowRef = makeWindow(tab);
      const resolvePhone = vi.fn().mockResolvedValue(ADMIN_PHONE);
      const buildUrl = vi.fn().mockResolvedValue(URL_BUILT);

      const pending = openAdminNotification({ buildUrl, resolvePhone, windowRef });

      expect(windowRef.open).toHaveBeenCalledWith('', '_blank');
      expect(windowRef.open.mock.invocationCallOrder[0]).toBeLessThan(resolvePhone.mock.invocationCallOrder[0]);
      expect(tab.location.href).toBe('about:blank');

      await expect(pending).resolves.toEqual({ opened: true });
      expect(buildUrl).toHaveBeenCalledWith(ADMIN_PHONE);
      expect(tab.location.href).toBe(URL_BUILT);
      expect(tab.close).not.toHaveBeenCalled();
      expect(windowRef.location.href).toBe(APP_URL);
    });

    it('closes the tab and reports not opened when the phone is empty', async () => {
      const tab = makeTab();
      const buildUrl = vi.fn();

      const result = await openAdminNotification({
        buildUrl,
        resolvePhone: vi.fn().mockResolvedValue(''),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: false });
      expect(buildUrl).not.toHaveBeenCalled();
      expect(tab.close).toHaveBeenCalledTimes(1);
    });

    it('closes the tab and reports not opened when the URL is empty', async () => {
      const tab = makeTab();

      const result = await openAdminNotification({
        buildUrl: vi.fn().mockReturnValue(''),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: false });
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe('about:blank');
    });

    it('closes the tab and reports an error when resolving the phone rejects', async () => {
      const tab = makeTab();

      const result = await openAdminNotification({
        buildUrl: vi.fn(),
        resolvePhone: vi.fn().mockRejectedValue(new Error('network')),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: false, error: true });
      expect(tab.close).toHaveBeenCalledTimes(1);
    });

    it('closes the tab and reports an error when building the URL throws synchronously', async () => {
      const tab = makeTab();

      const result = await openAdminNotification({
        buildUrl: vi.fn(() => { throw new Error('boom'); }),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: false, error: true });
      expect(tab.close).toHaveBeenCalledTimes(1);
    });

    it('exposes a 10 second default timeout', () => {
      expect(ADMIN_NOTIFICATION_TIMEOUT_MS).toBe(10000);
    });

    it('closes the tab and reports an error when the lookup exceeds the timeout', async () => {
      const tab = makeTab();
      const buildUrl = vi.fn();

      const result = await openAdminNotification({
        buildUrl,
        resolvePhone: () => new Promise(() => {}),
        windowRef: makeWindow(tab),
        timeoutMs: 5
      });

      expect(result).toEqual({ opened: false, error: true });
      expect(buildUrl).not.toHaveBeenCalled();
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe('about:blank');
    });

    it('hands the URL back as blocked when the user closed the tab during the lookup', async () => {
      const tab = { ...makeTab(), closed: true };

      const result = await openAdminNotification({
        buildUrl: vi.fn().mockResolvedValue(URL_BUILT),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: false, blocked: true, url: URL_BUILT, phone: ADMIN_PHONE });
      expect(tab.location.href).toBe('about:blank');
    });

    it('clears tab.opener before navigating', async () => {
      const seen = [];
      const tab = { close: vi.fn(), closed: false, opener: {} };
      tab.location = {
        set href(value) { seen.push({ value, opener: tab.opener }); }
      };

      const result = await openAdminNotification({
        buildUrl: vi.fn().mockResolvedValue(URL_BUILT),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: true });
      expect(seen).toEqual([{ value: URL_BUILT, opener: null }]);
    });

    it('closes the tab and reports an error when navigating the tab throws', async () => {
      const tab = { close: vi.fn(), closed: false };
      tab.location = {
        set href(value) { throw new Error(`cannot navigate to ${value}`); }
      };

      const result = await openAdminNotification({
        buildUrl: vi.fn().mockResolvedValue(URL_BUILT),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef: makeWindow(tab)
      });

      expect(result).toEqual({ opened: false, error: true });
      expect(tab.close).toHaveBeenCalledTimes(1);
    });

    it('does not reject even when closing the tab throws', async () => {
      const tab = { close: vi.fn(() => { throw new Error('close denied'); }), location: { href: 'about:blank' } };

      await expect(openAdminNotification({
        buildUrl: vi.fn(),
        resolvePhone: vi.fn().mockResolvedValue(''),
        windowRef: makeWindow(tab)
      })).resolves.toEqual({ opened: false });
    });
  });

  describe('getAdminNotificationUrlBuilder', () => {
    it('returns the pending-remittance builder for payment_pending', async () => {
      const row = { ...remittance, status: 'payment_pending', payment_proof_url: null };
      const builder = getAdminNotificationUrlBuilder(row);

      const url = await builder(row, ADMIN_PHONE, 'es');
      expect(url).toBe(buildAdminNewRemittanceWhatsAppUrl(row, ADMIN_PHONE, 'es'));
      expect(decodeText(url)).toContain('Comprobante de pago: PENDIENTE');
    });

    it('returns the payment-proof builder for payment_proof_uploaded', async () => {
      const row = { ...remittance, status: 'payment_proof_uploaded' };
      const builder = getAdminNotificationUrlBuilder(row);

      const text = decodeText(await builder(row, ADMIN_PHONE, 'es'));
      expect(text).toContain('NUEVO COMPROBANTE DE REMESA');
      expect(text).toContain('https://signed.example/proof.png');
    });

    it('returns null for any other status or a missing remittance', () => {
      ['payment_validated', 'payment_rejected', 'processing', 'delivered', 'completed', 'cancelled', undefined].forEach((status) => {
        expect(getAdminNotificationUrlBuilder({ ...remittance, status })).toBeNull();
      });
      expect(getAdminNotificationUrlBuilder(null)).toBeNull();
      expect(getAdminNotificationUrlBuilder(undefined)).toBeNull();
    });
  });

  describe('buildAdminNewPaymentProofWhatsAppUrl amount formatting', () => {
    it('formats a string numeric amount_to_deliver without throwing', async () => {
      const text = decodeText(
        await buildAdminNewPaymentProofWhatsAppUrl({ ...remittance, amount_to_deliver: '87500.5' }, ADMIN_PHONE, 'es')
      );

      expect(text).toContain('Monto a entregar: 87500.50 CUP');
    });

    it('renders N/A when amount_to_deliver is missing', async () => {
      const text = decodeText(
        await buildAdminNewPaymentProofWhatsAppUrl({ ...remittance, amount_to_deliver: null }, ADMIN_PHONE, 'en')
      );

      expect(text).toContain('Amount to Deliver: N/A CUP');
    });
  });

  describe('openAdminNotification with a blocked popup', () => {
    it('never throws when the popup is blocked and hands the URL back without navigating the app', async () => {
      const windowRef = makeWindow(null);

      const result = await openAdminNotification({
        buildUrl: vi.fn().mockResolvedValue(URL_BUILT),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef
      });

      expect(result).toEqual({ opened: false, blocked: true, url: URL_BUILT, phone: ADMIN_PHONE });
      expect(windowRef.location.href).toBe(APP_URL);
    });

    it('reports plain not opened when the popup is blocked and there is no phone', async () => {
      const result = await openAdminNotification({
        buildUrl: vi.fn(),
        resolvePhone: vi.fn().mockResolvedValue(''),
        windowRef: makeWindow(null)
      });

      expect(result).toEqual({ opened: false });
    });

    it('treats a throwing window.open as a blocked popup', async () => {
      const windowRef = {
        open: vi.fn(() => { throw new Error('denied'); }),
        location: { href: APP_URL }
      };

      const result = await openAdminNotification({
        buildUrl: vi.fn().mockResolvedValue(URL_BUILT),
        resolvePhone: vi.fn().mockResolvedValue(ADMIN_PHONE),
        windowRef
      });

      expect(result).toEqual({ opened: false, blocked: true, url: URL_BUILT, phone: ADMIN_PHONE });
    });
  });

  describe('legacy auto-open notifiers', () => {
    it('are no longer exported', () => {
      expect('notifyAdminNewPayment' in whatsappService).toBe(false);
      expect('notifyAdminNewPaymentProof' in whatsappService).toBe(false);
    });

    it('keeps the manual chat helpers', () => {
      expect(typeof whatsappService.openWhatsAppChat).toBe('function');
      expect(typeof whatsappService.generateWhatsAppURL).toBe('function');
    });
  });
});
