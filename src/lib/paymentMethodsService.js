/**
 * Payment Methods Service (F0 toggle)
 *
 * Reads the payment-method catalog and flips the per-flow switches.
 *   - Customers read through the public RPC (explicit columns only).
 *   - Admins read the table directly (RLS admin-read policy) and write ONLY
 *     through set_payment_method_enabled(), which re-checks the role, takes an
 *     advisory lock and writes the audit row server-side.
 *
 * See supabase/migrations/20261014170000_payment_methods_toggle.sql
 */

import { supabase } from '@/lib/supabase';
import { AppError, ERROR_CODES, isSchemaMissingError, logError } from '@/lib/errorHandler';

export const PAYMENT_FLOWS = Object.freeze({
  ORDERS: 'orders',
  REMITTANCES: 'remittances'
});

export const PAYMENT_METHOD_CODES = Object.freeze({
  ZELLE: 'zelle',
  BIZUM: 'bizum'
});

export const PAYMENT_METHOD_ERROR = Object.freeze({
  DISABLED: 'disabled',
  LAST_ENABLED: 'last_enabled',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  INVALID_FLOW: 'invalid_flow',
  REASON_TOO_LONG: 'reason_too_long',
  UNKNOWN: 'unknown'
});

// DB error message tokens (see the migration header) -> typed kind.
const MESSAGE_TOKENS = [
  ['payment_method_disabled', PAYMENT_METHOD_ERROR.DISABLED],
  ['payment_method_last_enabled', PAYMENT_METHOD_ERROR.LAST_ENABLED],
  ['payment_method_unavailable', PAYMENT_METHOD_ERROR.UNAVAILABLE],
  ['payment_method_forbidden', PAYMENT_METHOD_ERROR.FORBIDDEN],
  ['payment_method_not_found', PAYMENT_METHOD_ERROR.NOT_FOUND],
  ['payment_method_invalid_flow', PAYMENT_METHOD_ERROR.INVALID_FLOW],
  ['payment_method_reason_too_long', PAYMENT_METHOD_ERROR.REASON_TOO_LONG]
];

const VALID_FLOWS = Object.values(PAYMENT_FLOWS);

export class PaymentMethodError extends AppError {
  constructor(kind, message, context = {}) {
    super(message, ERROR_CODES.DB_ERROR, 400, context);
    this.name = 'PaymentMethodError';
    this.kind = kind;
  }
}

/**
 * Classify a raw PostgREST / Postgres error by the message tokens raised in SQL.
 * @param {unknown} error
 * @returns {string} one of PAYMENT_METHOD_ERROR
 */
export const classifyPaymentMethodError = (error) => {
  if (!error) return PAYMENT_METHOD_ERROR.UNKNOWN;
  if (error instanceof PaymentMethodError) return error.kind;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  const match = MESSAGE_TOKENS.find(([token]) => text.includes(token));
  return match ? match[1] : PAYMENT_METHOD_ERROR.UNKNOWN;
};

/** True when the error is the creation-guard rejection (payment_method_disabled). */
export const isPaymentMethodDisabledError = (error) =>
  classifyPaymentMethodError(error) === PAYMENT_METHOD_ERROR.DISABLED;

const toTypedError = (error, operation) => {
  const kind = classifyPaymentMethodError(error);
  const typed = new PaymentMethodError(kind, error?.message || 'Payment method request failed', {
    postgresCode: error?.code,
    schemaMissing: isSchemaMissingError(error),
    operation
  });
  // A rejection by the guard / RPC is an expected business outcome, and a missing
  // schema is an expected pre-deploy state; only log genuinely unexpected failures.
  if (kind === PAYMENT_METHOD_ERROR.UNKNOWN && !typed.context.schemaMissing) {
    logError(typed, { operation });
  }
  return typed;
};

/**
 * Is `code` usable for `flow`? Fails OPEN when the list is unknown (not loaded,
 * RPC missing, network error): the BEFORE INSERT trigger is the real enforcement,
 * the UI must never block customers because the status could not be read.
 * @param {Array<object>|null|undefined} methods
 */
export const isPaymentMethodEnabled = (methods, code, flow) => {
  if (!Array.isArray(methods)) return true;
  const row = methods.find((m) => m.code === code);
  if (!row || !row.available) return false;
  return flow === PAYMENT_FLOWS.ORDERS ? Boolean(row.enabled_for_orders) : Boolean(row.enabled_for_remittances);
};

/** True only when the list is known and no available method is enabled for the flow. */
export const isFlowBlocked = (methods, flow) => {
  if (!Array.isArray(methods)) return false;
  return !methods.some((m) => isPaymentMethodEnabled(methods, m.code, flow));
};

/**
 * Customer-facing listing (explicit columns, authenticated only).
 * @returns {Promise<Array<{code:string, available:boolean, enabled_for_orders:boolean, enabled_for_remittances:boolean}>>}
 * @throws {PaymentMethodError}
 */
export const listPaymentMethods = async () => {
  try {
    const { data, error } = await supabase.rpc('list_payment_methods_public');
    if (error) throw error;
    return data || [];
  } catch (error) {
    throw toTypedError(error, 'listPaymentMethods');
  }
};

/**
 * Admin listing: full row plus the display name of whoever last changed it.
 * The name lookup is best-effort; a failure leaves updated_by_name = null.
 * @returns {Promise<Array<object>>}
 * @throws {PaymentMethodError}
 */
export const listPaymentMethodsForAdmin = async () => {
  let rows;
  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('code, available, enabled_for_orders, enabled_for_remittances, disabled_reason, updated_at, updated_by')
      .order('code');
    if (error) throw error;
    rows = data || [];
  } catch (error) {
    throw toTypedError(error, 'listPaymentMethodsForAdmin');
  }

  const ids = [...new Set(rows.map((r) => r.updated_by).filter(Boolean))];
  let names = {};
  if (ids.length > 0) {
    try {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name').in('id', ids);
      if (!error && Array.isArray(data)) {
        names = Object.fromEntries(data.map((p) => [p.id, p.full_name || null]));
      }
    } catch {
      names = {};
    }
  }

  return rows.map((row) => ({ ...row, updated_by_name: names[row.updated_by] ?? null }));
};

/**
 * Flip one switch through the server-side RPC.
 * @param {{code:string, flow:'orders'|'remittances', enabled:boolean, reason?:string|null, confirmLast?:boolean}} params
 * @returns {Promise<object>} the updated catalog row
 * @throws {PaymentMethodError}
 */
export const setPaymentMethodEnabled = async ({ code, flow, enabled, reason = null, confirmLast = false }) => {
  if (!VALID_FLOWS.includes(flow)) {
    throw new PaymentMethodError(PAYMENT_METHOD_ERROR.INVALID_FLOW, `Invalid flow: ${flow}`, {
      operation: 'setPaymentMethodEnabled'
    });
  }

  try {
    const { data, error } = await supabase.rpc('set_payment_method_enabled', {
      p_code: code,
      p_flow: flow,
      p_enabled: enabled,
      p_reason: reason,
      p_confirm_last: confirmLast
    });
    if (error) throw error;
    return data;
  } catch (error) {
    throw toTypedError(error, 'setPaymentMethodEnabled');
  }
};
