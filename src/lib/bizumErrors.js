/**
 * Error mapping for the Bizum / payment-FX admin front.
 *
 * The database raises stable tokens (see supabase/migrations/20261015120000_bizum_s3_*.sql and
 * 20261015130000_bizum_s4_accounts.sql). Raw Postgres errors can carry PII (a duplicate-key error
 * echoes the phone, a CHECK violation echoes the whole row), so a raw error is NEVER forwarded:
 * it is reduced to a BizumError that holds only a token, an i18n key, an optional form field and a
 * schemaMissing flag. Nothing in this module logs.
 */

const BIZUM_ERRORS = 'settings.bizum.errors';
const FX_ERRORS = 'settings.fxRate.errors';

/**
 * Ordered matchers: `match` is searched in the error text. `field` is the form field the error
 * belongs to (settings keys come from the DETAIL of bizum_settings_out_of_range instead).
 */
export const BIZUM_ERROR_MAP = Object.freeze([
  { match: 'bizum_settings_forbidden', key: `${BIZUM_ERRORS}.forbidden` },
  { match: 'payment_fx_forbidden', key: `${FX_ERRORS}.forbidden` },
  { match: 'bizum_settings_invalid_patch', key: `${BIZUM_ERRORS}.invalidPatch` },
  { match: 'bizum_settings_unknown_key', key: `${BIZUM_ERRORS}.unknownKey` },
  { match: 'bizum_settings_out_of_range', key: `${BIZUM_ERRORS}.outOfRange` },
  { match: 'bizum_settings_missing', key: `${BIZUM_ERRORS}.settingsMissing` },
  { match: 'payment_fx_invalid_rate', key: `${FX_ERRORS}.invalidRate`, field: 'mid' },
  { match: 'payment_fx_invalid_spread', key: `${FX_ERRORS}.invalidSpread`, field: 'spread' },
  { match: 'payment_fx_invalid_source', key: `${FX_ERRORS}.invalidSource` },
  { match: 'payment_fx_note_too_long', key: `${FX_ERRORS}.noteTooLong`, field: 'note' },
  { match: 'payment_fx_large_change', key: `${FX_ERRORS}.largeChange` },
  { match: 'payment_fx_rates_append_only', key: `${FX_ERRORS}.appendOnly` },
  { match: 'bizum_accounts_no_delete', key: `${BIZUM_ERRORS}.accountNoDelete` },
  { match: 'bizum_accounts_immutable_columns', key: `${BIZUM_ERRORS}.accountImmutable` },
  { match: 'bizum_accounts_phone_key', key: `${BIZUM_ERRORS}.phoneDuplicate`, field: 'phone' },
  { match: 'bizum_accounts_phone_e164', key: `${BIZUM_ERRORS}.phoneInvalid`, field: 'phone' },
  { match: 'bizum_accounts_limit_nonneg', key: `${BIZUM_ERRORS}.limitInvalid`, field: 'per_operation_limit' },
  { match: 'bizum_accounts_account_name_len', key: `${BIZUM_ERRORS}.accountNameLength`, field: 'account_name' },
  { match: 'bizum_accounts_holder_name_len', key: `${BIZUM_ERRORS}.holderNameLength`, field: 'holder_name' },
  { match: 'bizum_accounts_bank_name_len', key: `${BIZUM_ERRORS}.bankNameLength`, field: 'bank_name' },
  { match: 'bizum_accounts_notes_len', key: `${BIZUM_ERRORS}.notesLength`, field: 'notes' }
]);

const FORBIDDEN_KEY = `${BIZUM_ERRORS}.forbidden`;
const UNKNOWN_KEY = `${BIZUM_ERRORS}.unknown`;

/** Every i18n key this module can produce (used by the parity test). */
export const BIZUM_ERROR_I18N_KEYS = Object.freeze([
  ...new Set([...BIZUM_ERROR_MAP.map((entry) => entry.key), FORBIDDEN_KEY, UNKNOWN_KEY])
]);

export class BizumError extends Error {
  /**
   * @param {{token: string, i18nKey: string, field?: string|null, schemaMissing?: boolean}} info
   */
  constructor({ token, i18nKey, field = null, schemaMissing = false }) {
    super(token);
    this.name = 'BizumError';
    this.token = token;
    this.i18nKey = i18nKey;
    this.field = field;
    this.schemaMissing = schemaMissing;
  }
}

/**
 * CLOSED list: PostgREST 202 (function not found), 205 (table not found), Postgres 42P01 (undefined
 * table) and 42883 (undefined function). The generic isSchemaMissingError also accepts "schema cache"
 * messages and PGRST002 / PGRST204 / 42703 / PGRST116, which include transient outages and permission
 * outcomes; trusting them would hide the whole section for a 503.
 */
const MISSING_SCHEMA_CODES = Object.freeze(['PGRST202', 'PGRST205', '42P01', '42883']);

/** True only when the Bizum objects are certainly not deployed (migrations not applied). */
export const isBizumSchemaMissing = (error) => Boolean(error) && MISSING_SCHEMA_CODES.includes(String(error.code));

/**
 * Reduce any thrown value to a PII-free BizumError.
 * @param {unknown} raw
 * @returns {BizumError}
 */
export const toBizumError = (raw) => {
  if (raw instanceof BizumError) return raw;
  const schemaMissing = isBizumSchemaMissing(raw);
  const text = [raw?.message, raw?.details, raw?.hint].filter(Boolean).join(' ');

  const entry = BIZUM_ERROR_MAP.find(({ match }) => text.includes(match));
  if (entry) {
    const detailKey = entry.match === 'bizum_settings_out_of_range' ? text.match(/key=([a-z_]+)/)?.[1] : null;
    return new BizumError({
      token: entry.match,
      i18nKey: entry.key,
      field: entry.field ?? detailKey ?? null,
      schemaMissing
    });
  }

  if (String(raw?.code) === '42501' || text.includes('row-level security')) {
    return new BizumError({ token: 'forbidden', i18nKey: FORBIDDEN_KEY, schemaMissing });
  }

  return new BizumError({ token: 'unknown', i18nKey: UNKNOWN_KEY, schemaMissing });
};

/** Error for an UPDATE that RLS filtered down to zero rows (the caller is not an admin). */
export const forbiddenBizumError = () => new BizumError({ token: 'forbidden', i18nKey: FORBIDDEN_KEY });
