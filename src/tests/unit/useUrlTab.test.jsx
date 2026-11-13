import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUrlTab } from '@/hooks/useUrlTab';

function TabProbe() {
  const [tab, selectTab] = useUrlTab(['overview', 'orders'], 'overview');
  return <button onClick={() => selectTab(tab === 'overview' ? 'orders' : 'overview')}>{tab}</button>;
}

describe('useUrlTab', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('restores the allowed tab from the current URL', () => {
    window.history.replaceState({}, '', '/dashboard?tab=orders');
    render(<TabProbe />);
    expect(screen.getByRole('button')).toHaveTextContent('orders');
  });

  it('falls back when the URL names a tab that is not allowed', () => {
    window.history.replaceState({}, '', '/dashboard?tab=hacked');
    render(<TabProbe />);
    expect(screen.getByRole('button')).toHaveTextContent('overview');
  });

  it('writes the selected tab to the URL without adding history entries', () => {
    window.history.replaceState({}, '', '/dashboard?tab=overview');
    const before = window.history.length;
    render(<TabProbe />);
    fireEvent.click(screen.getByRole('button'));
    expect(window.location.search).toContain('tab=orders');
    expect(window.history.length).toBe(before);
  });

  it('announces the change so the help assistant can follow the active tab', () => {
    window.history.replaceState({}, '', '/dashboard');
    const listener = vi.fn();
    window.addEventListener('admin-tab-change', listener);
    render(<TabProbe />);
    fireEvent.click(screen.getByRole('button'));
    window.removeEventListener('admin-tab-change', listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ param: 'tab', tab: 'orders' });
  });

  it('follows browser back/forward events', async () => {
    window.history.replaceState({}, '', '/dashboard?tab=overview');
    render(<TabProbe />);
    fireEvent.click(screen.getByRole('button'));
    window.history.replaceState({}, '', '/dashboard?tab=overview');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('overview'));
  });
});
