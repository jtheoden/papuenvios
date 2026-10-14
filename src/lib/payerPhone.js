/**
 * Payer contact phone helpers (shared by the remittance proof UI and service).
 * Deliberately loose: no E.164 and no forced leading '+'; the digit-count rule
 * lives in isValidPhoneNumber, this module only adds trimming and the column limit.
 */

import { isValidPhoneNumber } from '@/lib/whatsappService';

/** Max length of the remittances.payer_phone column (varchar(30)). */
export const PAYER_PHONE_MAX_LENGTH = 30;

/**
 * Trim a raw phone input. Non-strings become an empty string.
 * @param {unknown} raw
 * @returns {string}
 */
export const normalizePayerPhone = (raw) => (typeof raw === 'string' ? raw.trim() : '');

/**
 * Whether the payer phone is acceptable to store and show to the admin.
 * @param {unknown} raw
 * @returns {boolean}
 */
export const isValidPayerPhone = (raw) => {
  const phone = normalizePayerPhone(raw);
  return phone.length > 0 && phone.length <= PAYER_PHONE_MAX_LENGTH && isValidPhoneNumber(phone);
};
