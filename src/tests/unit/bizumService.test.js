import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import {
  BIZUM_PHONE_REGEX,
  BIZUM_SETTING_FIELDS,
  normalizePhone,
  isValidPhone,
  maskPhone,
  validateBizumSettingsForm,
  buildBizumSettingsPatch,
  validateBizumAccountForm,
  getBizumSettings,
  setBizumSettings,
  listBizumAccounts,
  createBizumAccount,
  updateBizumAccount,
  setBizumAccountActive
} from '@/lib/bizumService';
import { BizumError } from '@/lib/bizumErrors';
import { PG_ERRORS, queryChain } from './helpers/bizumTestUtils';

const SETTINGS = {
  default_spread_pct: 1.5,
  quote_validity_minutes: 240,
  quote_grace_hours: 24,
  fx_warn_hours: 24,
  fx_block_hours: 96,
  fx_max_change_pct: 5,
  default_per_operation_limit: 1000,
  remittance_warn_hours: 48,
  remittance_expire_hours: 72,
  max_unpaid_ops_per_user: 3,
  max_open_quotes_per_user: 3,
  max_quotes_per_hour: 10,
  proof_retention_years: 5
};

const toForm = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));

beforeEach(() => {
  supabaseMock.rpc.mockReset();
  supabaseMock.from.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('phone helpers', () => {
  it('uses the same E.164 regex as the SQL CHECK', () => {
    expect(BIZUM_PHONE_REGEX.source).toBe('^\\+[1-9][0-9]{7,14}$');
  });

  it('normalizes spaces, dashes, dots, parentheses and 00 prefix', () => {
    expect(normalizePhone(' +34 612-345.678 ')).toBe('+34612345678');
    expect(normalizePhone('0034 (612) 345678')).toBe('+34612345678');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });

  it('validates E.164 after normalization', () => {
    expect(isValidPhone('+34 612 345 678')).toBe(true);
    expect(isValidPhone('612345678')).toBe(false);
    expect(isValidPhone('+0612345678')).toBe(false);
    expect(isValidPhone('+3461234')).toBe(false);
    expect(isValidPhone('+3461234567890123')).toBe(false);
    expect(isValidPhone('+34abc45678')).toBe(false);
  });

  it('masks everything but the first three characters and the last three digits', () => {
    expect(maskPhone('+34612345678')).toBe('+34 ••• ••• 678');
    expect(maskPhone('+34 612 345 678')).toBe('+34 ••• ••• 678');
    const masked = maskPhone('+34612345678');
    expect(masked).not.toContain('612345');
  });

  it('returns an empty string for missing or too short values instead of leaking them', () => {
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('')).toBe('');
    expect(maskPhone('+1234')).toBe('••• •••');
  });
});

describe('BIZUM_SETTING_FIELDS', () => {
  it('describes all 13 parameters with unit, range and default', () => {
    expect(BIZUM_SETTING_FIELDS).toHaveLength(13);
    for (const field of BIZUM_SETTING_FIELDS) {
      expect(field.key).toBeTypeOf('string');
      expect(field.unit).toBeTypeOf('string');
      expect(field.min).toBeTypeOf('number');
      expect(field.max).toBeTypeOf('number');
      expect(field.default).toBeTypeOf('number');
    }
  });
});

describe('validateBizumSettingsForm', () => {
  it('accepts the recommended values', () => {
    expect(validateBizumSettingsForm(toForm(SETTINGS))).toEqual({});
  });

  it('flags empty, out-of-range, fractional-integer and too many decimals', () => {
    const errors = validateBizumSettingsForm(
      toForm({ ...SETTINGS, quote_validity_minutes: '', max_quotes_per_hour: 101, quote_grace_hours: 1.5, default_spread_pct: 1.234, proof_retention_years: 0 })
    );
    expect(errors.quote_validity_minutes).toBe('required');
    expect(errors.max_quotes_per_hour).toBe('range');
    expect(errors.quote_grace_hours).toBe('integer');
    expect(errors.default_spread_pct).toBe('decimals');
    expect(errors.proof_retention_years).toBe('range');
  });

  it('requires warn < block and warn < expire', () => {
    const errors = validateBizumSettingsForm(toForm({ ...SETTINGS, fx_warn_hours: 100, fx_block_hours: 96, remittance_warn_hours: 72, remittance_expire_hours: 72 }));
    expect(errors.fx_block_hours).toBe('windowOrder');
    expect(errors.remittance_expire_hours).toBe('windowOrder');
  });

  it('does not accept the zero limit (server requires > 0)', () => {
    expect(validateBizumSettingsForm(toForm({ ...SETTINGS, default_per_operation_limit: 0 })).default_per_operation_limit).toBe('range');
  });
});

describe('buildBizumSettingsPatch', () => {
  it('contains only changed keys, as JSON numbers', () => {
    const patch = buildBizumSettingsPatch(SETTINGS, { ...toForm(SETTINGS), fx_warn_hours: '12', default_spread_pct: '2.25' });
    expect(patch).toEqual({ fx_warn_hours: 12, default_spread_pct: 2.25 });
  });

  it('compares numerically: "1.50" equals 1.5 so it is not sent', () => {
    expect(buildBizumSettingsPatch(SETTINGS, { ...toForm(SETTINGS), default_spread_pct: '1.50' })).toEqual({});
  });

  it('accepts a decimal comma', () => {
    expect(buildBizumSettingsPatch(SETTINGS, { ...toForm(SETTINGS), default_spread_pct: '2,5' })).toEqual({ default_spread_pct: 2.5 });
  });
});

describe('settings RPCs', () => {
  it('getBizumSettings calls get_bizum_settings without params and returns the row', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: SETTINGS, error: null });
    await expect(getBizumSettings()).resolves.toEqual(SETTINGS);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_bizum_settings');
  });

  it('setBizumSettings sends exactly { p_patch }', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { ...SETTINGS, fx_warn_hours: 12 }, error: null });
    const row = await setBizumSettings({ fx_warn_hours: 12 });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_bizum_settings', { p_patch: { fx_warn_hours: 12 } });
    expect(row.fx_warn_hours).toBe(12);
  });

  it('setBizumSettings refuses an empty patch without calling the server', async () => {
    await expect(setBizumSettings({})).rejects.toBeInstanceOf(BizumError);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('maps RPC failures to BizumError with field and schemaMissing', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: PG_ERRORS.raise('bizum_settings_out_of_range', 'key=fx_block_hours') });
    await expect(setBizumSettings({ fx_block_hours: 1 })).rejects.toMatchObject({ field: 'fx_block_hours', token: 'bizum_settings_out_of_range' });

    supabaseMock.rpc.mockResolvedValue({ data: null, error: PG_ERRORS.missingFunction });
    await expect(getBizumSettings()).rejects.toMatchObject({ schemaMissing: true });
  });
});

