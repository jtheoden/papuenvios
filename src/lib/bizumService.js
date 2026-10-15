/**
 * Bizum admin service: settings (RPC), receiving accounts (direct table access under RLS) and the
 * client-side phone / form helpers.
 *
 * Contracts (supabase/migrations/20261015120000_bizum_s3_*.sql, 20261015130000_bizum_s4_accounts.sql):
 *   - get_bizum_settings() / set_bizum_settings(p_patch jsonb): admin only, partial update.
 *   - bizum_accounts: admin-only RLS, no DELETE for any role (accounts are retired with is_active).
 * The database is the source of truth for bounds and authorization; the local validation mirrors
 * it (a static test compares it with the migration) only to avoid round-trips and drive field errors.
 *
 * Privacy (R-35): phones are PII. Raw Postgres errors echo them, so every failure goes through
 * toBizumError (PII-free) and nothing here logs.
 */

import { supabase } from '@/lib/supabase';
import { BizumError, forbiddenBizumError, toBizumError } from '@/lib/bizumErrors';

/** Same pattern as the SQL CHECK bizum_accounts_phone_e164. */
export const BIZUM_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;

const DECIMAL_PATTERN = /^-?(\d+([.,]\d*)?|[.,]\d+)$/;

/** Number from a user-typed string (decimal comma accepted); NaN when it is not a plain number. */
export const parseDecimal = (raw) => {
  const text = String(raw ?? '').trim();
  return DECIMAL_PATTERN.test(text) ? Number(text.replace(',', '.')) : Number.NaN;
};

/** Count of fractional digits in a user-typed number. */
export const countDecimals = (raw) => {
  const [, fraction = ''] = String(raw ?? '').trim().replace(',', '.').split('.');
  return fraction.length;
};

/** Strip separators; "00" international prefix becomes "+". Does not guess a country code. */
export const normalizePhone = (input) => {
  const stripped = String(input ?? '').trim().replace(/[\s\-.()]/g, '');
  return stripped.startsWith('00') ? `+${stripped.slice(2)}` : stripped;
};

export const isValidPhone = (input) => BIZUM_PHONE_REGEX.test(normalizePhone(input));

const MASK_FALLBACK = '••• •••';

/**
 * Listing mask: first three characters ("+34") and last three digits, e.g. "+34 ••• ••• 678".
 * E.164 country codes have 1-3 digits and cannot be split without a library, so the rule is fixed:
 * 3 leading characters + 3 trailing digits. Anything shorter than 7 digits is fully masked.
 */
export const maskPhone = (phone) => {
  const value = normalizePhone(phone);
  if (value === '') return '';
  if (!/^\+?\d{7,}$/.test(value)) return MASK_FALLBACK;
  return `${value.slice(0, 3)} ••• ••• ${value.slice(-3)}`;
};

/**
 * Every tunable of bizum_settings. min / max / default mirror the table CHECKs and column DEFAULTs;
 * `decimals` is the number of fractional digits the column accepts (0 = integer).
 */
export const BIZUM_SETTING_FIELDS = Object.freeze(
  [
    { key: 'default_spread_pct', unit: 'percent', min: 0, max: 10, default: 1.5, decimals: 2 },
    { key: 'quote_validity_minutes', unit: 'minutes', min: 15, max: 1440, default: 240, decimals: 0 },
    { key: 'quote_grace_hours', unit: 'hours', min: 0, max: 72, default: 24, decimals: 0 },
    { key: 'fx_warn_hours', unit: 'hours', min: 1, max: 720, default: 24, decimals: 0 },
    { key: 'fx_block_hours', unit: 'hours', min: 1, max: 720, default: 96, decimals: 0 },
    { key: 'fx_max_change_pct', unit: 'percent', min: 0.5, max: 20, default: 5, decimals: 2 },
    { key: 'default_per_operation_limit', unit: 'eur', min: 0.01, max: 99999999.99, default: 1000, decimals: 2 },
    { key: 'remittance_warn_hours', unit: 'hours', min: 1, max: 720, default: 48, decimals: 0 },
    { key: 'remittance_expire_hours', unit: 'hours', min: 1, max: 720, default: 72, decimals: 0 },
    { key: 'max_unpaid_ops_per_user', unit: 'count', min: 1, max: 20, default: 3, decimals: 0 },
    { key: 'max_open_quotes_per_user', unit: 'count', min: 1, max: 20, default: 3, decimals: 0 },
    { key: 'max_quotes_per_hour', unit: 'count', min: 1, max: 100, default: 10, decimals: 0 },
    { key: 'proof_retention_years', unit: 'years', min: 1, max: 15, default: 5, decimals: 0 }
  ].map((field) => Object.freeze(field))
);

