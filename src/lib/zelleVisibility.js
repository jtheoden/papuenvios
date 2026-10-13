/**
 * Pure helpers for per-account Zelle contact visibility (email / phone).
 * Flags default to visible when missing so legacy rows keep their behavior.
 */

/**
 * Admin-side guard: at least one of email/phone must be visible to customers.
 * Mirrors the DB CHECK (show_email OR show_phone).
 * @returns {{ valid: boolean, error?: 'atLeastOneVisible' }}
 */
export const validateZelleVisibility = ({ show_email, show_phone } = {}) => {
  const emailVisible = show_email !== false;
  const phoneVisible = show_phone !== false;
  if (!emailVisible && !phoneVisible) {
    return { valid: false, error: 'atLeastOneVisible' };
  }
  return { valid: true };
};

/**
 * Customer-facing contact data, honoring the visibility flags.
 * @returns {{ email: string|null, phone: string|null }}
 */
export const getZelleAccountPublicContact = (account) => {
  if (!account) return { email: null, phone: null };
  const email = account.show_email === false ? null : (account.email || account.zelle_email || null);
  const phone = account.show_phone === false ? null : (account.phone_number || account.phone || null);
  return { email, phone };
};