describe('validateBizumAccountForm', () => {
  const valid = {
    account_name: 'Main', holder_name: 'Juan', phone: '+34 612 345 678', bank_name: '', is_active: true,
    for_products: true, for_remittances: true, priority_order: '0', per_operation_limit: '1000', notes: ''
  };

  it('accepts a valid form', () => {
    expect(validateBizumAccountForm(valid)).toEqual({});
  });

  it('validates phone, names, limit and priority', () => {
    const errors = validateBizumAccountForm({
      ...valid, account_name: '  ', holder_name: 'x'.repeat(121), phone: '612345678', per_operation_limit: '-1', priority_order: '1.5', notes: 'n'.repeat(501), bank_name: 'b'.repeat(121)
    });
    expect(errors).toMatchObject({
      account_name: 'required', holder_name: 'tooLong', phone: 'invalid', per_operation_limit: 'range', priority_order: 'integer', notes: 'tooLong', bank_name: 'tooLong'
    });
  });

  it('rejects decimals in the priority like the integer settings', () => {
    expect(validateBizumAccountForm({ ...valid, priority_order: '1.000' }).priority_order).toBe('decimals');
    expect(validateBizumAccountForm({ ...valid, priority_order: '5.0' }).priority_order).toBe('decimals');
    expect(validateBizumAccountForm({ ...valid, priority_order: '1.5' }).priority_order).toBe('integer');
    expect(validateBizumAccountForm({ ...valid, priority_order: '7' })).toEqual({});
  });

  it('allows 0 as "no cap" and rejects more than 2 decimals', () => {
    expect(validateBizumAccountForm({ ...valid, per_operation_limit: '0' })).toEqual({});
    expect(validateBizumAccountForm({ ...valid, per_operation_limit: '10.123' }).per_operation_limit).toBe('decimals');
  });
});

