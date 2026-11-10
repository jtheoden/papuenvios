import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PaymentsTabs, { PAYMENTS_TAB_PARAM } from '@/components/settings/PaymentsTabs';

const bizumMounts = vi.fn();
const BizumContent = () => {
  React.useEffect(() => {
    bizumMounts();
  }, []);
  return <p>bizum-content</p>;
};

const makeTabs = (overrides = {}) => [
  { id: 'zelle', label: 'Zelle', render: () => <p>zelle-content</p> },
  { id: 'bizum', label: 'Bizum', render: () => <BizumContent />, ...overrides }
];

const setUrl = (search = '') => window.history.replaceState({}, '', `/${search}`);
const renderTabs = (tabs = makeTabs()) => render(<PaymentsTabs ariaLabel="Payment methods" tabs={tabs} />);
const tab = (name) => screen.getByRole('tab', { name });

beforeEach(() => {
  setUrl('');
  bizumMounts.mockReset();
});
afterEach(() => setUrl(''));

describe('PaymentsTabs semantics', () => {
  it('exposes a labelled tablist, tabs and tabpanels wired with aria-controls / aria-labelledby', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Payment methods' })).toBeInTheDocument();
    const zelle = tab('Zelle');
    const panel = document.getElementById(zelle.getAttribute('aria-controls'));
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', zelle.id);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('selects the first tab by default and hides the other panel', () => {
    renderTabs();

    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('zelle-content').closest('[role="tabpanel"]')).not.toHaveAttribute('hidden');
    expect(document.getElementById(tab('Bizum').getAttribute('aria-controls'))).toHaveAttribute('hidden');
  });

  it('uses a roving tabindex and 44px touch targets', () => {
    renderTabs();

    expect(tab('Zelle')).toHaveAttribute('tabindex', '0');
    expect(tab('Bizum')).toHaveAttribute('tabindex', '-1');
    screen.getAllByRole('tab').forEach((node) => expect(node.className).toContain('min-h-[44px]'));
  });

  it('renders a badge with text that is also available to screen readers', () => {
    renderTabs(makeTabs({ badge: { text: 'No rate', srText: 'Bizum has no exchange rate' } }));

    const bizum = screen.getByRole('tab', { name: /Bizum/ });
    expect(within(bizum).getByText('No rate')).toBeInTheDocument();
    expect(within(bizum).getByText('Bizum has no exchange rate')).toHaveClass('sr-only');
  });
});

describe('PaymentsTabs keyboard and pointer', () => {
  it('changes tab on click and updates the URL without a navigation', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    renderTabs();
    fireEvent.click(tab('Bizum'));

    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('bizum-content')).toBeVisible();
    expect(new URLSearchParams(window.location.search).get(PAYMENTS_TAB_PARAM)).toBe('bizum');
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it('ArrowRight / ArrowLeft move selection and focus, wrapping around', () => {
    renderTabs();
    tab('Zelle').focus();

    fireEvent.keyDown(tab('Zelle'), { key: 'ArrowRight' });
    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab('Bizum'));

    fireEvent.keyDown(tab('Bizum'), { key: 'ArrowRight' });
    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab('Zelle'));

    fireEvent.keyDown(tab('Zelle'), { key: 'ArrowLeft' });
    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'true');
  });

  it('Home and End jump to the first and last tab', () => {
    renderTabs();
    fireEvent.keyDown(tab('Zelle'), { key: 'End' });
    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab('Bizum'));

    fireEvent.keyDown(tab('Bizum'), { key: 'Home' });
    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab('Zelle'));
  });

  it('ignores other keys', () => {
    renderTabs();
    fireEvent.keyDown(tab('Zelle'), { key: 'a' });
    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('PaymentsTabs URL state', () => {
  it('opens the tab named by ?paymentsTab=', () => {
    setUrl('?paymentsTab=bizum');
    renderTabs();
    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab for an unknown value', () => {
    setUrl('?paymentsTab=nope');
    renderTabs();
    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab when the requested tab is not available', () => {
    setUrl('?paymentsTab=bizum');
    renderTabs([makeTabs()[0], { id: 'other', label: 'Other', render: () => <p>other</p> }]);
    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
  });

  it('honours a requested tab that only becomes available after the first render (async catalog)', () => {
    setUrl('?paymentsTab=bizum');
    const { rerender } = renderTabs([makeTabs()[0]]);
    expect(screen.getByText('zelle-content')).toBeVisible();

    rerender(<PaymentsTabs ariaLabel="Payment methods" tabs={makeTabs()} />);
    expect(tab('Bizum')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('bizum-content')).toBeVisible();
  });

  it('keeps unrelated query params and never uses localStorage', () => {
    setUrl('?foo=1');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderTabs();
    fireEvent.click(tab('Bizum'));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('foo')).toBe('1');
    expect(params.get(PAYMENTS_TAB_PARAM)).toBe('bizum');
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('PaymentsTabs mounting', () => {
  it('does not mount a tab until it has been visited, then keeps it mounted (hidden)', () => {
    renderTabs();
    expect(screen.queryByText('bizum-content')).toBeNull();
    expect(bizumMounts).not.toHaveBeenCalled();

    fireEvent.click(tab('Bizum'));
    expect(screen.getByText('bizum-content')).toBeInTheDocument();
    fireEvent.click(tab('Zelle'));

    expect(screen.getByText('bizum-content', { hidden: true })).not.toBeVisible();
    expect(bizumMounts).toHaveBeenCalledTimes(1);
  });

  it('with a single tab renders its content without a tablist', () => {
    renderTabs([makeTabs()[0]]);

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('zelle-content')).toBeInTheDocument();
  });

  it('renders nothing for an empty list', () => {
    const { container } = renderTabs([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to the first tab if the selected one disappears from the list', () => {
    const { rerender } = renderTabs();
    fireEvent.click(tab('Bizum'));

    rerender(<PaymentsTabs ariaLabel="Payment methods" tabs={[makeTabs()[0]]} />);
    expect(screen.getByText('zelle-content')).toBeVisible();

    rerender(<PaymentsTabs ariaLabel="Payment methods" tabs={makeTabs()} />);
    expect(tab('Zelle')).toHaveAttribute('aria-selected', 'true');
  });
});
