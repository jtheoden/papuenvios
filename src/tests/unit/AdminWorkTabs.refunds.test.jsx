import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  remittances: { loading: false, error: null, toProcessCount: 0, newCount: 0 },
  refunds: { loading: false, error: null, actionableCount: 0, overdueCount: 0, newCount: 0 }
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));
vi.mock('@/hooks/usePendingRemittances', () => ({
  usePendingRemittances: () => ({
    remittances: [],
    refreshFailed: false,
    reload: vi.fn(),
    retry: vi.fn(),
    ...state.remittances
  })
}));
vi.mock('@/hooks/useRefundQueue', () => ({
  useRefundQueue: () => ({ refunds: [], refreshFailed: false, reload: vi.fn(), retry: vi.fn(), ...state.refunds })
}));
vi.mock('@/components/admin/AdminRemittancesInbox', () => ({ default: () => <div data-testid="remittances-inbox" /> }));
vi.mock('@/components/admin/AdminRefundsInbox', () => ({ default: () => <div data-testid="refunds-inbox" /> }));

import AdminWorkTabs from '@/components/admin/AdminWorkTabs';

const renderTabs = (props = {}) =>
  render(
    <AdminWorkTabs enabled ordersCount={2} onNavigate={() => {}} {...props}>
      <div data-testid="orders-card" />
    </AdminWorkTabs>
  );

const tab = (name) => screen.getByRole('tab', { name: new RegExp(name) });

describe('AdminWorkTabs: refunds tab', () => {
  beforeEach(() => {
    state.remittances = { loading: false, error: null, toProcessCount: 0, newCount: 0 };
    state.refunds = { loading: false, error: null, actionableCount: 0, overdueCount: 0, newCount: 0 };
    window.history.replaceState({}, '', '/user-panel');
  });

  it('adds Refunds as the LAST tab, always visible for admins', () => {
    renderTabs();
    expect(screen.getAllByRole('tab').map((n) => n.textContent.replace(/[0-9].*$/, ''))).toEqual([
      'adminInbox.ordersTab',
      'adminInbox.remittancesTab',
      'adminRefunds.tab'
    ].map((s) => s));
  });

  it('shows the actionable count with a screen-reader phrase, and no count while loading or failing', () => {
    state.refunds.actionableCount = 3;
    const { unmount } = renderTabs();
    expect(within(tab('adminRefunds.tab')).getByText('3')).toBeTruthy();
    expect(within(tab('adminRefunds.tab')).getByText('adminRefunds.tabCountSr|3')).toBeTruthy();
    unmount();

    state.refunds = { ...state.refunds, loading: true };
    renderTabs();
    expect(within(tab('adminRefunds.tab')).queryByText('3')).toBeNull();
  });

  it('flags overdue refunds on the tab with an icon chip and text for assistive tech', () => {
    state.refunds.actionableCount = 3;
    state.refunds.overdueCount = 2;
    renderTabs();
    const button = tab('adminRefunds.tab');
    expect(within(button).getByText('adminRefunds.tabCountOverdueSr|3|2')).toBeTruthy();
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.querySelector('.bg-red-50')).toBeTruthy();
  });

  it('opens the refunds panel on click, writes ?tab=refunds, and renders the inbox only then', () => {
    renderTabs();
    expect(screen.queryByTestId('refunds-inbox')).toBeNull();
    fireEvent.click(tab('adminRefunds.tab'));
    expect(screen.getByTestId('refunds-inbox')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('refunds');
    expect(tab('adminRefunds.tab').getAttribute('aria-selected')).toBe('true');
  });

  it('honours ?tab=refunds from the URL (dashboard link)', () => {
    window.history.replaceState({}, '', '/user-panel?tab=refunds');
    renderTabs();
    expect(screen.getByTestId('refunds-inbox')).toBeTruthy();
  });

  it('keyboard: ArrowRight walks orders, remittances, refunds and wraps; End goes to refunds', () => {
    renderTabs();
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(tab('adminInbox.remittancesTab').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(tab('adminRefunds.tab').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'End' });
    expect(tab('adminRefunds.tab').getAttribute('aria-selected')).toBe('true');
  });

  describe('default tab', () => {
    it('opens refunds when there are overdue ones and no orders or remittances to process', () => {
      state.refunds.overdueCount = 1;
      state.refunds.actionableCount = 1;
      renderTabs({ ordersCount: 0 });
      expect(tab('adminRefunds.tab').getAttribute('aria-selected')).toBe('true');
    });

    it('still prefers remittances when they have work', () => {
      state.refunds.overdueCount = 1;
      state.remittances.toProcessCount = 2;
      renderTabs({ ordersCount: 0 });
      expect(tab('adminInbox.remittancesTab').getAttribute('aria-selected')).toBe('true');
    });

    it('stays on orders when there are orders to process', () => {
      state.refunds.overdueCount = 1;
      renderTabs({ ordersCount: 4 });
      expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
    });

    it('does not open refunds when none are overdue (0 pending is not urgent)', () => {
      state.refunds.actionableCount = 2;
      renderTabs({ ordersCount: 0 });
      expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
    });

    it('waits for the refunds load before deciding', () => {
      state.refunds.loading = true;
      state.refunds.overdueCount = 1;
      renderTabs({ ordersCount: 0 });
      expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
    });

    it('never overrides a tab chosen by the URL', () => {
      window.history.replaceState({}, '', '/user-panel?tab=orders');
      state.refunds.overdueCount = 1;
      renderTabs({ ordersCount: 0 });
      expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
    });
  });

  it('renders the children untouched for non-admins, with no refund loading', () => {
    renderTabs({ enabled: false });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('orders-card')).toBeTruthy();
  });
});
