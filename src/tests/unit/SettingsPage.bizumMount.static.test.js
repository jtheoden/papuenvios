import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const page = read('src/components/SettingsPage.jsx');
const payments = read('src/components/settings/SettingsPaymentsTab.jsx');

describe('SettingsPage mounts the payments tab, where Bizum is a sibling tab of Zelle', () => {
  it('renders SettingsPaymentsTab under the (unchanged) zelle tab id', () => {
    expect(page).toMatch(/import SettingsPaymentsTab from '@\/components\/settings\/SettingsPaymentsTab';/);
    expect(page).toContain("activeTab === 'zelle'");
    expect(page).toMatch(/<SettingsPaymentsTab onGoToFinancial=\{\(\) => setActiveTab\(.financiero.\)\} \/>/);
  });

  it('keeps Zelle and Bizum as separate tabs of PaymentsTabs, never nested', () => {
    expect(payments).toMatch(/import SettingsBizumSection from '@\/components\/settings\/SettingsBizumSection';/);
    expect(payments).toMatch(/<PaymentsTabs\b/);
    expect(payments).toMatch(/id: 'zelle'[\s\S]*render: \(\) => <SettingsZelleTab \/>/);
    expect(payments).toMatch(/id: 'bizum'[\s\S]*render: \(\) => <SettingsBizumSection onGoToFinancial=\{onGoToFinancial\} \/>/);
    expect(payments).not.toMatch(/<SettingsZelleTab \/>\s*<SettingsBizumSection \/>/);
  });

  it('keeps the status card above the tablist (it applies to both methods)', () => {
    expect(payments.indexOf('<PaymentMethodsStatusCard')).toBeGreaterThan(-1);
    expect(payments.indexOf('<PaymentMethodsStatusCard')).toBeLessThan(payments.indexOf('<PaymentsTabs'));
  });
});
