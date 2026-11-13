import { describe, it, expect } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

const ids = getHelpSectionsForRole('super_admin').map((section) => section.id);

describe('help section routing', () => {
  it('accounts for every contextual guide using real page/tab/detail routes', () => {
    // Real tabs: SettingsPage, DashboardPage, AdminPage/UserManagement,
    // AdminWorkTabs; detail tabs: CourierTabs and SettingsPaymentsTab.
    const routes = [
      ...['financiero', 'envios', 'visual', 'zelle', 'mensajeria', 'contenido', 'sistema'].map(tab => ['settings', tab]),
      ...['zelle', 'bizum', 'iban'].map(detail => ['settings', 'zelle', detail]),
      ...['couriers', 'types', 'payable', 'reports'].map(detail => ['settings', 'mensajeria', detail]),
      ...['overview', 'orders', 'remittances', 'remittance-types', 'offers', 'activity-log', 'zelle-history'].map(tab => ['dashboard', tab]),
      ...['inventory', 'categories', 'combos', 'management'].map(tab => ['admin', tab]),
      ...['users', 'categories'].map(tab => ['user-management', tab]),
      ...['orders', 'remittances', 'refunds'].map(tab => ['user-panel', tab])
    ];
    // Category-only help: Notifications lives inside Content, Stock policy inside
    // System (neither has a sub-tab). settings-payments is an entry in the
    // admin-settings category, not a context guide or a real `payments` tab.
    const categoryOnly = new Set([
      'context-settings-notifications',
      'context-settings-stock-policy',
      'settings-payments'
    ]);
    const reachable = new Set(routes.map(route => getHelpSectionForPage(...route)));
    for (const id of ids.filter(id => id.startsWith('context-'))) {
      expect(reachable.has(id) || categoryOnly.has(id), `unreachable guide ${id}`).toBe(true);
    }
  });

  it('does not special-case unused payments/pagos tab ids', () => {
    // Source/test search found no page using either id; real Payments is `zelle`.
    for (const tab of ['payments', 'pagos']) {
      expect(getHelpSectionForPage('settings', tab)).toBe(`context-settings-${tab}`);
    }
  });

  it('opens the guide that matches each real Dashboard tab id', () => {
    ['overview', 'orders', 'remittances', 'remittance-types', 'offers', 'activity-log', 'zelle-history'].forEach((tab) => {
      expect(ids, `dashboard tab ${tab}`).toContain(getHelpSectionForPage('dashboard', tab));
    });
  });

  it('opens the guide that matches each real Settings tab id', () => {
    ['financiero', 'envios', 'visual', 'zelle', 'mensajeria', 'contenido', 'sistema'].forEach((tab) => {
      expect(ids, `settings tab ${tab}`).toContain(getHelpSectionForPage('settings', tab));
    });
  });

  it('opens the guide that matches each real catalog tab id', () => {
    ['inventory', 'categories', 'combos', 'management'].forEach((tab) => {
      expect(ids, `admin tab ${tab}`).toContain(getHelpSectionForPage('admin', tab));
    });
  });

  it('maps the user-panel refunds tab to the returns guide', () => {
    expect(getHelpSectionForPage('user-panel', 'refunds')).toBe('context-user-panel-returns');
    expect(getHelpSectionForPage('user-panel', 'orders')).toBe('context-user-panel-orders');
    expect(getHelpSectionForPage('user-panel', 'remittances')).toBe('context-user-panel-remittances');
  });

  it('falls back to the catalog guide, not the dashboard one, on the catalog page without a tab', () => {
    expect(getHelpSectionForPage('admin')).toBe('catalog');
    expect(ids).toContain('catalog');
  });

  it('keeps the dashboard fallback for the dashboard page and null for unknown pages', () => {
    expect(getHelpSectionForPage('dashboard')).toBe('admin-dashboard');
    expect(getHelpSectionForPage('home')).toBeNull();
  });
});
