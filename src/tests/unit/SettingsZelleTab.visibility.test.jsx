import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';

const { toastMock, serviceMock, locale } = vi.hoisted(() => ({
  locale: { language: 'en' },
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
  useLanguage: () => ({
    t: (key) => key.split('.').reduce((value, part) => value?.[part], locale.language === 'es' ? ES : EN) ?? key,
    language: locale.language
  })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toastMock(...args) }));
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({
  default: ({ data, columns }) => <div>{data.map((account) => (
    <div key={account.id}>{columns.find((column) => column.key === 'actions').render(null, account)}</div>
  ))}</div>
}));
vi.mock('@/components/modals/TableDetailModal', () => ({ default: () => null }));
vi.mock('@/lib/zelleService', () => ({ zelleService: serviceMock }));
vi.mock('@/components/settings/ZelleAccountTableConfig', () => ({
  getZelleTableColumns: () => [],
  getZelleModalColumns: () => []
}));

import SettingsZelleTab from '@/components/settings/SettingsZelleTab';

const legacyAccount = {
  id: 'legacy', account_name: 'Main', account_holder: 'Juan', phone: '+15550001', email: 'a@b.com',
  show_email: true, show_phone: true, daily_limit: 0, monthly_limit: 0, security_limit: 0,
  priority_order: 1, is_active: true, for_products: true, for_remittances: true
};
const change = (placeholder, value) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
const openCreate = async () => {
  render(<SettingsZelleTab />);
  fireEvent.click(await screen.findByTitle('Create Account'));
  change(EN.zelle.accountNamePlaceholder, 'Main');
  change(EN.zelle.holderNamePlaceholder, 'Juan');
};
const openEdit = async (overrides = {}) => {
  serviceMock.getAllZelleAccounts.mockResolvedValue([{ ...legacyAccount, ...overrides }]);
  render(<SettingsZelleTab />);
  fireEvent.click(await screen.findByTitle('Edit'));
};
const save = () => fireEvent.click(screen.getByText('Save'));

