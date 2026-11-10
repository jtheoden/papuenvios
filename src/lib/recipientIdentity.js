/**
 * Recipient identity rules. Must stay in sync with the SQL expressions of the unique index
 * recipients_user_name_phone_uniq (migration 20261026100000) and the merge script.
 *   name  = lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))
 *   phone = regexp_replace(phone, '\D', '', 'g')
 * A family may share a phone, so the identity is user + name + phone, never user + phone.
 */

const MIN_PHONE_DIGITS = 6;

export const normalizeRecipientName = (name) =>
  String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const normalizeRecipientPhone = (phone) => String(phone ?? '').replace(/\D/g, '');

export const isSameRecipient = (a, b) =>
  normalizeRecipientName(a?.full_name) === normalizeRecipientName(b?.full_name) &&
  normalizeRecipientPhone(a?.phone) === normalizeRecipientPhone(b?.phone);

/** First recipient of the list whose phone has the same digits, or null (too-short phones never match). */
export const findSamePhone = (recipients = [], phone) => {
  const digits = normalizeRecipientPhone(phone);
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return recipients.find((r) => normalizeRecipientPhone(r.phone) === digits) || null;
};

const addressDetail = (recipient) => {
  const addresses = recipient?.addresses || [];
  const address = addresses.find((a) => a.is_default && a.municipality) || addresses.find((a) => a.municipality);
  return address?.municipality || '';
};

const bankDetail = (recipient) => {
  const link = (recipient?.bank_links || []).find((l) => l.is_active !== false && l.bank_account);
  if (!link) return '';
  const { bank, account_number_last4: last4 } = link.bank_account;
  return [bank?.name, last4 && `****${last4}`].filter(Boolean).join(' ');
};

/** Short text that tells homonyms apart: municipality for cash, bank + last 4 digits otherwise. */
export const describeRecipient = (recipient, deliveryMethod = 'cash') => {
  const [primary, secondary] =
    deliveryMethod === 'cash' ? [addressDetail, bankDetail] : [bankDetail, addressDetail];
  return primary(recipient) || secondary(recipient);
};

const addressKey = (a) =>
  [a?.province, a?.municipality, a?.address_line_1]
    .map((v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase())
    .join('|');

/** Stored address with the same province, municipality and street (normalized), or null. Same rule as the merge script. */
export const findEquivalentAddress = (addresses, typed) =>
  (addresses || []).find((a) => addressKey(a) === addressKey(typed)) || null;
