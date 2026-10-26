/**
 * Separation of duties (supabase/migrations/20261101100000..200). The database refuses an admin who tries to validate,
 * process, deliver or adjust the commission of HIS OWN order/remittance; this only lets the UI say so beforehand.
 * Missing data degrades to "not own" so the buttons stay as they were and the server answers.
 */

/** True when `record.user_id` is the signed-in user. */
export const isOwnOperation = (record, userId) => Boolean(userId && record?.user_id && record.user_id === userId);

/** Server reasons (42501) that mean "an admin acted on his own operation". */
export const SELF_DEALING_REASONS = ['admin_self_dealing_not_allowed', 'commission_self_adjust_not_allowed'];

export const isSelfDealingMessage = (message) => SELF_DEALING_REASONS.some((reason) => String(message ?? '').includes(reason));
