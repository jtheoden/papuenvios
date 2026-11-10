/**
 * User Status Service
 *
 * Enables / disables a user. The only write path is the set_user_enabled() RPC, which re-checks that the
 * caller is a super_admin, records the reason and audits the change.
 * See supabase/migrations/20261019130000_disable_user_with_reason.sql
 */

import { supabase } from '@/lib/supabase';
import { AppError, ERROR_CODES, logError } from '@/lib/errorHandler';

export const USER_DISABLE_REASON_MIN = 3;
export const USER_DISABLE_REASON_MAX = 500;

export const USER_STATUS_ERROR = Object.freeze({
  FORBIDDEN: 'forbidden',
  SELF: 'self',
  LAST_SUPER_ADMIN: 'last_super_admin',
  REASON_REQUIRED: 'reason_required',
  REASON_TOO_LONG: 'reason_too_long',
  NOT_FOUND: 'not_found',
  UNKNOWN: 'unknown'
});

// DB error message tokens (see the migration header) -> typed kind.
const MESSAGE_TOKENS = [
  ['insufficient_privilege', USER_STATUS_ERROR.FORBIDDEN],
  ['user_disable_self', USER_STATUS_ERROR.SELF],
  ['user_disable_last_super_admin', USER_STATUS_ERROR.LAST_SUPER_ADMIN],
  ['user_disable_reason_required', USER_STATUS_ERROR.REASON_REQUIRED],
  ['user_disable_reason_too_long', USER_STATUS_ERROR.REASON_TOO_LONG],
  ['user_not_found', USER_STATUS_ERROR.NOT_FOUND]
];

export class UserStatusError extends AppError {
  constructor(kind, message, context = {}) {
    super(message, ERROR_CODES.DB_ERROR, 400, context);
    this.name = 'UserStatusError';
    this.kind = kind;
  }
}

/**
 * @param {unknown} error raw PostgREST / Postgres error
 * @returns {string} one of USER_STATUS_ERROR
 */
export const classifyUserStatusError = (error) => {
  if (!error) return USER_STATUS_ERROR.UNKNOWN;
  if (error instanceof UserStatusError) return error.kind;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  const match = MESSAGE_TOKENS.find(([token]) => text.includes(token));
  return match ? match[1] : USER_STATUS_ERROR.UNKNOWN;
};

/**
 * @param {string} userId
 * @param {boolean} enabled
 * @param {string} [reason] required (3..500 trimmed characters) when disabling
 * @returns {Promise<object>} RPC result ({ user_id, is_enabled, changed, ... })
 * @throws {UserStatusError}
 */
export const setUserEnabled = async (userId, enabled, reason = null) => {
  const trimmed = typeof reason === 'string' ? reason.trim() : null;

  // Local pre-check only saves a round trip; the RPC is the real enforcement.
  if (!enabled) {
    if (!trimmed || trimmed.length < USER_DISABLE_REASON_MIN) {
      throw new UserStatusError(USER_STATUS_ERROR.REASON_REQUIRED, 'A reason is required to disable a user');
    }
    if (trimmed.length > USER_DISABLE_REASON_MAX) {
      throw new UserStatusError(USER_STATUS_ERROR.REASON_TOO_LONG, 'The reason is too long');
    }
  }

  const { data, error } = await supabase.rpc('set_user_enabled', {
    p_user_id: userId,
    p_enabled: enabled,
    p_reason: enabled ? null : trimmed
  });

  if (error) {
    const kind = classifyUserStatusError(error);
    const typed = new UserStatusError(kind, error.message || 'Could not update the user status', {
      postgresCode: error.code,
      operation: 'setUserEnabled'
    });
    // Business rejections are expected outcomes; only log the unexpected ones.
    if (kind === USER_STATUS_ERROR.UNKNOWN) logError(typed, { operation: 'setUserEnabled' });
    throw typed;
  }

  return data;
};
