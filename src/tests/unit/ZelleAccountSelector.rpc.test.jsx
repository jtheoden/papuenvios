import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

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
    expect(getForCustomerMock).toHaveBeenCalledWith('products', undefined);
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
    expect(getForCustomerMock).toHaveBeenCalledWith('remittances', undefined);
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

  describe('advisory availability (amount)', () => {
    it('passes the amount to the customer list', async () => {
      getForCustomerMock.mockResolvedValue([acc()]);

      render(<ZelleAccountSelector onSelect={vi.fn()} usageType="products" amount={125.5} />);

      await waitFor(() => expect(getForCustomerMock).toHaveBeenCalledWith('products', 125.5));
    });

    it('shows a non-blocking warning for accounts with available === false and keeps them selectable', async () => {
      getForCustomerMock.mockResolvedValue([
        acc({ id: 'a1', account_name: 'Busy Account', available: false }),
        acc({ id: 'a2', account_name: 'Free Account', email: 'free@z.com', available: true })
      ]);
      const onSelect = vi.fn();

      render(<ZelleAccountSelector onSelect={onSelect} usageType="products" amount={500} />);

      await waitFor(() => expect(screen.getByText('Busy Account')).toBeInTheDocument());
      // Exactly one warning: only the unavailable account carries it.
      expect(screen.getAllByText('zelle.overLimitWarning')).toHaveLength(1);

      fireEvent.click(screen.getByText('Busy Account'));

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    });

    it('does not warn when available is true or not provided', async () => {
      getForCustomerMock.mockResolvedValue([
        acc({ id: 'a1', available: true }),
        acc({ id: 'a2', account_name: 'Second' })
      ]);

      render(<ZelleAccountSelector onSelect={vi.fn()} usageType="products" />);

      await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
      expect(screen.queryByText('zelle.overLimitWarning')).not.toBeInTheDocument();
    });
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
