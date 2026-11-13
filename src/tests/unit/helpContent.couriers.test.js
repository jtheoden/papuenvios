import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: courierRules.js, PaymentTypeForm/PayablePanel/MarginThresholdsCard/ReportsPanel.jsx,
// courier migrations 20261031100000..120000 and 20261105150000..170000.
describe('courier cost help', () => {
  const sections = getHelpSectionsForRole('super_admin');
  const textFor = (tab, language) => sections.find(({ id }) => id === getHelpSectionForPage('settings', 'mensajeria', tab)).entries.map(({ answer }) => answer[language]).join(' ');
  it.each(['es', 'en'])('defines versioned cost rules, ranges and precedence in %s', (language) => {
    const text = textFor('types', language);
    for (const fact of [/USD/, /CUP/, /\(X,Y\]/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /reglas de costo por entrega/ : /delivery cost rules/);
    expect(text).toMatch(language === 'es' ? /versión.*vigencia/ : /version.*validity/);
    expect(text).toMatch(language === 'es' ? /mensajero.*zona.*tipo de remesa.*rango.*general/ : /courier.*zone.*remittance type.*range.*general/);
    expect(text).not.toMatch(/método de pago disponible para repartidores|payment methods available to couriers/);
  });
  it.each(['es', 'en'])('explains unknown costs, immutable payments and retroactive assignment in %s', (language) => {
    const text = textFor('payable', language);
    expect(text).toMatch(language === 'es' ? /desconocido no es cero/ : /unknown cost is not zero/);
    expect(text).toMatch(language === 'es' ? /no.*pagar.*desconocido/ : /cannot pay.*unknown/);
    expect(text).toMatch(language === 'es' ? /inmutable/ : /immutable/);
    expect(text).toMatch(/super_admin/);
    expect(text).toMatch(/10–500/);
    expect(text).toMatch(language === 'es' ? /vista previa.*meses anteriores/ : /preview.*past months/);
    expect(text).toMatch(language === 'es' ? /regla y tasa de ahora/ : /current rule and rate/);
  });
  it.each(['es', 'en'])('documents configurable margin alerts and CSV breakdown in %s', (language) => {
    const text = textFor('reports', language);
    expect(text).toContain('CSV');
    expect(text).toMatch(language === 'es' ? /vacíos.*sin alertas/ : /empty.*no alerts/i);
    expect(text).toMatch(language === 'es' ? /pagado.*pendiente.*anulado/ : /paid.*pending.*voided/);
  });
});
