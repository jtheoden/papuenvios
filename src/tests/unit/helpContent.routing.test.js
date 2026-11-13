import { describe, it, expect } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';

const ids = getHelpSectionsForRole('super_admin').map((section) => section.id);

describe('help section routing', () => {
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
