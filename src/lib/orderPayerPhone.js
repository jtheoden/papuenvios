/**
 * Pre-submit gate for the order payment-proof flows (checkout and late uploads).
 * Pure so the ordering rule "validate before createOrder / before any upload"
 * can be unit tested without rendering the checkout.
 */

import { isValidPayerPhone } from '@/lib/payerPhone';

/**
 * First reason that blocks confirming a payment, or null when everything is present.
 * Priority: proof file, payer name/company, payer contact phone.
 *
 * @param {{ paymentProof?: unknown, paymentReference?: unknown, payerPhone?: unknown }} fields
 * @returns {'proof' | 'payer' | 'payerPhone' | null}
 */
export const getPaymentConfirmationBlocker = ({ paymentProof, paymentReference, payerPhone } = {}) => {
  if (!paymentProof) return 'proof';
  if (typeof paymentReference !== 'string' || paymentReference.trim() === '') return 'payer';
  if (!isValidPayerPhone(payerPhone)) return 'payerPhone';
  return null;
};
