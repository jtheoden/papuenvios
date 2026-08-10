/**
 * Platform Reset Service
 * Frente 2 del plan admin-bulk-ops-reset-audit. El reset solo puede
 * ejecutarse si platform_reset_control.enabled fue puesto en true
 * directamente en la base de datos (nunca desde esta capa ni desde ningún
 * RPC invocable por la app) — ver execute_platform_reset() en
 * supabase/migrations/20260808000002_platform_reset.sql.
 */

import { supabase } from '@/lib/supabase';
import { AppError, ERROR_CODES, logError, parseSupabaseError } from '@/lib/errorHandler';

const CONFIRMATION_WORD = 'RESETEAR';

/**
 * Lee el estado actual del flag habilitador. Fail-closed: cualquier error
 * de lectura (incluida RLS) se trata como enabled=false, nunca se asume
 * habilitado por defecto.
 * @returns {Promise<{enabled: boolean}>}
 */
export const getPlatformResetStatus = async () => {
  const { data, error } = await supabase
    .from('platform_reset_control')
    .select('enabled')
    .eq('id', 1)
    .single();

  if (error || !data) {
    logError(parseSupabaseError(error || new Error('platform_reset_control not readable')), {
      operation: 'getPlatformResetStatus'
    });
    return { enabled: false };
  }

  return { enabled: Boolean(data.enabled) };
};

/**
 * Ejecuta el reset. El RPC re-valida server-side el flag y el texto de
 * confirmación — esta validación local solo evita un round-trip innecesario.
 * @param {string} confirmationText - Debe ser exactamente "RESETEAR"
 * @returns {Promise<object>} Conteo de filas afectadas por tabla
 * @throws {AppError}
 */
export const executePlatformReset = async (confirmationText) => {
  if (confirmationText !== CONFIRMATION_WORD) {
    throw new AppError(
      `Confirmation text must be exactly "${CONFIRMATION_WORD}"`,
      ERROR_CODES.VALIDATION_FAILED,
      400
    );
  }

  const { data, error } = await supabase.rpc('execute_platform_reset', {
    p_confirmation: confirmationText
  });

  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'executePlatformReset' });
    throw appError;
  }

  return data;
};
