import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BIZUM_SETTING_FIELDS } from '@/lib/bizumService';

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');

const NEW_FILES = [
  'src/lib/bizumErrors.js',
  'src/lib/bizumService.js',
  'src/lib/paymentFxService.js',
  'src/hooks/useAsyncResource.js',
  'src/components/settings/SettingsBizumSection.jsx',
  'src/components/settings/PaymentFxRateCard.jsx',
  'src/components/settings/BizumSettingsCard.jsx',
  'src/components/settings/BizumAccountsTable.jsx',
  'src/components/settings/BizumDialog.jsx',
  'src/components/settings/BizumField.jsx',
  'src/components/settings/BizumErrorBoundary.jsx',
  'src/lib/numberFormat.js'
];

describe('new Bizum front files', () => {
  it.each(NEW_FILES)('%s has no console.*, window.confirm, TODO/FIXME or language ternaries', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/window\.confirm|\bconfirm\(/);
    expect(source).not.toMatch(/TODO|FIXME/);
    expect(source).not.toMatch(/language\s*===/);
  });

  it('services never use .single()/.maybeSingle() (PGRST116 would read as a missing schema)', () => {
    for (const file of ['src/lib/bizumService.js', 'src/lib/paymentFxService.js']) {
      expect(read(file)).not.toMatch(/\.(single|maybeSingle)\(/);
    }
  });
});

describe('contract with the S3/S4 migrations', () => {
  const s3 = read('supabase/migrations/20261015120000_bizum_s3_currency_settings_fx_rates.sql');
  const s4 = read('supabase/migrations/20261015130000_bizum_s4_accounts.sql');

  it('mirrors every DEFAULT and CHECK range of bizum_settings', () => {
    for (const field of BIZUM_SETTING_FIELDS) {
      const column = s3.match(new RegExp(`^\\s+${field.key}\\s+\\S+\\s+NOT NULL DEFAULT ([0-9.]+)`, 'm'));
      expect(column, `default of ${field.key}`).not.toBeNull();
      expect(Number(column[1]), `default of ${field.key}`).toBe(field.default);

      const between = s3.match(new RegExp(`${field.key}_range CHECK \\(${field.key} BETWEEN ([0-9.]+) AND ([0-9.]+)\\)`));
      if (between) {
        expect(Number(between[1]), `min of ${field.key}`).toBe(field.min);
        expect(Number(between[2]), `max of ${field.key}`).toBe(field.max);
      } else {
        expect(field.key).toBe('default_per_operation_limit');
        expect(s3).toMatch(/default_per_operation_limit_range CHECK \(default_per_operation_limit > 0\)/);
      }
    }
  });

  it('uses the RPC names, parameter names and tokens the services call', () => {
    expect(s3).toMatch(/FUNCTION public\.get_bizum_settings\(\)/);
    expect(s3).toMatch(/FUNCTION public\.set_bizum_settings\(p_patch jsonb\)/);
    expect(s3).toMatch(/FUNCTION public\.get_payment_fx_status\(\)/);
    for (const param of ['p_mid numeric', 'p_spread numeric', 'p_source text', 'p_note text', 'p_confirm_large_change boolean']) {
      expect(s3).toContain(param);
    }
    const service = read('src/lib/paymentFxService.js') + read('src/lib/bizumService.js');
    for (const rpc of ['get_bizum_settings', 'set_bizum_settings', 'get_payment_fx_status', 'set_payment_fx_rate']) {
      expect(service).toContain(`'${rpc}'`);
    }
    for (const arg of ['p_patch', 'p_mid', 'p_spread', 'p_source', 'p_note', 'p_confirm_large_change']) {
      expect(service).toContain(arg);
    }
  });

  it('knows every error token raised by the migrations', () => {
    const errors = read('src/lib/bizumErrors.js');
    const raised = new Set([...s3.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]));
    ['bizum_accounts_immutable_columns', 'bizum_accounts_no_delete'].forEach((t) => {
      expect(s4).toContain(`'${t}'`);
      raised.add(t);
    });
    raised.delete('bizum_settings_no_delete');
    raised.delete('payment_fx_rates_append_only_never_reached');
    for (const token of raised) expect(errors, token).toContain(token);
  });

  it('mirrors the account constraints (phone regex, column list)', () => {
    expect(s4).toContain("phone ~ '^\\+[1-9][0-9]{7,14}$'");
    const service = read('src/lib/bizumService.js');
    for (const column of ['account_name', 'holder_name', 'phone', 'bank_name', 'is_active', 'for_products', 'for_remittances', 'priority_order', 'per_operation_limit', 'notes']) {
      expect(service).toContain(column);
    }
  });
});
