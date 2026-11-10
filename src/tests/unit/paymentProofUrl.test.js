import { describe, it, expect } from 'vitest';
import { extractPaymentProofPath } from '@/lib/paymentProofUrl';

const PATH = 'payment-proofs/payment-proof-11111111-2222-3333-4444-555555555555-1700000000000.png';
const BASE = 'https://abc.supabase.co/storage/v1/object';

describe('extractPaymentProofPath', () => {
  it('extracts the path from a legacy public URL', () => {
    expect(extractPaymentProofPath(`${BASE}/public/order-documents/${PATH}`)).toBe(PATH);
  });

  it('extracts the path from a signed URL without the query string', () => {
    expect(extractPaymentProofPath(`${BASE}/sign/order-documents/${PATH}?token=abc.def`)).toBe(PATH);
  });

  it('drops a query string or fragment on a public URL', () => {
    expect(extractPaymentProofPath(`${BASE}/public/order-documents/${PATH}?t=1#x`)).toBe(PATH);
  });

  it('returns a raw payment-proofs path unchanged', () => {
    expect(extractPaymentProofPath(PATH)).toBe(PATH);
  });

  it.each([[null], [undefined], [''], ['   '], [42], [{}]])('returns null for %j', (value) => {
    expect(extractPaymentProofPath(value)).toBeNull();
  });

  it('returns null for other buckets, foreign hosts and traversal', () => {
    expect(extractPaymentProofPath(`${BASE}/public/product-images/a.png`)).toBeNull();
    expect(extractPaymentProofPath('https://evil.test/a.png')).toBeNull();
    expect(extractPaymentProofPath('payment-proofs/../secret.png')).toBeNull();
    expect(extractPaymentProofPath('other/file.png')).toBeNull();
  });
});
