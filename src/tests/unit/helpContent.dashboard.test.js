import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: dashboardMetrics.js (computeHeadline, getBusinessWindows, computeOrderProfit)
// and DashboardPage.jsx (visit windows and super-admin financial cards).
describe('dashboard financial help', () => {
  const section = getHelpSectionsForRole('super_admin').find(({ id }) => id === getHelpSectionForPage('dashboard', 'overview'));
  it.each(['es', 'en'])('defines the three non-additive headline figures in %s', (language) => {
    const text = section.entries.map(({ answer }) => answer[language]).join(' ');
    expect(section.entries.length).toBeGreaterThanOrEqual(4);
    expect(text).toMatch(language === 'es' ? /Ventas.*total.*pedidos/ : /Sales.*total.*orders/);
    expect(text).toMatch(language === 'es' ? /Cobrado.*remesas.*envío/ : /Collected.*remittances.*delivery/);
    expect(text).toMatch(language === 'es' ? /no se suman entre sí/ : /must not be added together/);
    expect(text).toMatch(language === 'es' ? /estimad/ : /estimat/);
    expect(text).toMatch(language === 'es' ? /excluye.*desconocido/i : /excludes.*unknown/);
    expect(text).not.toMatch(/movimientos manuales|manual entries/i);
  });
  it.each(['es', 'en'])('separates NY calendar finance from rolling visits in %s', (language) => {
    const text = section.entries.map(({ answer }) => answer[language]).join(' ');
    expect(text).toContain('America/New_York');
    expect(text).toMatch(language === 'es' ? /calendario.*validación.*no.*creación/ : /calendar.*validation.*not.*creation/);
    expect(text).toMatch(/7\/30\/365/);
    expect(text).toMatch(language === 'es' ? /móviles/ : /rolling/);
  });
});

describe('Zelle payment history help', () => {
  it.each(['es', 'en'])('distinguishes read-only filtered volume from payment evidence in %s', (language) => {
    // Sources: ZellePaymentHistoryTab.jsx, orderService.syncOrderZelleStatus,
    // remittanceService.syncRemittanceZelle (best-effort and account-id gated).
    const section = getHelpSectionsForRole('super_admin').find(({ id }) => id === getHelpSectionForPage('dashboard', 'zelle-history'));
    const text = section.entries.map(({ answer }) => answer[language]).join(' ');
    expect(text).toMatch(language === 'es' ? /solo lectura/i : /read-only/i);
    expect(text).toMatch(language === 'es' ? /total.*rechazados/i : /total.*rejected/i);
    expect(text).toMatch(language === 'es' ? /filtros.*USD/i : /filters.*USD/i);
    expect(text).toMatch(language === 'es' ? /ausente.*no.*prueba/i : /missing.*does not.*prove/i);
    expect(text).not.toMatch(/acotar el periodo|Filter the period/i);
  });
});