describe('SettingsZelleTab account identifier', () => {
  beforeEach(() => {
    locale.language = 'en';
    toastMock.mockReset();
    Object.values(serviceMock).forEach((fn) => fn.mockReset());
    serviceMock.getAllZelleAccounts.mockResolvedValue([]);
    serviceMock.getZelleAccountUsageSummary.mockResolvedValue({});
    serviceMock.getZelleAccountHistoricalTotals.mockResolvedValue({});
    serviceMock.createZelleAccount.mockResolvedValue({ id: 'new' });
    serviceMock.updateZelleAccount.mockResolvedValue({ id: 'legacy' });
  });

  it('defaults new accounts to phone and labels email optional', async () => {
    await openCreate();
    expect(screen.getByRole('combobox', { name: 'Account identified by' })).toHaveValue('phone');
    expect(screen.getByLabelText('Email (optional)')).not.toBeRequired();
    expect(screen.getByLabelText('Phone Number *')).toBeRequired();
    expect(screen.queryByLabelText(EN.zelle.showEmail)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(EN.zelle.showPhone)).not.toBeInTheDocument();
  });

  it('saves with only phone and sends only database fields', async () => {
    await openCreate();
    change(EN.zelle.phoneNumberPlaceholder, '+15550001');
    save();
    await waitFor(() => expect(serviceMock.createZelleAccount).toHaveBeenCalledTimes(1));
    const payload = serviceMock.createZelleAccount.mock.calls[0][0];
    expect(payload).toMatchObject({ phone: '+15550001', email: null, contact_type: 'phone', show_email: false, show_phone: true });
    expect(payload).not.toHaveProperty('contactType');
  });

  it('switching to email makes email required and saves without phone', async () => {
    await openCreate();
    fireEvent.change(screen.getByRole('combobox', { name: 'Account identified by' }), { target: { value: 'email' } });
    expect(screen.getByLabelText('Email *')).toBeRequired();
    expect(screen.getByLabelText('Phone Number (optional)')).not.toBeRequired();
    save();
    expect(serviceMock.createZelleAccount).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: EN.zelle.emailRequired }));
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'pay@example.com' } });
    save();
    await waitFor(() => expect(serviceMock.createZelleAccount).toHaveBeenCalledWith(
      expect.objectContaining({ phone: null, email: 'pay@example.com', contact_type: 'email', show_email: true, show_phone: false })
    ));
  });

  it('blocks a missing required phone and validates an optional typed email', async () => {
    await openCreate();
    save();
    expect(serviceMock.createZelleAccount).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenLastCalledWith(expect.objectContaining({ description: EN.zelle.phoneRequired }));
    change(EN.zelle.phoneNumberPlaceholder, '+15550001');
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'invalid' } });
    save();
    expect(serviceMock.createZelleAccount).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenLastCalledWith(expect.objectContaining({ description: EN.zelle.invalidEmail }));
  });

  it.each([
    [{ show_email: false }, 'phone', 'Email (optional)'],
    [{ show_phone: false, phone: null }, 'email', 'Phone Number (optional)']
  ])('infers single-contact edits from flags: %j', async (flags, type, optionalLabel) => {
    await openEdit(flags);
    expect(screen.getByRole('combobox', { name: 'Account identified by' })).toHaveValue(type);
    expect(screen.getByLabelText(optionalLabel)).not.toBeRequired();
    save();
    await waitFor(() => expect(serviceMock.updateZelleAccount).toHaveBeenCalledWith('legacy', expect.objectContaining({ ...flags, phone: flags.phone === null ? null : legacyAccount.phone, contact_type: type }), expect.any(Object)));
  });

  it('editing a legacy both-visible account keeps both checkboxes and values', async () => {
    await openEdit();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText(EN.zelle.showEmail)).toBeChecked();
    expect(screen.getByLabelText(EN.zelle.showPhone)).toBeChecked();
    save();
    await waitFor(() => expect(serviceMock.updateZelleAccount).toHaveBeenCalledWith('legacy', expect.objectContaining({
      show_email: true, show_phone: true, phone: '+15550001', email: 'a@b.com'
    }), expect.any(Object)));
    expect(serviceMock.updateZelleAccount.mock.calls[0][1]).not.toHaveProperty('contact_type');
  });

  it('keeps legacy checkboxes after toggling and blocks both off', async () => {
    await openEdit();
    fireEvent.click(screen.getByLabelText(EN.zelle.showEmail));
    fireEvent.click(screen.getByLabelText(EN.zelle.showPhone));
    save();
    expect(serviceMock.updateZelleAccount).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: EN.zelle.atLeastOneVisible }));
    fireEvent.click(screen.getByLabelText(EN.zelle.showPhone));
    save();
    await waitFor(() => expect(serviceMock.updateZelleAccount).toHaveBeenCalledWith('legacy', expect.objectContaining({
      show_email: false, show_phone: true, contact_type: 'phone'
    }), expect.any(Object)));
  });

  it('preserves an unchanged hidden legacy phone during an unrelated edit', async () => {
    await openEdit({ show_phone: false, phone: '555.123.4567' });
    change(EN.zelle.accountNamePlaceholder, 'Renamed');
    save();
    await waitFor(() => expect(serviceMock.updateZelleAccount).toHaveBeenCalledWith('legacy', expect.objectContaining({
      account_name: 'Renamed', contact_type: 'email', phone: '555.123.4567'
    }), expect.objectContaining({ phone: '555.123.4567' })));
  });

  it('blocks a malformed hidden phone that the admin changed', async () => {
    await openEdit({ show_phone: false, phone: '555.123.4567' });
    change(EN.zelle.phoneNumberPlaceholder, '555.999.1234');
    save();
    expect(serviceMock.updateZelleAccount).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenLastCalledWith(expect.objectContaining({ description: EN.zelle.invalidPhone }));
  });

  it.each([
    [{ show_email: false, email: null }, 'email', 'phone', EN.zelle.emailRequired, 'Email (optional)', 'pay@example.com'],
    [{ show_phone: false, phone: null }, 'phone', 'email', EN.zelle.phoneRequired, 'Phone Number (optional)', '+15550001']
  ])('requires the new contact before switching type while editing: %s', async (flags, next, current, message, label, value) => {
    await openEdit(flags);
    const selector = screen.getByRole('combobox', { name: 'Account identified by' });
    fireEvent.change(selector, { target: { value: next } });
    expect(selector).toHaveValue(current);
    expect(toastMock).toHaveBeenLastCalledWith(expect.objectContaining({ description: message }));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(selector, { target: { value: next } });
    expect(selector).toHaveValue(next);
    save();
    await waitFor(() => expect(serviceMock.updateZelleAccount).toHaveBeenCalledWith('legacy', expect.objectContaining({ contact_type: next }), expect.any(Object)));
  });

  it('shows the optional label in natural Spanish', async () => {
    locale.language = 'es';
    render(<SettingsZelleTab />);
    fireEvent.click(await screen.findByTitle(ES.zelle.createAccount));
    expect(screen.getByRole('combobox', { name: 'Cuenta identificada por' })).toHaveValue('phone');
    expect(screen.getByLabelText(`${ES.common.email} (opcional)`)).not.toBeRequired();
  });
});
