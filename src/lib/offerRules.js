// Schema (20241001000000_complete_schema.sql): offers.discount_type CHECK IN ('percentage','fixed_amount'),
// window columns are start_date / end_date (timestamptz). There is no valid_until column.

const LEGACY_TYPES = { fixed: 'fixed_amount' };
const VALID_TYPES = ['percentage', 'fixed_amount'];

/** Maps legacy/unknown discount types to the schema value; null when not recognised. */
export const normalizeDiscountType = (type) => {
  const mapped = LEGACY_TYPES[type] ?? type;
  return VALID_TYPES.includes(mapped) ? mapped : null;
};

/** True when `now` is within [start_date, end_date]; a null/missing bound is open-ended. */
export const isOfferInWindow = (offer, now = new Date()) => {
  if (!offer) return false;
  const t = now.getTime();
  if (offer.start_date && t < new Date(offer.start_date).getTime()) return false;
  if (offer.end_date && t > new Date(offer.end_date).getTime()) return false;
  return true;
};
