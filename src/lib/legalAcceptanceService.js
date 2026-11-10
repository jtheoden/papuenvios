import { supabase } from '@/lib/supabase';
import { LEGAL_VERSION } from '@/lib/legalConfig';
import {
  ACCEPTANCE_SOURCES,
  mapAcceptanceError,
  validateBirthDate,
} from '@/lib/legalAcceptance';

/**
 * Whether the signed-in user has accepted the CURRENT Terms + Privacy versions.
 * Never throws. Only a missing RPC (migration not applied yet) is 'unavailable' and may fail open;
 * any other failure is 'error' and the caller must block and let the user retry.
 * @returns {Promise<'accepted'|'required'|'unavailable'|'error'>}
 */
export const checkCurrentAcceptance = async () => {
  try {
    const { data, error } = await supabase.rpc('has_current_legal_acceptance', {
      p_terms_version: LEGAL_VERSION,
      p_privacy_version: LEGAL_VERSION,
    });
    if (error) return mapAcceptanceError(error) === 'unavailable' ? 'unavailable' : 'error';
    return data === true ? 'accepted' : 'required';
  } catch {
    return 'error';
  }
};

/**
 * Records acceptance of the current Terms + Privacy versions and the 18+ confirmation.
 * The date of birth is validated locally first (fast feedback) and again by the server (authority).
 * @param {{birthDate: string, source: string}} params
 * @returns {Promise<{ok: true} | {ok: false, code: string}>}
 */
export const recordLegalAcceptance = async ({ birthDate, source }) => {
  if (!ACCEPTANCE_SOURCES.includes(source)) return { ok: false, code: 'unknown' };

  const local = validateBirthDate(birthDate);
  if (!local.ok) return { ok: false, code: local.code === 'under_age' ? 'under_age' : 'invalid' };

  try {
    const { error } = await supabase.rpc('record_legal_acceptance', {
      p_terms_version: LEGAL_VERSION,
      p_privacy_version: LEGAL_VERSION,
      p_birth_date: birthDate,
      p_source: source,
    });
    if (error) return { ok: false, code: mapAcceptanceError(error) };
    return { ok: true };
  } catch {
    return { ok: false, code: 'unknown' };
  }
};
