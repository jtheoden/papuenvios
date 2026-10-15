import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/components/SettingsPage.jsx'), 'utf8');

describe('SettingsPage mounts the Bizum section as a sibling of the Zelle tab', () => {
  it('imports and renders SettingsBizumSection right after SettingsZelleTab', () => {
    expect(page).toMatch(/import SettingsBizumSection from '@\/components\/settings\/SettingsBizumSection';/);
    expect(page).toMatch(/<SettingsZelleTab \/>\s*<SettingsBizumSection \/>/);
  });

  it('does not rename the internal zelle tab id', () => {
    expect(page).toContain("activeTab === 'zelle'");
  });
});
