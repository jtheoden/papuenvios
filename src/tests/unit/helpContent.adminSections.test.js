import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

describe('super-admin contextual help', () => {
  it.each([
    ['settings', 'admin-settings'],
    ['dashboard', 'admin-dashboard'],
    ['admin', 'admin-dashboard'],
    ['user-management', 'admin-users'],
    ['user-panel', 'admin-user-panel']
  ])('maps %s to its guide', (page, section) => {
    expect(getHelpSectionForPage(page)).toBe(section);
  });

  it('keeps operational guides super-admin only and available in both languages', () => {
    const sections = getHelpSectionsForRole('super_admin');
    for (const id of ['admin-settings', 'admin-dashboard', 'admin-users', 'admin-user-panel']) {
      const section = sections.find(item => item.id === id);
      expect(section).toBeTruthy();
      expect(section.entries.length).toBeGreaterThan(0);
      for (const entry of section.entries) {
        expect(entry.question.es).toBeTruthy();
        expect(entry.question.en).toBeTruthy();
        expect(entry.answer.es).toBeTruthy();
        expect(entry.answer.en).toBeTruthy();
      }
    }
    expect(getHelpSectionsForRole('admin').some(item => item.id.startsWith('admin-'))).toBe(false);
    expect(getHelpSectionForPage('settings', 'mensajeria', 'payable')).toBe('context-settings-mensajeria-payable');
    expect(getHelpSectionForPage('settings', 'zelle', 'zelle')).toBe('context-settings-zelle-zelle');
    expect(getHelpSectionForPage('dashboard', 'remittance-types')).toBe('context-dashboard-remittance-types');
  });
});