/** [earlier, later] pairs the table requires to be strictly ordered (CHECK ..._window_order). */
const WINDOW_ORDER = [
  ['fx_warn_hours', 'fx_block_hours'],
  ['remittance_warn_hours', 'remittance_expire_hours']
];

const checkSettingValue = (raw, { min, max, decimals }) => {
  const text = String(raw ?? '').trim();
  if (text === '') return 'required';
  const value = parseDecimal(text);
  if (!Number.isFinite(value) || value < min || value > max) return 'range';
  if (decimals === 0 && !Number.isInteger(value)) return 'integer';
  if (countDecimals(text) > decimals) return 'decimals';
  return null;
};

/**
 * Validate the settings form (all values are strings).
 * @returns {Record<string, 'required'|'range'|'integer'|'decimals'|'windowOrder'>} error code per key
 */
export const validateBizumSettingsForm = (values) => {
  const errors = {};
  for (const field of BIZUM_SETTING_FIELDS) {
    const code = checkSettingValue(values[field.key], field);
    if (code) errors[field.key] = code;
  }
  for (const [earlier, later] of WINDOW_ORDER) {
    if (!errors[earlier] && !errors[later] && parseDecimal(values[earlier]) >= parseDecimal(values[later])) {
      errors[later] = 'windowOrder';
    }
  }
  return errors;
};

/** Only the keys whose numeric value changed, as JSON numbers (the RPC rejects strings). */
export const buildBizumSettingsPatch = (original, values) => {
  const patch = {};
  for (const { key } of BIZUM_SETTING_FIELDS) {
    const next = parseDecimal(values[key]);
    if (Number.isFinite(next) && Number(original?.[key]) !== next) patch[key] = next;
  }
  return patch;
};

/** @throws {BizumError} */
export const getBizumSettings = async () => {
  const { data, error } = await supabase.rpc('get_bizum_settings');
  if (error) throw toBizumError(error);
  return data;
};

/**
 * Partial update. An empty patch is refused locally (nothing to send).
 * @param {Record<string, number>} patch
 * @returns {Promise<object>} the merged settings row
 * @throws {BizumError} field = offending key for bizum_settings_out_of_range
 */
export const setBizumSettings = async (patch) => {
  if (!patch || Object.keys(patch).length === 0) {
    throw new BizumError({ token: 'bizum_settings_invalid_patch', i18nKey: 'settings.bizum.errors.invalidPatch' });
  }
  const { data, error } = await supabase.rpc('set_bizum_settings', { p_patch: patch });
  if (error) throw toBizumError(error);
  return data;
};

/* ------------------------------------------------------------------------------------------ */
/* Accounts                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const ACCOUNT_COLUMNS =
  'id, account_name, holder_name, phone, bank_name, is_active, for_products, for_remittances, priority_order, per_operation_limit, notes, created_at, updated_at';

const LIMITS = Object.freeze({ name: 120, bank: 120, notes: 500, maxLimit: 99999999.99, maxInt: 2147483647 });

/**
 * Validate the account form.
 * @returns {Record<string, 'required'|'tooLong'|'invalid'|'integer'|'range'|'decimals'>} error code per field
 */
