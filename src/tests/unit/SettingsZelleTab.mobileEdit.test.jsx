/**
 * Editing a Zelle account from a phone (< 640 px). The responsive table renders only the first two columns as a card
 * on a phone and never the actions column, so the Edit button did not exist there and tapping the card opened a generic
 * detail with no way to edit. Real ResponsiveTableWrapper and TableDetailModal are used on purpose: jsdom renders every
 * breakpoint, and the card path is the one under test.
 * Accessibility: touch targets of 44 px, accessible names that do not depend on the viewport, dialog semantics.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import EN from '@/translations/EN.json';

const service = vi.hoisted(() => ({
  getAllZelleAccounts: vi.fn(),
  getZelleAccountUsageSummary: vi.fn(),
  getZelleAccountHistoricalTotals: vi.fn(),
  createZelleAccount: vi.fn(),
  updateZelleAccount: vi.fn(),
  deleteZelleAccount: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => key.split('.').reduce((value, part) => value?.[part], EN) ?? key,
    language: 'en'
  })
}));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: { primaryColor: '#123456' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({ zelleService: service }));

import SettingsZelleTab from '@/components/settings/SettingsZelleTab';

const account = {
  id: 'z1', account_name: 'Main Zelle', account_holder: 'Juan Perez', phone: '+15550001', email: null,
  show_email: false, show_phone: true, daily_limit: 0, monthly_limit: 0, security_limit: 0,
  priority_order: 1, is_active: true, for_products: true, for_remittances: true, notes: ''
};

// The first match is the phone card (it comes first in the DOM); the click bubbles to the card's handler.
const tapCard = async () => fireEvent.click((await screen.findAllByText('Main Zelle'))[0]);

beforeEach(() => {
  vi.clearAllMocks();
  service.getAllZelleAccounts.mockResolvedValue([account]);
  service.getZelleAccountUsageSummary.mockResolvedValue({});
  service.getZelleAccountHistoricalTotals.mockResolvedValue({});
  service.updateZelleAccount.mockResolvedValue({ ...account });
});

describe('Zelle account edit reachable from a phone card', () => {
  it('tapping the card opens the Zelle detail with Edit and Delete actions', async () => {
    render(<SettingsZelleTab />);
    await tapCard();
    const detail = await screen.findByRole('dialog', { name: EN.zelle.accountDetails });
    expect(within(detail).getByRole('button', { name: EN.common.edit })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: EN.common.delete })).toBeTruthy();
  });

  it('Edit in the detail closes it and opens the edit form with the account data', async () => {
    render(<SettingsZelleTab />);
    await tapCard();
    const detail = await screen.findByRole('dialog', { name: EN.zelle.accountDetails });
    fireEvent.click(within(detail).getByRole('button', { name: EN.common.edit }));

    const form = await screen.findByRole('dialog', { name: EN.zelle.editAccount });
    expect(screen.queryByRole('dialog', { name: EN.zelle.accountDetails })).toBeNull();
    expect(within(form).getByDisplayValue('Main Zelle')).toBeTruthy();
    expect(within(form).getByDisplayValue('Juan Perez')).toBeTruthy();
  });

  it('saves an edit made from the phone', async () => {
    render(<SettingsZelleTab />);
    await tapCard();
    fireEvent.click(within(await screen.findByRole('dialog', { name: EN.zelle.accountDetails })).getByRole('button', { name: EN.common.edit }));
    const form = await screen.findByRole('dialog', { name: EN.zelle.editAccount });
    fireEvent.change(within(form).getByDisplayValue('Juan Perez'), { target: { value: 'Juan Perez Gil' } });
    fireEvent.click(within(form).getByRole('button', { name: EN.common.save }));
    await waitFor(() =>
      expect(service.updateZelleAccount).toHaveBeenCalledWith(
        'z1',
        expect.objectContaining({ account_holder: 'Juan Perez Gil' }),
        expect.objectContaining({ id: 'z1' })
      )
    );
  });
});

describe('Zelle accounts accessibility', () => {
  it('row action buttons have an accessible name and a 44 px touch target', async () => {
    render(<SettingsZelleTab />);
    await screen.findAllByText('Main Zelle');
    for (const name of ['View details', EN.common.edit, EN.common.delete]) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
    }
  });

  it('the edit form is a modal dialog named by its title, closes with Escape and has a named close button', async () => {
    render(<SettingsZelleTab />);
    fireEvent.click(await screen.findByRole('button', { name: EN.common.edit }));
    const form = await screen.findByRole('dialog', { name: EN.zelle.editAccount });
    expect(form.getAttribute('aria-modal')).toBe('true');
    expect(within(form).getByRole('button', { name: EN.common.close })).toBeTruthy();
    fireEvent.keyDown(form, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: EN.zelle.editAccount })).toBeNull());
  });

  it('Save and Cancel keep their names on a phone, where the visible text is a glyph', async () => {
    render(<SettingsZelleTab />);
    fireEvent.click(await screen.findByRole('button', { name: EN.common.edit }));
    const form = await screen.findByRole('dialog', { name: EN.zelle.editAccount });
    expect(within(form).getByRole('button', { name: EN.common.save })).toBeTruthy();
    expect(within(form).getByRole('button', { name: EN.common.cancel })).toBeTruthy();
  });

  it('the delete confirmation is a modal dialog named by its title', async () => {
    render(<SettingsZelleTab />);
    fireEvent.click(await screen.findByRole('button', { name: EN.common.delete }));
    const dialog = await screen.findByRole('dialog', { name: EN.zelle.confirmDelete });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
