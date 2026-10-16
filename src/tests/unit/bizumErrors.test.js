import { describe, it, expect, vi, afterEach } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import {
  BIZUM_ERROR_MAP,
  BIZUM_ERROR_I18N_KEYS,
  BizumError,
  isBizumSchemaMissing,
  toBizumError
} from '@/lib/bizumErrors';
import { PG_ERRORS } from './helpers/bizumTestUtils';

const lookup = (dict, path) => path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);

const TOKENS = [
  'bizum_settings_forbidden',
  'bizum_settings_invalid_patch',
  'bizum_settings_unknown_key',
  'bizum_settings_out_of_range',
  'bizum_settings_missing',
  'payment_fx_forbidden',
  'payment_fx_invalid_rate',
  'payment_fx_invalid_spread',
  'payment_fx_invalid_source',
  'payment_fx_note_too_long',
  'payment_fx_large_change',
  'payment_fx_rates_append_only',
  'payment_fx_managed_centrally',
  'bizum_accounts_no_delete',
  'bizum_accounts_immutable_columns'
];

afterEach(() => vi.restoreAllMocks());

describe('toBizumError token mapping', () => {
  it.each(TOKENS)('maps %s to an i18n key that exists in ES and EN', (token) => {
    const error = toBizumError(PG_ERRORS.raise(token));
    expect(error).toBeInstanceOf(BizumError);
    expect(error.token).toBe(token);
    expect(error.i18nKey).toMatch(/^settings\.(bizum|fxRate)\.errors\./);
    expect(lookup(ES, error.i18nKey), `ES ${error.i18nKey}`).toBeTypeOf('string');
    expect(lookup(EN, error.i18nKey), `EN ${error.i18nKey}`).toBeTypeOf('string');
  });

  it('maps every account constraint name to a field-level key', () => {
    const cases = [
      ['bizum_accounts_phone_key', 'phone'],
      ['bizum_accounts_phone_e164', 'phone'],
      ['bizum_accounts_limit_nonneg', 'per_operation_limit'],
      ['bizum_accounts_account_name_len', 'account_name'],
      ['bizum_accounts_holder_name_len', 'holder_name'],
      ['bizum_accounts_bank_name_len', 'bank_name'],
      ['bizum_accounts_notes_len', 'notes']
    ];
    for (const [constraint, field] of cases) {
      const error = toBizumError({ code: '23514', message: `violates check constraint "${constraint}"`, details: null });
      expect(error.field, constraint).toBe(field);
      expect(lookup(ES, error.i18nKey), constraint).toBeTypeOf('string');
    }
  });

  it('extracts the offending key from out_of_range DETAIL', () => {
    const error = toBizumError(PG_ERRORS.raise('bizum_settings_out_of_range', 'key=fx_warn_hours'));
    expect(error.field).toBe('fx_warn_hours');
  });

  it('treats 42501 and RLS violations as forbidden', () => {
    const error = toBizumError(PG_ERRORS.rls);
    expect(error.token).toBe('forbidden');
    expect(error.i18nKey).toBe('settings.bizum.errors.forbidden');
  });

  it('falls back to an unknown key for unrecognised errors', () => {
    const error = toBizumError({ code: 'XX000', message: 'boom' });
    expect(error.i18nKey).toBe('settings.bizum.errors.unknown');
  });

  it('exposes only existing keys in BIZUM_ERROR_I18N_KEYS', () => {
    expect(BIZUM_ERROR_I18N_KEYS.length).toBeGreaterThan(TOKENS.length);
    expect(BIZUM_ERROR_MAP.length).toBeGreaterThan(0);
    for (const key of BIZUM_ERROR_I18N_KEYS) {
      expect(lookup(ES, key), `ES ${key}`).toBeTypeOf('string');
      expect(lookup(EN, key), `EN ${key}`).toBeTypeOf('string');
    }
  });
});

describe('toBizumError never leaks PII', () => {
  const phone = '+34612345678';

  it('does not echo the phone from unique-violation details or check-violation rows', () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    for (const raw of [PG_ERRORS.phoneDuplicate(phone), PG_ERRORS.phoneCheck(phone)]) {
      const error = toBizumError(raw);
      expect(JSON.stringify({ m: error.message, t: error.token, k: error.i18nKey, f: error.field, s: error.stack })).not.toContain('612345678');
      expect(Object.values(error).join('|')).not.toContain('612345678');
    }
    spies.forEach((spy) => expect(JSON.stringify(spy.mock.calls)).not.toContain('612345678'));
  });
});

describe('isBizumSchemaMissing', () => {
  it.each([
    ['missing function (PGRST202)', PG_ERRORS.missingFunction],
    ['missing table (PGRST205)', PG_ERRORS.missingTable],
    ['missing relation (42P01)', PG_ERRORS.missingRelation]
  ])('is true for %s', (_, raw) => {
    expect(isBizumSchemaMissing(raw)).toBe(true);
    expect(toBizumError(raw).schemaMissing).toBe(true);
  });

  it('is false for PGRST116 (zero rows under RLS is not a missing schema)', () => {
    const raw = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
    expect(isBizumSchemaMissing(raw)).toBe(false);
  });

  it('is false for business errors and forbidden', () => {
    expect(isBizumSchemaMissing(PG_ERRORS.rls)).toBe(false);
    expect(isBizumSchemaMissing(PG_ERRORS.raise('bizum_settings_forbidden', null, '42501'))).toBe(false);
    expect(isBizumSchemaMissing(null)).toBe(false);
  });
});

describe('isBizumSchemaMissing uses a CLOSED list (a transient outage must not hide the section)', () => {
  it.each(['PGRST202', 'PGRST205', '42P01', '42883'])('is true for %s', (code) => {
    expect(isBizumSchemaMissing({ code, message: 'x' })).toBe(true);
  });

  it.each([
    ['PGRST002', 'Could not query the database for the schema cache. Retrying.'],
    ['PGRST204', "Could not find the 'x' column of 'y' in the schema cache"],
    ['42703', 'column "x" does not exist'],
    ['42704', 'type "x" does not exist'],
    ['PGRST116', 'JSON object requested, multiple (or no) rows returned']
  ])('is false for %s even when the message says schema cache / does not exist', (code, message) => {
    expect(isBizumSchemaMissing({ code, message })).toBe(false);
  });

  it('is false for message-only matches and 503 statuses without a closed-list code', () => {
    expect(isBizumSchemaMissing({ message: 'schema cache' })).toBe(false);
    expect(isBizumSchemaMissing({ status: 503, message: 'relation does not exist' })).toBe(false);
  });
});

describe('BizumError carries no raw text (explicit PII case)', () => {
  it('never contains the phone or the raw details in message, token, key, field or stack', () => {
    const raw = { code: 'XX000', message: 'boom for +34600111222', details: 'Key (phone)=(+34600111222) already exists.', hint: 'call +34600111222' };
    const error = toBizumError(raw);
    for (const value of [error.message, error.token, error.i18nKey, String(error.field), error.stack, JSON.stringify(error)]) {
      expect(String(value)).not.toContain('600111222');
      expect(String(value)).not.toContain('Key (phone)');
    }
  });
});
