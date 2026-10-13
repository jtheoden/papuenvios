import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: vi.fn() } }
}));

import { buildRemittanceProofMessage } from '@/lib/whatsappService';

const baseRemittance = {
  id: 'rem-uuid-1',
  remittance_number: 'REM-2026-0001',
  amount_sent: 150,
  currency_sent: 'USD',
  amount_to_deliver: 54000,
  currency_delivered: 'CUP',
  recipient_name: 'Maria Perez',
  recipient_phone: '+5355551234',
  recipient_province: 'La Habana',
  recipient_municipality: 'Plaza',
  payment_reference: 'John Doe',
  user_email: 'john@example.com',
  remittance_types: { name: 'Cash delivery' }
};

describe('buildRemittanceProofMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is pure: never opens a window', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    buildRemittanceProofMessage(baseRemittance, { language: 'es', proofLink: 'https://x.test/p.png' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('includes id, number, amount with currency and recipient name', () => {
    const message = buildRemittanceProofMessage(baseRemittance);
    expect(message).toContain('REM-2026-0001');
    expect(message).toContain('rem-uuid-1');
    expect(message).toContain('150 USD');
    expect(message).toContain('Maria Perez');
  });

  it('includes the municipality, province line when present', () => {
    const message = buildRemittanceProofMessage(baseRemittance);
    expect(message).toContain('📍 Plaza, La Habana');
  });

  it('omits the location line when neither municipality nor province exist', () => {
    const message = buildRemittanceProofMessage({
      ...baseRemittance,
      recipient_province: null,
      recipient_municipality: undefined
    });
    expect(message).not.toContain('📍');
  });

  it('shows only the available part of the location', () => {
    const message = buildRemittanceProofMessage({ ...baseRemittance, recipient_municipality: null });
    expect(message).toContain('📍 La Habana');
    expect(message).not.toContain('📍 ,');
  });

  it('defaults to Spanish and supports English', () => {
    const es = buildRemittanceProofMessage(baseRemittance);
    const en = buildRemittanceProofMessage(baseRemittance, { language: 'en' });
    expect(es).toContain('NUEVO COMPROBANTE DE REMESA');
    expect(en).toContain('NEW REMITTANCE PAYMENT PROOF');
    expect(en).not.toContain('NUEVO COMPROBANTE');
  });

  it('falls back to Spanish for unknown languages', () => {
    expect(buildRemittanceProofMessage(baseRemittance, { language: 'fr' })).toContain('NUEVO COMPROBANTE');
  });

  it('uses the provided proof link and falls back to the system link', () => {
    const withLink = buildRemittanceProofMessage(baseRemittance, { proofLink: 'https://x.test/p.png' });
    expect(withLink).toContain('https://x.test/p.png');
    const without = buildRemittanceProofMessage(baseRemittance);
    expect(without).toContain('/dashboard?tab=remittances&id=rem-uuid-1');
  });
});
