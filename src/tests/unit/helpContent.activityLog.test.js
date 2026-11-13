import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: activityLogger.fetchActivityLogs (filters execute on server before LIMIT),
// ActivityLogTab.jsx, legalConfig.js, 20260809000002_sec07_activity_logs_pii_ttl.sql,
// reset and bulk-delete migrations (no DELETE of activity_logs).
describe('activity log help', () => {
  const sections = getHelpSectionsForRole('super_admin');
  const section = sections.find(({ id }) => id === getHelpSectionForPage('dashboard', 'activity-log'));
  it.each(['es', 'en'])('documents retention, filtered row limit and actor privacy in %s', (language) => {
    expect(section.entries.length).toBeGreaterThanOrEqual(3);
    const text = section.entries.map(({ answer }) => answer[language]).join(' ');
    for (const fact of [/90/, /200/, /20/, /performed_by/, /super_admin/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /filtros.*servidor.*200/i : /filters.*server.*200/i);
    expect(text).toMatch(language === 'es' ? /performed_by.*no se redacta/i : /performed_by.*not redacted/i);
    expect(text).toMatch(language === 'es' ? /reset.*borrado masivo.*no.*borran/i : /reset.*bulk deletion.*do not.*erase/i);
    expect(text).not.toMatch(/filtrar no busca más allá|filtering cannot search beyond/i);
  });
  it('keeps every entry bilingual, uniquely identified within its section and searchable', () => {
    for (const item of sections) {
      expect(new Set(item.entries.map(({ id }) => id)).size, item.id).toBe(item.entries.length);
      for (const entry of item.entries) for (const language of ['es', 'en']) {
        expect(entry.question[language]?.trim(), `${item.id}/${entry.id} question ${language}`).toBeTruthy();
        expect(entry.answer[language]?.trim(), `${item.id}/${entry.id} answer ${language}`).toBeTruthy();
      }
    }
  });
});
