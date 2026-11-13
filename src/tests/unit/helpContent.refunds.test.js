import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: refundWindow.js, refundRules.js, refund_resolve_with_proof.sql,
// refund_triggers.sql, RefundProofsMaintenance.jsx, RefundDisputeControl.jsx.
describe('refund work queue help', () => {
  const section = getHelpSectionsForRole('super_admin').find(({ id }) => id === getHelpSectionForPage('user-panel', 'refunds'));
  it.each(['es', 'en'])('bounds the manual refund date by eligibility and the current time in %s', (language) => {
    const text = section.entries.find(({ id }) => id === 'refund-manual-proof').answer[language];
    expect(text).toMatch(language === 'es' ? /fecha entre el fin de las 48 h y hoy/i : /date between the end of the 48 h wait and now/i);
  });
  it.each(['es', 'en'])('states the confirmed super-admin own-refund exception plainly in %s', (language) => {
    const text = section.entries.find(({ id }) => id === 'refund-own-operation').answer[language];
    expect(text).toMatch(language === 'es'
      ? /Excepción: super_admin puede.*propia.*confirmación explícita/i
      : /Exception: super_admin can.*own.*explicit confirmation/i);
    expect(text).not.toMatch(/excepción del código|code exception/i);
    expect(text).toMatch(language === 'es' ? /No permite abrir ni cerrar una disputa propia/i : /does not allow opening or closing their own dispute/i);
  });
  it.each(['es', 'en'])('explains eligibility, manual resolution and retention in %s', (language) => {
    expect(section.entries.length).toBeGreaterThanOrEqual(5);
    const text = section.entries.map(({ answer }) => answer[language]).join(' ');
    for (const fact of [/48 h/, language === 'es' ? /5 días hábiles/ : /5 business days/, /America\/New_York/, /Zelle/, /JPG\/PNG\/WebP\/PDF/, /5 MB/, /super_admin/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /comprobante obligatorio/ : /mandatory proof/);
    expect(text).toMatch(language === 'es' ? /Sin pago ni comprobante no se crea solicitud/i : /no.*payment.*no.*request/i);
    expect(text).toMatch(language === 'es' ? /disputa abierta.*impide.*purga/i : /open dispute.*blocks.*purge/i);
    expect(text).not.toMatch(/super_admin único|sole super_admin/);
    for (const item of section.entries) {
      expect(item.question[language].trim()).not.toBe('');
      expect(item.answer[language].trim()).not.toBe('');
    }
  });
});
