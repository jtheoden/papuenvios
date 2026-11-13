import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: orderService.js, OrderActionButtons.jsx, orderReadjustRules.js,
// stockPolicyService.js, 20261113120000_superadmin_readjust_order.sql.
describe('order and reservation help', () => {
  const sections = getHelpSectionsForRole('super_admin');
  it.each(['es', 'en'])('documents validation, cancellation and readjustment in %s', (language) => {
    for (const route of [['dashboard', 'orders'], ['user-panel', 'orders']]) {
      const section = sections.find(({ id }) => id === getHelpSectionForPage(...route));
      expect(section.entries.length).toBeGreaterThanOrEqual(4);
      const text = section.entries.map(({ answer }) => answer[language]).join(' ');
      expect(text).toMatch(language === 'es' ? /validar.*En proceso.*consume/i : /validat.*Processing.*consumes/i);
      expect(text).toMatch(/pending.*processing/);
      expect(text).toMatch(language === 'es' ? /devolución/ : /refund/);
      expect(text).toMatch(/super_admin/);
      expect(text).toMatch(/10–500/);
      expect(text).toMatch(language === 'es' ? /no.*reembolsa.*diferencia/i : /does not.*refund.*difference/i);
      expect(text).toMatch(language === 'es' ? /manual.*motivo/i : /manual.*reason/i);
    }
  });
  it.each(['es', 'en'])('fills inventory-reservations with real defaults and rejection behavior in %s', (language) => {
    const text = sections.find(({ id }) => id === 'catalog').entries.find(({ id }) => id === 'inventory-reservations').answer[language];
    for (const fact of [/48 h/, /168 h/, /5/, /super_admin/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /Rechazar.*NO libera/ : /Rejecting.*does NOT release/);
    expect(text).toMatch(language === 'es' ? /no.*automáticamente/ : /not.*automatically/);
  });
});
