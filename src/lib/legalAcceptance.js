/**
 * Pure helpers for the legal-acceptance gate (Terms + Privacy acceptance and 18+ confirmation).
 * The server (record_legal_acceptance RPC) is the authority; these helpers give early feedback.
 */

/** Minimum age to transact. Mirrors the check inside the record_legal_acceptance RPC. */
export const MIN_AGE = 18;

/** Highest plausible age; anything older is treated as a typo. Mirrors the RPC. */
export const MAX_PLAUSIBLE_AGE = 120;

/** Allowed values of the `source` argument (and legal_acceptances.source column). */
export const ACCEPTANCE_SOURCES = ['login', 'checkout', 'remittance', 'profile'];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseIsoDate = (value) => {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return isRealDate ? { year, month, day } : null;
};

/**
 * Validates a date of birth against the minimum age, using the local calendar date of `now`.
 * A Feb 29 birthday counts as passed on Mar 1 in non-leap years.
 * @param {unknown} value - 'YYYY-MM-DD'
 * @param {Date} [now]
 * @returns {{ok: true, age: number} | {ok: false, code: 'invalid'|'future'|'under_age'}}
 */
export const validateBirthDate = (value, now = new Date()) => {
  const birth = parseIsoDate(value);
  if (!birth) return { ok: false, code: 'invalid' };

  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const birthKey = birth.year * 10000 + birth.month * 100 + birth.day;
  const todayKey = today.year * 10000 + today.month * 100 + today.day;
  if (birthKey > todayKey) return { ok: false, code: 'future' };

  // Compare (month, day) tuples; Feb 29 > Feb 28 and < Mar 1, so it matures on Mar 1 in common years.
  const birthdayPassed =
    today.month > birth.month || (today.month === birth.month && today.day >= birth.day);
  const age = today.year - birth.year - (birthdayPassed ? 0 : 1);

  if (age > MAX_PLAUSIBLE_AGE) return { ok: false, code: 'invalid' };
  if (age < MIN_AGE) return { ok: false, code: 'under_age' };
  return { ok: true, age };
};

const MESSAGE_CODES = [
  ['LEGAL_UNDER_AGE', 'under_age'],
  ['LEGAL_BIRTH_DATE_REQUIRED', 'invalid'],
  ['LEGAL_BIRTH_DATE_INVALID', 'invalid'],
  ['LEGAL_BIRTH_DATE_CONFLICT', 'birth_date_conflict'],
  ['LEGAL_NOT_AUTHENTICATED', 'not_authenticated'],
  ['LEGAL_PROFILE_NOT_FOUND', 'profile_not_found'],
  ['LEGAL_INVALID_VERSION', 'invalid_version'],
];

/**
 * Maps a Supabase/PostgREST error from the legal RPCs to a stable front-end code.
 * @param {{code?: string, message?: string}|null|undefined} error
 * @returns {'under_age'|'invalid'|'birth_date_conflict'|'not_authenticated'|'profile_not_found'|'invalid_version'|'unavailable'|'unknown'}
 */
export const mapAcceptanceError = (error) => {
  if (!error) return 'unknown';
  if (error.code === '42883' || error.code === 'PGRST202') return 'unavailable';
  const message = typeof error.message === 'string' ? error.message : '';
  const hit = MESSAGE_CODES.find(([marker]) => message.includes(marker));
  return hit ? hit[1] : 'unknown';
};