describe('accounts CRUD (direct table access under RLS)', () => {
  const ROW = { id: 'a1', account_name: 'Main', phone: '+34612345678' };
  const form = {
    account_name: ' Main ', holder_name: 'Juan', phone: '+34 612 345 678', bank_name: '', is_active: true,
    for_products: true, for_remittances: false, priority_order: '2', per_operation_limit: '500', notes: ' '
  };
  const expectedPayload = {
    account_name: 'Main', holder_name: 'Juan', phone: '+34612345678', bank_name: null, is_active: true,
    for_products: true, for_remittances: false, priority_order: 2, per_operation_limit: 500, notes: null
  };

  it('lists explicit columns ordered by priority', async () => {
    const chain = queryChain({ data: [ROW], error: null });
    supabaseMock.from.mockReturnValue(chain);
    await expect(listBizumAccounts()).resolves.toEqual([ROW]);
    expect(supabaseMock.from).toHaveBeenCalledWith('bizum_accounts');
    const columns = chain.select.mock.calls[0][0];
    expect(columns).toContain('phone');
    expect(columns).not.toContain('*');
    expect(chain.order).toHaveBeenCalledWith('priority_order', { ascending: true });
  });

  it('creates with a normalized, whitelisted payload (no created_by / id)', async () => {
    const chain = queryChain({ data: [ROW], error: null });
    supabaseMock.from.mockReturnValue(chain);
    await expect(createBizumAccount(form)).resolves.toEqual(ROW);
    expect(chain.insert).toHaveBeenCalledWith(expectedPayload);
  });

  const ORIGINAL = {
    id: 'a1', account_name: 'Main', holder_name: 'Juan', phone: '+34612345678', bank_name: null, is_active: true,
    for_products: true, for_remittances: false, priority_order: 2, per_operation_limit: '500.00', notes: null
  };

  it('creates with the exact whitelisted insert payload', async () => {
    const chain = queryChain({ data: [ROW], error: null });
    supabaseMock.from.mockReturnValue(chain);
    await createBizumAccount(form);
    expect(Object.keys(chain.insert.mock.calls[0][0]).sort()).toEqual(Object.keys(expectedPayload).sort());
    expect(chain.insert.mock.calls[0][0]).not.toHaveProperty('id');
    expect(chain.insert.mock.calls[0][0]).not.toHaveProperty('created_by');
  });

  it('update sends ONLY the modified fields, never is_active, and never id / created_by', async () => {
    const chain = queryChain({ data: [{ ...ROW, account_name: 'Renamed' }], error: null });
    supabaseMock.from.mockReturnValue(chain);
    const edited = {
      account_name: ' Renamed ', holder_name: 'Juan', phone: '+34 612 345 678', bank_name: '', is_active: false,
      for_products: true, for_remittances: false, priority_order: '2', per_operation_limit: '500', notes: ''
    };
    await updateBizumAccount('a1', edited, ORIGINAL);
    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith({ account_name: 'Renamed' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'a1');
    expect(chain.single).toBeUndefined();
  });

  it('update with several changes still omits is_active and unchanged fields (no lost update)', async () => {
    const chain = queryChain({ data: [ROW], error: null });
    supabaseMock.from.mockReturnValue(chain);
    await updateBizumAccount('a1', { ...form, for_remittances: true, per_operation_limit: '750', priority_order: '2', is_active: true }, ORIGINAL);
    const sent = chain.update.mock.calls[0][0];
    expect(sent).toEqual({ for_remittances: true, per_operation_limit: 750 });
    expect(sent).not.toHaveProperty('is_active');
  });

  it('update with no effective change does not touch the database', async () => {
    const result = await updateBizumAccount('a1', { ...form, account_name: 'Main', phone: '+34612345678', for_remittances: false, for_products: true, priority_order: '2', per_operation_limit: '500.00', notes: '' }, ORIGINAL);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(result).toEqual(ORIGINAL);
  });

  it('update treats an empty result as forbidden', async () => {
    supabaseMock.from.mockReturnValue(queryChain({ data: [], error: null }));
    await expect(updateBizumAccount('a1', { ...form, account_name: 'Other' }, ORIGINAL)).rejects.toMatchObject({ token: 'forbidden', schemaMissing: false });
  });

  it('setBizumAccountActive only touches is_active', async () => {
    const chain = queryChain({ data: [{ ...ROW, is_active: false }], error: null });
    supabaseMock.from.mockReturnValue(chain);
    await setBizumAccountActive('a1', false);
    expect(chain.update).toHaveBeenCalledWith({ is_active: false });
    expect(chain.eq).toHaveBeenCalledWith('id', 'a1');
  });

  it('exposes no delete operation', async () => {
    const service = await import('@/lib/bizumService');
    expect(Object.keys(service).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });

  it('surfaces duplicate phone as a phone field error without the phone in message or console', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    supabaseMock.from.mockReturnValue(queryChain({ data: null, error: PG_ERRORS.phoneDuplicate('+34612345678') }));
    const error = await createBizumAccount(form).catch((e) => e);
    expect(error).toBeInstanceOf(BizumError);
    expect(error.field).toBe('phone');
    expect(error.i18nKey).toBe('settings.bizum.errors.phoneDuplicate');
    expect(`${error.message}${error.stack}`).not.toContain('612345678');
    spies.forEach((spy) => expect(JSON.stringify(spy.mock.calls)).not.toContain('612345678'));
  });

  it('flags a missing schema on list', async () => {
    supabaseMock.from.mockReturnValue(queryChain({ data: null, error: PG_ERRORS.missingTable }));
    await expect(listBizumAccounts()).rejects.toMatchObject({ schemaMissing: true });
  });
});
