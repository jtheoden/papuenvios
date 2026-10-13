import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastMock, serviceMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  serviceMock: {
    getAllZelleAccounts: vi.fn(),
    getZelleAccountUsageSummary: vi.fn(),
    getZelleAccountHistoricalTotals: vi.fn(),
    createZelleAccount: vi.fn(),
    updateZelleAccount: vi.fn()
  }
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: { primaryColor: '#000' } })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toastMock(...args) }));
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({ default: () => null }));
vi.mock('@/components/modals/TableDetailModal', () => ({ default: () => null }));
vi.mock('@/lib/zelleService', () => ({ zelleService: serviceMock }));
vi.mock('@/components/settings/ZelleAccountTableConfig', () => ({
  getZelleTableColumns: () => [],
  getZelleModalColumns: () => []
}));

import SettingsZelleTab from '@/components/settings/SettingsZelleTab';

const openCreateFormAndFill = async () => {
  render(<SettingsZelleTab />);
  const createButton = await screen.findByTitle('zelle.createAccount');
  fireEvent.click(createButton);
  fireEvent.change(screen.getByPlaceholderText('zelle.accountNamePlaceholder'), { target: { value: 'Main' } });
  fireEvent.change(screen.getByPlaceholderText('zelle.phoneNumberPlaceholder'), { target: { value: '+15550001' } });
  fireEvent.change(screen.getByPlaceholderText('zelle.holderNamePlaceholder'), { target: { value: 'Juan' } });
  fireEvent.change(screen.getByPlaceholderText('zelle.emailPlaceholder'), { target: { value: 'a@b.com' } });
};

describe('SettingsZelleTab contact visibility toggles', () => {
  beforeEach(() => {
    toastMock.mockReset();
    Object.values(serviceMock).forEach((fn) => fn.mockReset());
    serviceMock.getAllZelleAccounts.mockResolvedValue([]);
    serviceMock.getZelleAccountUsageSummary.mockResolvedValue([]);
    serviceMock.getZelleAccountHistoricalTotals.mockResolvedValue([]);
    serviceMock.createZelleAccount.mockResolvedValue({ id: 'new' });
  });

  it('shows both toggles on by default', async () => {
    await openCreateFormAndFill();
    expect(screen.getByLabelText('zelle.showEmail')).toBeChecked();
    expect(screen.getByLabelText('zelle.showPhone')).toBeChecked();
  });

  it('blocks the save with a message when both toggles are off', async () => {
    await openCreateFormAndFill();
    fireEvent.click(screen.getByLabelText('zelle.showEmail'));
    fireEvent.click(screen.getByLabelText('zelle.showPhone'));
    fireEvent.click(screen.getByText('common.save'));

    expect(serviceMock.createZelleAccount).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'zelle.atLeastOneVisible', variant: 'destructive' })
    );
  });

  it('saves with independent flags when at least one is visible', async () => {
    await openCreateFormAndFill();
    fireEvent.click(screen.getByLabelText('zelle.showPhone'));
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(serviceMock.createZelleAccount).toHaveBeenCalledTimes(1));
    expect(serviceMock.createZelleAccount).toHaveBeenCalledWith(
      expect.objectContaining({ show_email: true, show_phone: false })
    );
  });
});
