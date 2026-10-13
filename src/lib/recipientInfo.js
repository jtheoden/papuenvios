const MAX_DECODE_PASSES = 3;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Normalizes `orders.recipient_info`, which may be stored as an object, a JSON
 * string, or a double-encoded JSON string (string containing a JSON string).
 * Never throws; anything that does not decode to a plain object yields `{}`.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export const parseRecipientInfo = (value) => {
  let current = value;
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
    if (isPlainObject(current)) return current;
    if (typeof current !== 'string' || current.trim() === '') return {};
    try {
      current = JSON.parse(current);
    } catch {
      return {};
    }
  }
  return {};
};

/**
 * Builds the "municipality, province" display string, skipping blank parts.
 *
 * @param {string|null|undefined} municipality
 * @param {string|null|undefined} province
 * @returns {string}
 */
export const formatRecipientLocation = (municipality, province) =>
  [municipality, province]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(', ');

/**
 * Address the user actually selected for a recipient. Falls back to the first
 * address when no id is given or the id is not in the list.
 *
 * @param {Array<{ id: string }>|null|undefined} addresses
 * @param {string|null|undefined} addressId
 * @returns {object|undefined}
 */
export const pickRecipientAddress = (addresses, addressId) => {
  if (!Array.isArray(addresses) || addresses.length === 0) return undefined;
  return addresses.find((address) => address.id === addressId) || addresses[0];
};