export const validateBizumAccountForm = (values) => {
  const errors = {};
  const text = (key) => String(values[key] ?? '').trim();

  if (text('account_name') === '') errors.account_name = 'required';
  else if (text('account_name').length > LIMITS.name) errors.account_name = 'tooLong';

  if (text('holder_name') === '') errors.holder_name = 'required';
  else if (text('holder_name').length > LIMITS.name) errors.holder_name = 'tooLong';

  if (text('phone') === '') errors.phone = 'required';
  else if (!isValidPhone(values.phone)) errors.phone = 'invalid';

  if (text('bank_name').length > LIMITS.bank) errors.bank_name = 'tooLong';
  if (text('notes').length > LIMITS.notes) errors.notes = 'tooLong';

  const priority = text('priority_order');
  if (priority === '') errors.priority_order = 'required';
  else if (!Number.isInteger(parseDecimal(priority))) errors.priority_order = 'integer';
  else if (countDecimals(priority) > 0) errors.priority_order = 'decimals';
  else if (Math.abs(parseDecimal(priority)) > LIMITS.maxInt) errors.priority_order = 'range';

  const limit = text('per_operation_limit');
  if (limit === '') errors.per_operation_limit = 'required';
  else if (!(parseDecimal(limit) >= 0 && parseDecimal(limit) <= LIMITS.maxLimit)) errors.per_operation_limit = 'range';
  else if (countDecimals(limit) > 2) errors.per_operation_limit = 'decimals';

  return errors;
};

/** Whitelisted, normalized row payload (never id / created_by / timestamps). */
const toAccountPayload = (values) => ({
  account_name: String(values.account_name ?? '').trim(),
  holder_name: String(values.holder_name ?? '').trim(),
  phone: normalizePhone(values.phone),
  bank_name: String(values.bank_name ?? '').trim() || null,
  is_active: Boolean(values.is_active),
  for_products: Boolean(values.for_products),
  for_remittances: Boolean(values.for_remittances),
  priority_order: parseDecimal(values.priority_order),
  per_operation_limit: parseDecimal(values.per_operation_limit),
  notes: String(values.notes ?? '').trim() || null
});

/** First row of a write result; an empty result means RLS filtered the write out (not an admin). */
const firstRowOrForbidden = ({ data, error }) => {
  if (error) throw toBizumError(error);
  if (!Array.isArray(data) || data.length === 0) throw forbiddenBizumError();
  return data[0];
};

/** @throws {BizumError} */
export const listBizumAccounts = async () => {
  const { data, error } = await supabase
    .from('bizum_accounts')
    .select(ACCOUNT_COLUMNS)
    .order('priority_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw toBizumError(error);
  return data || [];
};

/** @throws {BizumError} field = 'phone' for a duplicate or malformed number */
export const createBizumAccount = async (values) =>
  firstRowOrForbidden(await supabase.from('bizum_accounts').insert(toAccountPayload(values)).select(ACCOUNT_COLUMNS));

/** Fields an edit may change. is_active is deliberately absent: it only changes via setBizumAccountActive. */
const EDITABLE_FIELDS = ['account_name', 'holder_name', 'phone', 'bank_name', 'for_products', 'for_remittances', 'priority_order', 'per_operation_limit', 'notes'];

/**
 * Edit an account sending ONLY the fields the admin changed (compared with `original`), so a stale
 * form cannot overwrite a concurrent change made elsewhere (lost update). Never sends is_active.
 * Returns `original` untouched, without a round-trip, when nothing changed.
 * @throws {BizumError}
 */
export const updateBizumAccount = async (id, values, original) => {
  const next = toAccountPayload(values);
  const before = toAccountPayload({ ...original, bank_name: original?.bank_name, notes: original?.notes });
  const changed = Object.fromEntries(EDITABLE_FIELDS.filter((field) => next[field] !== before[field]).map((field) => [field, next[field]]));
  if (Object.keys(changed).length === 0) return original;
  return firstRowOrForbidden(await supabase.from('bizum_accounts').update(changed).eq('id', id).select(ACCOUNT_COLUMNS));
};

/** Activate / deactivate (there is no delete). @throws {BizumError} */
export const setBizumAccountActive = async (id, isActive) =>
  firstRowOrForbidden(
    await supabase.from('bizum_accounts').update({ is_active: Boolean(isActive) }).eq('id', id).select(ACCOUNT_COLUMNS)
  );
