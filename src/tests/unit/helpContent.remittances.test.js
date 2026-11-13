import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: commissionOverrideRules.js, commissionProposalRules.js, remittanceReadjustRules.js,
// RemittanceTypesConfig.jsx and migrations 20261105100000 / 20261111120000 / 20261112120000.
describe('remittance operational help', () => {
  const sections = getHelpSectionsForRole('super_admin');
  it.each(['es', 'en'])('limits the readjustment UI to Dashboard remittances in %s', (language) => {
    const dashboard = sections.find(({ id }) => id === getHelpSectionForPage('dashboard', 'remittances'));
    expect(dashboard.entries.some(({ id }) => id === 'remittance-readjust')).toBe(true);
    for (const page of ['dashboard', 'user-panel']) {
      const entry = sections.find(({ id }) => id === getHelpSectionForPage(page, 'remittances'))
        .entries.find(({ id }) => id === 'remittance-readjust');
      if (entry) expect(entry.answer[language]).toMatch(language === 'es'
        ? /solo en Dashboard → Remesas/i : /only in Dashboard → Remittances/i);
    }
  });
  it.each(['es', 'en'])('keeps the delivery amount when only status changes in %s', (language) => {
    const text = sections.find(({ id }) => id === getHelpSectionForPage('dashboard', 'remittances'))
      .entries.find(({ id }) => id === 'remittance-readjust').answer[language];
    expect(text).toMatch(language === 'es'
      ? /sin.*monto a entregar.*solo.*cambia.*enviado.*tasa.*comisión.*\(enviado − comisión\) × tasa/i
      : /without.*delivery amount.*only.*sent amount.*rate.*commission.*\(sent − commission\) × rate/i);
    expect(text).toMatch(language === 'es'
      ? /solo cambia el estado.*conserva.*monto.*guardado/i : /only the status changes.*stored.*amount.*kept/i);
  });
  it.each(['es', 'en'])('explains the separate transitions, frozen commission and readjustment in %s', (language) => {
    for (const page of ['dashboard', 'user-panel']) {
      const section = sections.find(({ id }) => id === getHelpSectionForPage(page, 'remittances'));
      expect(section.entries.length).toBeGreaterThanOrEqual(4);
      const text = section.entries.map(({ answer }) => answer[language]).join(' ');
      expect(text).toMatch(language === 'es' ? /solo.*payment_pending.*cancel/i : /only.*payment_pending.*cancel/i);
      expect(text).toMatch(language === 'es' ? /Validar.*no.*Procesar/ : /Validat.*does not.*Process/);
      expect(text).toMatch(language === 'es' ? /congela.*comprobante/ : /freezes.*proof/);
      expect(text).toMatch(language === 'es' ? /sube.*cliente.*aceptar/ : /increases.*customer.*accept/);
      expect(text).toMatch(language === 'es' ? /descuento.*oferta.*0/ : /offer discount.*0/);
      expect(text).toMatch(/super_admin/);
      expect(text).toMatch(language === 'es' ? /no.*recalcula.*mensajero/ : /does not.*recalculate.*courier/);
    }
  });
  it.each(['es', 'en'])('states who changes rates and who recalculates pending remittances in %s', (language) => {
    const text = sections.find(({ id }) => id === 'remittances').entries[0].answer[language];
    expect(text).toMatch(/super_admin/);
    expect(text).toMatch(language === 'es' ? /NO se recalculan automáticamente/ : /NOT automatically recalculated/);
    expect(text).toMatch(language === 'es' ? /cliente.*recalcular/ : /customer.*recalculate/);
    expect(text).toContain('payment_rejected');
  });
});
