/**
 * Pure helpers for order payment proofs stored in the private `order-documents` bucket.
 * `orders.payment_proof_url` holds either a legacy public URL (rows created before the bucket
 * became private) or a raw storage path (`payment-proofs/...`, rows created afterwards).
 */
export const PAYMENT_PROOF_BUCKET = 'order-documents';
export const PAYMENT_PROOF_FOLDER = 'payment-proofs';

const URL_PATTERNS = [
  `/storage/v1/object/public/${PAYMENT_PROOF_BUCKET}/`,
  `/storage/v1/object/sign/${PAYMENT_PROOF_BUCKET}/`
];

/**
 * @param {unknown} value stored payment_proof_url (legacy public URL or raw path)
 * @returns {string|null} storage path inside the bucket, or null when the value is unusable
 */
export const extractPaymentProofPath = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let path = trimmed;
  const pattern = URL_PATTERNS.find((p) => trimmed.includes(p));
  if (pattern) path = trimmed.split(pattern)[1].split(/[?#]/)[0];

  if (!path.startsWith(`${PAYMENT_PROOF_FOLDER}/`) || path.split('/').includes('..')) return null;
  return path;
};
