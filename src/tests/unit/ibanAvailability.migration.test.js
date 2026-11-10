import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
const service = readFileSync('src/lib/paymentMethodsService.js', 'utf8');

const migrationPath = `supabase/migrations/${readdirSync('supabase/migrations').find((name) => name.endsWith('_iban_sepa_unavailable.sql'))}`;

describe('IBAN/SEPA availability migration', () => {
  it('registers IBAN for both flows but keeps it unavailable and disabled', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toMatch(/payment_methods_code_check[\s\S]*?iban/i);
    expect(migration).toMatch(/remittances_payment_method_check[\s\S]*?iban/i);
    expect(migration).toMatch(/'iban',\s*false,\s*false,\s*false/i);
    expect(migration).not.toMatch(/'iban',\s*true/i);
  });

  it('exposes a stable method code for safe UI status references', () => {
    expect(service).toMatch(/IBAN:\s*'iban'/);
  });

  it('refuses rollback if IBAN was enabled or has remittance history', () => {
    const rollbackPath = `supabase/rollbacks/${readdirSync('supabase/rollbacks').find((name) => name.endsWith('_iban_sepa_unavailable_down.sql'))}`;
    const rollback = readFileSync(rollbackPath, 'utf8');
    expect(rollback).toMatch(/cannot_remove_live_iban_payment_method/);
    expect(rollback).toMatch(/cannot_remove_iban_with_remittance_history/);
  });

  it('shows a read-only EUR quote and explicitly blocked status in settings', () => {
    const settings = readFileSync('src/components/settings/SettingsPaymentsTab.jsx', 'utf8');
    const status = readFileSync('src/components/settings/SettingsIbanStatus.jsx', 'utf8');
    const badges = readFileSync('src/components/settings/EurPaymentRateBadges.jsx', 'utf8');
    expect(settings).toMatch(/id: 'iban',[\s\S]*?render: \(\) => <SettingsIbanStatus/);
    expect(settings).not.toMatch(/if \(ibanMethod\)/);
    expect(status).toMatch(/<EurPaymentRateBadges/);
    expect(badges).toMatch(/sourceCurrency="EUR"\s+targetCurrency="USD"/);
    expect(badges).toMatch(/sourceCurrency="EUR"\s+targetCurrency="CUP"/);
    expect(status).toMatch(/status|unavailable|notAvailable/i);
    expect(status).not.toMatch(/setPaymentMethodEnabled|toggle\(/);
  });
});
