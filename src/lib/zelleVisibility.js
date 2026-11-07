/**
 * Pure helpers for per-account Zelle contact visibility (email / phone).
 * Flags default to visible when missing so legacy rows keep their behavior.
 */

/** Map a form identifier to the existing database visibility flags. */
export const deriveZelleVisibility = (contactType = 'phone') => ({
  show_phone: contactType !== 'email',
  show_email: contactType !== 'phone'
});

/** Missing flags retain legacy visibility, including the both-visible edit mode. */
export const inferZelleContactType = ({ show_email, show_phone } = {}) => {
  if (show_phone !== false && show_email === false) return 'phone';
  if (show_email !== false && show_phone === false) return 'email';
  return 'both';
};

/** Require the visible contact(s); validate a hidden contact only when supplied. */
export const validateZelleContact = ({ contactType = 'phone', phone, email } = {}) => {
  const phoneValue = typeof phone === 'string' ? phone.trim() : '';
  const emailValue = typeof email === 'string' ? email.trim() : '';
  if (contactType !== 'email' && !phoneValue) return { valid: false, error: 'phoneRequired' };
  if (contactType !== 'phone' && !emailValue) return { valid: false, error: 'emailRequired' };
  if (phoneValue && (!/^[\d +()-]{7,30}$/.test(phoneValue) || !/\d/.test(phoneValue))) {
    return { valid: false, error: 'invalidPhone' };
  }
  if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
    return { valid: false, error: 'invalidEmail' };
  }
  return { valid: true };
};

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
