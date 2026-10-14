import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const getForCustomerMock = vi.fn();
const toastMock = vi.fn();
const fromMock = vi.fn();
const channelMock = vi.fn();

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));

vi.mock('@/components/ui/use-toast', () => ({
  toast: (...args) => toastMock(...args)
}));

vi.mock('@/lib/zelleService', () => ({
  getZelleAccountsForCustomer: (...args) => getForCustomerMock(...args)
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    channel: (...args) => channelMock(...args)
  }
}));

import ZelleAccountSelector, { ZELLE_REFRESH_INTERVAL_MS } from '@/components/ZelleAccountSelector';

const acc = (over = {}) => ({
  id: 'a1',
  account_name: 'Main Account',
  account_holder: 'Ana',
  email: 'main@zelle.com',
  phone: null,
  priority_order: 1,
  is_active: true,
  ...over
});

describe('ZelleAccountSelector (RPC-based)', () => {
  beforeEach(() => {
    getForCustomerMock.mockReset();
    toastMock.mockReset();
    fromMock.mockReset();
    channelMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads accounts through getZelleAccountsForCustomer with the usage type', async () => {
    getForCustomerMock.mockResolvedValue([acc(), acc({ id: 'a2', account_name: 'Second', email: 'two@zelle.com' })]);

    render(<ZelleAccountSelector onSelect={vi.fn()} usageType="products" />);

    await waitFor(() => expect(screen.getAllByText('Main Account').length).toBeGreaterThan(0));
    expect(getForCustomerMock).toHaveBeenCalledWith('products');
    expect(screen.getAllByText('main@zelle.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('does not render an email the RPC returned as null (hidden by flag) and falls back to the phone', async () => {
    getForCustomerMock.mockResolvedValue([
      acc({ id: 'a1', email: null, phone: '+15550001' }),
      acc({ id: 'a2', account_name: 'Other', email: 'x@y.com', phone: null })
    ]);

    render(<ZelleAccountSelector onSelect={vi.fn()} usageType="remittances" />);

    await waitFor(() => expect(screen.getAllByText('Main Account').length).toBeGreaterThan(0));
    expect(getForCustomerMock).toHaveBeenCalledWith('remittances');
    expect(screen.getByText('+15550001')).toBeInTheDocument();
    expect(screen.queryByText('main@zelle.com')).not.toBeInTheDocument();
  });

  it('never queries zelle_accounts directly nor opens a realtime channel', async () => {
    getForCustomerMock.mockResolvedValue([acc()]);

    render(<ZelleAccountSelector onSelect={vi.fn()} usageType="products" />);

    await waitFor(() => expect(getForCustomerMock).toHaveBeenCalled());
    expect(fromMock).not.toHaveBeenCalled();
    expect(channelMock).not.toHaveBeenCalled();
  });

  it('auto-selects the only account', async () => {
    getForCustomerMock.mockResolvedValue([acc()]);
    const onSelect = vi.fn();

    render(<ZelleAccountSelector onSelect={onSelect} usageType="products" />);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' })));
  });

  describe('refresh', () => {
    it('polls on an interval and drops a selection that was deactivated', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getForCustomerMock.mockResolvedValueOnce([acc()]);
      const onSelect = vi.fn();

      render(<ZelleAccountSelector onSelect={onSelect} usageType="products" />);
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' })));

      // Admin deactivated the selected account: next refresh returns another one.
      getForCustomerMock.mockResolvedValue([acc({ id: 'a9', account_name: 'Replacement', email: 'r@z.com' }), acc({ id: 'a8', account_name: 'Another', email: 'o@z.com' })]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ZELLE_REFRESH_INTERVAL_MS + 50);
      });

      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'zelle.accountUnavailable' }));
      expect(screen.getByText('zelle.accountInvalidated')).toBeInTheDocument();
    });

    it('refetches when the window regains focus', async () => {
      getForCustomerMock.mockResolvedValue([acc(), acc({ id: 'a2', account_name: 'Second' })]);

      render(<ZelleAccountSelector onSelect={vi.fn()} usageType="products" />);
      await waitFor(() => expect(getForCustomerMock).toHaveBeenCalledTimes(1));

      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });

      await waitFor(() => expect(getForCustomerMock).toHaveBeenCalledTimes(2));
    });

    it('stops polling after unmount', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getForCustomerMock.mockResolvedValue([acc(), acc({ id: 'a2', account_name: 'Second' })]);

      const { unmount } = render(<ZelleAccountSelector onSelect={vi.fn()} usageType="products" />);
      await waitFor(() => expect(getForCustomerMock).toHaveBeenCalledTimes(1));
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ZELLE_REFRESH_INTERVAL_MS * 3);
      });
      expect(getForCustomerMock).toHaveBeenCalledTimes(1);
    });
  });
});
