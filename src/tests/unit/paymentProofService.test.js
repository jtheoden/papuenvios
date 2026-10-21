import { describe, it, expect, vi, beforeEach } from 'vitest';

const signMock = vi.fn();
const fromMock = vi.fn(() => ({ createSignedUrl: (...a) => signMock(...a) }));
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: (...a) => fromMock(...a) } } }));
vi.mock('@/lib/errorHandler', () => ({
  parseSupabaseError: (e) => ({ message: e.message }),
  logError: vi.fn()
}));

import {
  getPaymentProofSignedUrl,
  validatePaymentProofFile,
  PAYMENT_PROOF_MIME_EXT
} from '@/lib/paymentProofService';

const PATH = 'payment-proofs/payment-proof-1-2.png';

beforeEach(() => vi.clearAllMocks());

describe('getPaymentProofSignedUrl', () => {
  it('signs the path extracted from a legacy public URL with a short expiry', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://s.test/x?token=1' }, error: null });
    const res = await getPaymentProofSignedUrl(`https://a.co/storage/v1/object/public/order-documents/${PATH}`);
    expect(fromMock).toHaveBeenCalledWith('order-documents');
    expect(signMock).toHaveBeenCalledWith(PATH, 300);
    expect(res).toEqual({ success: true, signedUrl: 'https://s.test/x?token=1' });
  });

  it('honours a custom expiry for a raw path', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'u' }, error: null });
    await getPaymentProofSignedUrl(PATH, 60);
    expect(signMock).toHaveBeenCalledWith(PATH, 60);
  });

  it('fails without calling storage for an unusable value', async () => {
    const res = await getPaymentProofSignedUrl('https://evil.test/a.png');
    expect(res.success).toBe(false);
    expect(signMock).not.toHaveBeenCalled();
  });

  it('returns an error result when storage rejects', async () => {
    signMock.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    const res = await getPaymentProofSignedUrl(PATH);
    expect(res).toEqual({ success: false, error: 'Object not found' });
  });
});

describe('validatePaymentProofFile', () => {
  const file = (type, size = 10) => ({ type, size, name: 'x' });

  it('accepts jpeg, png and webp within the limit', () => {
    ['image/jpeg', 'image/png', 'image/webp'].forEach((t) => expect(validatePaymentProofFile(file(t))).toBeNull());
  });

  it('rejects html, pdf, svg, gif and empty types', () => {
    ['text/html', 'application/pdf', 'image/svg+xml', 'image/gif', ''].forEach((t) =>
      expect(validatePaymentProofFile(file(t))).toMatch(/type/i));
  });

  it('rejects files over 5 MB and accepts exactly 5 MB', () => {
    expect(validatePaymentProofFile(file('image/png', 5 * 1024 * 1024 + 1))).toMatch(/size/i);
    expect(validatePaymentProofFile(file('image/png', 5 * 1024 * 1024))).toBeNull();
  });

  it('maps MIME types to extensions', () => {
    expect(PAYMENT_PROOF_MIME_EXT).toEqual({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
  });
});
