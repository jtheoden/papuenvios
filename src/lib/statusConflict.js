/**
 * Pure helpers for the "someone else already moved it" outcome of a status-transition RPC. Kept apart from
 * statusTransition.js (which needs the Supabase client) so components can import them without side effects.
 */
import { ERROR_CODES } from './errorHandler';

/** True when the RPC refused because the row is no longer in a state that allows the action. */
export const isStatusConflictError = (error) =>
  error?.code === ERROR_CODES.CONFLICT && error?.context?.reason === 'invalid_transition';

const FORBIDDEN_REASON_KEYS = {
  not_authorized: 'common.statusNotAuthorized',
  user_disabled: 'common.statusUserDisabled'
};

const knownKey = (error) => {
  if (isStatusConflictError(error)) return 'common.statusConflict';
  return error?.code === ERROR_CODES.FORBIDDEN ? FORBIDDEN_REASON_KEYS[error?.context?.reason] ?? null : null;
};

/**
 * Translation key for the toast of a failed transition: the dedicated message when the row moved under the user
 * (conflict) or the RPC refused the caller (not_authorized / user_disabled), otherwise the caller's fallback.
 * @param {unknown} error
 * @param {string} [fallbackKey]
 */
export const transitionErrorKey = (error, fallbackKey = 'common.error') => knownKey(error) ?? fallbackKey;

/** Translated text for a known transition failure, else `fallbackText` (so raw RPC codes are never shown). */
export const transitionMessage = (t, error, fallbackText) => {
  const key = knownKey(error);
  return key ? t(key) : fallbackText;
};
