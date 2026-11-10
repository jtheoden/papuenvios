import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: key => key }) }));
vi.mock('@/hooks/usePendingRemittances', () => ({
  usePendingRemittances: () => ({ remittances: [], loading: false, toProcessCount: 0, newCount: 0 })
}));
vi.mock('@/hooks/useRefundQueue', () => ({
  useRefundQueue: () => ({ refunds: [], loading: false, actionableCount: 2, overdueCount: 1, newCount: 0 })
}));
vi.mock('@/components/admin/AdminRemittancesInbox', () => ({ default: () => <div>remittances-inbox</div> }));
vi.mock('@/components/admin/AdminRefundsInbox', () => ({ default: () => <div>refunds-inbox</div> }));
import AdminWorkTabs from '@/components/admin/AdminWorkTabs';

const source = readFileSync('src/components/UserManagement.jsx', 'utf8');
const categories = source.slice(source.indexOf('const renderCategoriesTab'), source.indexOf('const renderCategoriesTab') + source.slice(source.indexOf('const renderCategoriesTab')).indexOf('\n  return ('));
const tab = key => screen.getByRole('tab', { name: new RegExp(key) });
const renderTabs = props => render(<AdminWorkTabs enabled ordersCount={2} {...props}><div>orders-card</div></AdminWorkTabs>);

describe('Categories theme chrome guard', () => {
  it('uses accent and on-accent tokens for the recalculate action', () => {
    expect(categories).toContain('bg-theme-accent hover:bg-theme-accent-hover text-theme-on-accent h-9');
    expect(categories).not.toContain('bg-blue-600 hover:bg-blue-700');
  });

  it('uses theme colours for both section icons without making labels into underlined links', () => {
    expect(categories).toContain('<BarChart3 className="w-5 h-5 text-[rgb(var(--t-link))]"');
    expect(categories).toContain('<Settings className="w-5 h-5 text-theme-accent-2"');
    expect(categories).not.toMatch(/\btext-theme-link(?:-strong)?\b/);
  });

  it('uses exact theme focus shades for discount edit controls', () => {
    expect(categories.match(/focus:ring-theme-focus/g)).toHaveLength(2);
    expect(categories).not.toContain('focus:ring-blue-500');
    // The unmatched Classic blue-300 switch ring is intentionally not approximated.
    expect(categories).toContain('peer-focus:ring-blue-300');
  });

  it('leaves category badges, custom rule colours, and active/discount semantics intact', () => {
    expect(categories).toContain('style={{ color: rule.color_code');
    expect(categories).toContain('<CategoryBadge categoryName={discount.category_name} readOnly />');
    expect(categories).toContain('bg-green-100 text-green-800');
    expect(categories).toContain('peer-checked:bg-green-600');
    expect(categories).toContain('font-semibold text-green-600');
  });
});

describe('Admin work tab theme and navigation', () => {
  beforeEach(() => window.history.replaceState({}, '', '/user-panel'));

  it('moves the accent chrome, roving focus and selected panel together using the keyboard', () => {
    renderTabs();
    const orders = tab('adminInbox.ordersTab');
    expect(orders.className).toContain('bg-theme-accent text-theme-on-accent');
    expect(orders.className).toContain('focus-visible:ring-[rgb(var(--t-link))]');
    fireEvent.keyDown(orders, { key: 'ArrowRight' });
    const remittances = tab('adminInbox.remittancesTab');
    expect(remittances.className).toContain('bg-theme-accent text-theme-on-accent');
    expect(orders.className).not.toContain('bg-theme-accent');
    expect(document.activeElement).toBe(remittances);
    expect(remittances.tabIndex).toBe(0);
    expect(orders.tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel').id).toBe(remittances.getAttribute('aria-controls'));
    expect(window.location.search).toBe('?tab=remittances');
  });

  it('retains refund urgency colours, deep links and keyboard wrapping', () => {
    window.history.replaceState({}, '', '/user-panel?tab=refunds');
    renderTabs();
    const refunds = tab('adminRefunds.tab');
    expect(refunds.className).toContain('bg-theme-accent text-theme-on-accent');
    expect(refunds.querySelector('.bg-red-50.text-red-800')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).getByText('refunds-inbox')).toBeTruthy();
    fireEvent.keyDown(refunds, { key: 'ArrowRight' });
    expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the non-admin content without rendering a tablist', () => {
    renderTabs({ enabled: false });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('orders-card')).toBeTruthy();
  });
});
