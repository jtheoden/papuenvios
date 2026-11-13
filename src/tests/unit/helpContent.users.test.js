import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

// Sources: UserPanel/AdminWorkTabs/UserManagement/UserStatusAction.jsx,
// userStatusService.js, AuthContext.jsx, selfDealing.js and orderService.js.
describe('admin queue and user access help', () => {
  const sections = getHelpSectionsForRole('super_admin');
  it.each(['es', 'en'])('describes the admin work queue, own operations and conflicts in %s', (language) => {
    const text = sections.find(({ id }) => id === getHelpSectionForPage('user-panel')).entries.map(({ answer }) => answer[language]).join(' ');
    expect(text).toMatch(language === 'es' ? /cola de trabajo.*pedidos.*remesas.*devoluciones/i : /work queue.*orders.*remittances.*refunds/i);
    expect(text).toContain('CONFLICT');
    expect(text).toMatch(language === 'es' ? /otro administrador/ : /another administrator/);
    expect(text).toMatch(language === 'es' ? /no.*propia/i : /cannot.*own/);
    expect(text).not.toMatch(/sin validar pagos ni cambiar datos en nombre del usuario|without validating payments or changing data on the user’s behalf/);
  });
  it.each(['es', 'en'])('explains disabling and role restrictions in %s', (language) => {
    const section = sections.find(({ id }) => id === getHelpSectionForPage('user-management', 'users'));
    expect(section.entries.length).toBeGreaterThanOrEqual(3);
    const text = section.entries.map(({ answer }) => answer[language]).join(' ');
    expect(text).toMatch(/3–500/);
    expect(text).toMatch(language === 'es' ? /mínimo.*5 min.*entre lecturas/i : /minimum.*5 min.*between reads/i);
    expect(text).toMatch(language === 'es' ? /renovar el token.*aproximadamente cada hora.*volver a la pestaña/i : /token refresh.*about hourly.*returning to the tab/i);
    expect(text).toMatch(language === 'es' ? /base de datos.*bloquea.*inmediatamente/i : /database.*blocks.*immediately/i);
    expect(text).not.toMatch(/hasta 5 min|up to 5 min/i);
    expect(text).toMatch(language === 'es' ? /último super_admin/ : /last super_admin/);
    expect(text).toMatch(language === 'es' ? /super_admin no.*asigna.*UI/ : /super_admin cannot.*assigned.*UI/);
    expect(text).toMatch(language === 'es' ? /admin.*solo lectura/i : /admin.*read-only/i);
    expect(text).toMatch(language === 'es' ? /no.*ti mismo/i : /not.*yourself/);
  });
});
