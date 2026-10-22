/**
 * Client side of the status-transition RPCs (order_* / remittance_*, see
 * supabase/migrations/20261024110000_order_transition_rpcs.sql and 20261024110100_remittance_transition_rpcs.sql).
 * The database owns the lock, the transition matrix, the stock effect and the status history; this module only calls
 * the RPC and turns its documented errors into AppErrors:
 *   22023 invalid_transition -> CONFLICT (the row moved: another admin or the owner acted first)
 *   22023 invalid_argument   -> VALIDATION_FAILED (DETAIL names the field)
 *   P0001 stock_refused      -> the typed stock error (DETAIL carries the stock RPC answer)
 *   42501                    -> FORBIDDEN, P0002 -> NOT_FOUND
 */
import { supabase } from './supabase';
import {
  AppError,
  ERROR_CODES,
  createNotFoundError,
  createValidationError,
  logError,
  parseSupabaseError
} from './errorHandler';
import { stockRefusalToError } from './stockErrors';

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * @param {{code?: string, message?: string, details?: string}} error PostgREST error of a transition RPC
 * @param {{entity: string, id: string}} target
 * @returns {AppError}
 */
export const mapTransitionError = (error, { entity, id }) => {
  const message = String(error?.message || '');
  if (error?.code === '22023' && message.includes('invalid_transition')) {
    return new AppError(`${entity} ${id} changed state`, ERROR_CODES.CONFLICT, 409, {
      reason: 'invalid_transition',
      entityId: id,
      current: parseJson(error.details)
    });
  }
  if (error?.code === '22023' && message.includes('invalid_argument')) {
    const field = error.details || 'argument';
    return createValidationError({ [field]: `Invalid ${field}` }, `Invalid ${field}`);
  }
  if (error?.code === 'P0001' && message.includes('stock_refused')) {
    return stockRefusalToError(parseJson(error.details) || {}, id);
  }
  if (error?.code === '42501') {
    return new AppError(message || 'not_authorized', ERROR_CODES.FORBIDDEN, 403, { reason: message });
  }
  if (error?.code === 'P0002') {
    return createNotFoundError(entity, id);
  }
  return parseSupabaseError(error);
};

export { isStatusConflictError, transitionErrorKey, transitionMessage } from './statusConflict';

/**
 * Runs a transition RPC and returns the fresh row. Throws the mapped AppError (already logged).
 * @param {string} rpcName e.g. 'order_validate_payment'
 * @param {Object} args named PostgREST arguments
 * @param {{entity: string, id: string}} target used in error messages and context
 */
export const callTransitionRpc = async (rpcName, args, target) => {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) {
    const appError = mapTransitionError(error, target);
    logError(appError, { operation: rpcName, entityId: target.id });
    throw appError;
  }
  return data;
};
