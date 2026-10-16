/**
 * Payment FX (EUR) service for the Bizum admin front.
 *
 * Read-only wrapper over get_payment_fx_status. The USD->EUR rate Bizum quotes with is the CENTRAL rate
 * admins maintain in Financial Settings (public.exchange_rates); the database derives the status (mid,
 * Bizum spread, effective rate, freshness state and thresholds) from it
 * (supabase/migrations/20261016120000_bizum_central_fx_rate.sql). There is deliberately no writer here:
 * the old ledger-writing RPC is retired, so the rate cannot be loaded twice.
 */

import { supabase } from '@/lib/supabase';
import { toBizumError } from '@/lib/bizumErrors';

export const PAYMENT_FX_STATES = Object.freeze({
  NONE: 'none',
  OK: 'ok',
  WARN: 'warn',
  BLOCKED: 'blocked'
});

/**
 * Current central rate with its freshness state and the thresholds the server applied.
 * @throws {import('@/lib/bizumErrors').BizumError}
 */
export const getPaymentFxStatus = async () => {
  const { data, error } = await supabase.rpc('get_payment_fx_status');
  if (error) throw toBizumError(error);
  return data || {};
};
