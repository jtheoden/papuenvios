/**
 * Stock reservation policy service.
 * Thin wrapper over the RPCs get_stock_policy / set_stock_policy / reset_stock_policy
 * (supabase/migrations/20261014190000_atomic_stock_reservation.sql). The database is the
 * source of truth for bounds and authorization (super_admin only for writes); the local
 * validation only avoids a pointless round-trip and drives inline form errors. The audit
 * trail (before/after + actor) is written by the database inside set/reset_stock_policy.
 */

import { supabase } from '@/lib/supabase';
import { AppError, ERROR_CODES, logError, parseSupabaseError } from '@/lib/errorHandler';

/** Approved defaults (mirrors the migration). */
export const STOCK_POLICY_DEFAULTS = Object.freeze({
  unpaidHours: 48,
  proofHours: 168,
  maxOpenReservations: 5
});

/** Allowed ranges (mirrors the migration; the server enforces them again). */
export const STOCK_POLICY_BOUNDS = Object.freeze({
  unpaidHours: Object.freeze({ min: 6, max: 720 }),
  proofHours: Object.freeze({ min: 24, max: 2160 }),
  maxOpenReservations: Object.freeze({ min: 1, max: 50 })
});

const isInteger = (value) => {
  if (value === '' || value === null || value === undefined) return false;
  const n = Number(value);
  return Number.isInteger(n);
};

const outOfRange = (value, { min, max }) => !isInteger(value) || Number(value) < min || Number(value) > max;

/**
 * Validate a policy form.
 * @param {{unpaidHours: unknown, proofHours: unknown, maxOpenReservations: unknown}} values
 * @returns {{unpaidHours?: 'range', proofHours?: 'range'|'belowUnpaid', maxOpenReservations?: 'range'}}
 */
export const validateStockPolicy = (values) => {
  const errors = {};
  if (outOfRange(values.unpaidHours, STOCK_POLICY_BOUNDS.unpaidHours)) errors.unpaidHours = 'range';
  if (outOfRange(values.proofHours, STOCK_POLICY_BOUNDS.proofHours)) {
    errors.proofHours = 'range';
  } else if (!errors.unpaidHours && Number(values.proofHours) < Number(values.unpaidHours)) {
    errors.proofHours = 'belowUnpaid';
  }
  if (outOfRange(values.maxOpenReservations, STOCK_POLICY_BOUNDS.maxOpenReservations)) {
    errors.maxOpenReservations = 'range';
  }
  return errors;
};

const mapRow = (row = {}) => ({
  unpaidHours: row.unpaid_hours,
  proofHours: row.proof_hours,
  maxOpenReservations: row.max_open_reservations
});

const mapPolicy = (data) => ({
  ...mapRow(data),
  defaults: data?.defaults ? mapRow(data.defaults) : { ...STOCK_POLICY_DEFAULTS },
  bounds: data?.bounds
    ? {
        unpaidHours: data.bounds.unpaid_hours,
        proofHours: data.bounds.proof_hours,
        maxOpenReservations: data.bounds.max_open_reservations
      }
    : { ...STOCK_POLICY_BOUNDS }
});

const toTypedError = (error, operation) => {
  if (error?.code === '42501') {
    return new AppError('Only a super admin can change the stock policy', ERROR_CODES.FORBIDDEN, 403, { operation });
  }
  if (error?.code === '22023') {
    return new AppError(error.message || 'Invalid stock policy', ERROR_CODES.VALIDATION_FAILED, 400, { operation });
  }
  const appError = parseSupabaseError(error);
  logError(appError, { operation });
  return appError;
};

const callRpc = async (name, args, operation) => {
  const { data, error } = args === undefined ? await supabase.rpc(name) : await supabase.rpc(name, args);
  if (error) throw toTypedError(error, operation);
  return mapPolicy(data);
};

/**
 * Effective policy plus defaults and bounds (admins).
 * @throws {AppError} FORBIDDEN for non-admins
 */
export const getStockPolicy = () => callRpc('get_stock_policy', undefined, 'getStockPolicy');

/**
 * Save the policy (super_admin).
 * @param {{unpaidHours: number, proofHours: number, maxOpenReservations: number}} values
 * @throws {AppError} VALIDATION_FAILED (local or server bounds) / FORBIDDEN
 */
export const setStockPolicy = async (values) => {
  const errors = validateStockPolicy(values);
  if (Object.keys(errors).length > 0) {
    throw new AppError('Invalid stock policy', ERROR_CODES.VALIDATION_FAILED, 400, { fieldErrors: errors });
  }
  return callRpc(
    'set_stock_policy',
    {
      p_unpaid_hours: Number(values.unpaidHours),
      p_proof_hours: Number(values.proofHours),
      p_max_open: Number(values.maxOpenReservations)
    },
    'setStockPolicy'
  );
};

/**
 * Restore the approved defaults (super_admin).
 */
export const resetStockPolicy = () => callRpc('reset_stock_policy', undefined, 'resetStockPolicy');
