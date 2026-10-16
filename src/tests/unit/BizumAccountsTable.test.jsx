import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { svcMock, toastMock } = vi.hoisted(() => ({
  svcMock: { createBizumAccount: vi.fn(), updateBizumAccount: vi.fn(), setBizumAccountActive: vi.fn() },
  toastMock: vi.fn()
}));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: { primaryColor: '#000' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));
vi.mock('@/lib/bizumService', async (importOriginal) => ({
  ...(await importOriginal()),
  createBizumAccount: (...a) => svcMock.createBizumAccount(...a),
  updateBizumAccount: (...a) => svcMock.updateBizumAccount(...a),
  setBizumAccountActive: (...a) => svcMock.setBizumAccountActive(...a)
}));

import BizumAccountsTable from '@/components/settings/BizumAccountsTable';
import { toBizumError } from '@/lib/bizumErrors';
import { PG_ERRORS } from './helpers/bizumTestUtils';

const PHONE = '+34612345678';
const ACCOUNT = {
  id: 'a1', account_name: 'Main Bizum', holder_name: 'Juan Perez', phone: PHONE, bank_name: 'BBVA', is_active: true,
  for_products: true, for_remittances: false, priority_order: 1, per_operation_limit: 500, notes: 'n'
};

let consoleSpies;
const renderTable = (props = {}) => {
  const onChanged = vi.fn();
  const onRetry = vi.fn();
  const utils = render(<BizumAccountsTable accounts={[ACCOUNT]} error={null} defaultLimit={750} onChanged={onChanged} onRetry={onRetry} {...props} />);
  return { ...utils, onChanged, onRetry };
};
const allConsoleOutput = () => JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls.map((c) => String(c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')))));

beforeEach(() => {
  Object.values(svcMock).forEach((fn) => fn.mockReset());
  toastMock.mockReset();
  svcMock.createBizumAccount.mockResolvedValue({ ...ACCOUNT, id: 'a2' });
  svcMock.updateBizumAccount.mockResolvedValue(ACCOUNT);
  svcMock.setBizumAccountActive.mockResolvedValue({ ...ACCOUNT, is_active: false });
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

const openCreate = () => fireEvent.click(screen.getByRole('button', { name: 'settings.bizum.accounts.create' }));
const fillCreate = (over = {}) => {
  const values = { account_name: 'Second', holder_name: 'Ana', phone: '+34 600 111 222', ...over };
  fireEvent.change(screen.getByLabelText('settings.bizum.accounts.fields.account_name'), { target: { value: values.account_name } });
  fireEvent.change(screen.getByLabelText('settings.bizum.accounts.fields.holder_name'), { target: { value: values.holder_name } });
  fireEvent.change(screen.getByLabelText('settings.bizum.accounts.fields.phone'), { target: { value: values.phone } });
};

describe('BizumAccountsTable listing', () => {
  it('shows the masked phone and never the full number in the DOM or console', () => {
    renderTable();
    expect(screen.getAllByText('+34 ••• ••• 678').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('612345');
    expect(allConsoleOutput()).not.toContain('612345');
  });

  it('has no delete button, only edit and deactivate', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: /delete|eliminar|borrar/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'settings.bizum.accounts.edit' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'settings.bizum.accounts.deactivate' }).length).toBeGreaterThan(0);
  });

  it('shows the empty state and an error state with retry', () => {
    const { onRetry, unmount } = renderTable({ accounts: [], error: toBizumError({ code: 'XX000', message: 'boom' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('settings.bizum.errors.unknown');
    fireEvent.click(screen.getByRole('button', { name: 'settings.bizum.retry' }));
    expect(onRetry).toHaveBeenCalled();
    unmount();
    renderTable({ accounts: [] });
    expect(screen.getByText('settings.bizum.accounts.empty')).toBeInTheDocument();
  });
});

describe('BizumAccountsTable create', () => {
  it('suggests default_per_operation_limit from the settings for a new account', () => {
    renderTable();
    openCreate();
    expect(screen.getByLabelText('settings.bizum.accounts.fields.per_operation_limit')).toHaveValue('750');
  });

  it('rejects a non E.164 phone on the client and does not call the server', () => {
    renderTable();
    openCreate();
    fillCreate({ phone: '612345678' });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(svcMock.createBizumAccount).not.toHaveBeenCalled();
    const phone = screen.getByLabelText('settings.bizum.accounts.fields.phone');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    const ids = phone.getAttribute('aria-describedby').split(' ');
    expect(ids.some((id) => document.getElementById(id)?.textContent.includes('settings.bizum.accounts.validation.invalid'))).toBe(true);
  });

  it('sends the form to createBizumAccount, reloads and closes the dialog', async () => {
    const { onChanged } = renderTable();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(svcMock.createBizumAccount).toHaveBeenCalledTimes(1));
    expect(svcMock.createBizumAccount).toHaveBeenCalledWith(
      expect.objectContaining({ account_name: 'Second', holder_name: 'Ana', phone: '+34 600 111 222', per_operation_limit: '750', is_active: true })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(allConsoleOutput()).not.toContain('600111222');
  });

  it('shows a duplicate-phone error on the phone field without exposing the number', async () => {
    svcMock.createBizumAccount.mockRejectedValue(toBizumError(PG_ERRORS.phoneDuplicate('+34600111222')));
    renderTable();
    openCreate();
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    const phone = screen.getByLabelText('settings.bizum.accounts.fields.phone');
    await waitFor(() => expect(phone).toHaveAttribute('aria-invalid', 'true'));
    const ids = phone.getAttribute('aria-describedby').split(' ');
    expect(ids.some((id) => document.getElementById(id)?.textContent.includes('settings.bizum.errors.phoneDuplicate'))).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(allConsoleOutput()).not.toContain('600111222');
    expect(document.body.textContent).not.toContain('Key (phone)');
  });
});

describe('BizumAccountsTable edit and activation', () => {
  it('edits an account with the full phone prefilled and updates by id', async () => {
    const { onChanged } = renderTable();
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.bizum.accounts.edit' })[0]);
    const phone = screen.getByLabelText('settings.bizum.accounts.fields.phone');
    expect(phone).toHaveValue(PHONE);
    fireEvent.change(screen.getByLabelText('settings.bizum.accounts.fields.account_name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(svcMock.updateBizumAccount).toHaveBeenCalledTimes(1));
    expect(svcMock.updateBizumAccount.mock.calls[0][0]).toBe('a1');
    expect(svcMock.updateBizumAccount.mock.calls[0][1]).toMatchObject({ account_name: 'Renamed', phone: PHONE });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('deactivates only after confirming in an own dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChanged } = renderTable();
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.bizum.accounts.deactivate' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(svcMock.setBizumAccountActive).not.toHaveBeenCalled();
    expect(within(dialog).getByText('settings.bizum.accounts.deactivateConfirm.title')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.bizum.accounts.deactivateConfirm.confirm' }));
    await waitFor(() => expect(svcMock.setBizumAccountActive).toHaveBeenCalledWith('a1', false));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    renderTable();
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.bizum.accounts.deactivate' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(svcMock.setBizumAccountActive).not.toHaveBeenCalled();
  });

  it('offers activation for an inactive account and also confirms it', async () => {
    renderTable({ accounts: [{ ...ACCOUNT, is_active: false }] });
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.bizum.accounts.activate' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.bizum.accounts.activateConfirm.confirm' }));
    await waitFor(() => expect(svcMock.setBizumAccountActive).toHaveBeenCalledWith('a1', true));
  });

  it('opens the edit dialog from the row (mobile card) which also exposes the activation toggle', async () => {
    renderTable();
    fireEvent.click(screen.getAllByText('Main Bizum')[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'settings.bizum.accounts.deactivate' })).toBeInTheDocument();
  });
});

describe('BizumAccountsTable hardening', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const fillValidCreate = () => {
    openCreate();
    fillCreate();
  };

  it('passes the original row to updateBizumAccount so only changed fields are sent', async () => {
    renderTable();
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.bizum.accounts.edit' })[0]);
    fireEvent.change(screen.getByLabelText('settings.bizum.accounts.fields.account_name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(svcMock.updateBizumAccount).toHaveBeenCalledTimes(1));
    expect(svcMock.updateBizumAccount.mock.calls[0][2]).toEqual(ACCOUNT);
  });

  it('Save is a real submit button bound to the form, so Enter in a field saves once', async () => {
    renderTable();
    fillValidCreate();
    const save = screen.getByRole('button', { name: 'common.save' });
    expect(save).toHaveAttribute('type', 'submit');
    const form = document.getElementById(save.getAttribute('form'));
    expect(form).not.toBeNull();
    expect(form.tagName).toBe('FORM');
    fireEvent.submit(form);
    await waitFor(() => expect(svcMock.createBizumAccount).toHaveBeenCalledTimes(1));
  });

  it('a double submit while the request is in flight creates only one account', async () => {
    const gate = deferred();
    svcMock.createBizumAccount.mockReturnValue(gate.promise);
    renderTable();
    fillValidCreate();
    const form = document.getElementById(screen.getByRole('button', { name: 'common.save' }).getAttribute('form'));
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(svcMock.createBizumAccount).toHaveBeenCalledTimes(1);
    gate.resolve({ ...ACCOUNT, id: 'a9' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not close the form with Escape while saving', async () => {
    const gate = deferred();
    svcMock.createBizumAccount.mockReturnValue(gate.promise);
    renderTable();
    fillValidCreate();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(svcMock.createBizumAccount).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    gate.resolve({ ...ACCOUNT, id: 'a9' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves focus to the first invalid field and keeps persistent aria-live containers', () => {
    renderTable();
    openCreate();
    for (const id of ['bizum-account-account_name-error', 'bizum-account-phone-error']) {
      const region = document.getElementById(id);
      expect(region, id).not.toBeNull();
      expect(region).toBeEmptyDOMElement();
    }
    fillCreate({ phone: '123' });
    // Radix focuses the first field on open: park the focus elsewhere so only the code can move it.
    screen.getByLabelText('settings.bizum.accounts.fields.notes').focus();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(screen.getByLabelText('settings.bizum.accounts.fields.phone')).toHaveFocus();
  });

  it('offers a real per-row edit button (keyboard operable) that opens the dialog', async () => {
    renderTable();
    const buttons = screen.getAllByRole('button', { name: 'settings.bizum.accounts.edit: Main Bizum' });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  describe('Deactivate inside the edit dialog', () => {
    const openEditAndDeactivate = async (dirty) => {
      renderTable();
      fireEvent.click(screen.getAllByRole('button', { name: 'settings.bizum.accounts.edit' })[0]);
      if (dirty) fireEvent.change(screen.getByLabelText('settings.bizum.accounts.fields.account_name'), { target: { value: 'Draft name' } });
      const editDialog = screen.getByRole('dialog');
      fireEvent.click(within(editDialog).getByRole('button', { name: 'settings.bizum.accounts.deactivate' }));
      return screen.findByText('settings.bizum.accounts.deactivateConfirm.title');
    };

    it('warns that unsaved changes are discarded and keeps the draft if cancelled', async () => {
      await openEditAndDeactivate(true);
      expect(screen.getByText('settings.bizum.accounts.discardDraftWarning')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
      await waitFor(() => expect(screen.queryByText('settings.bizum.accounts.deactivateConfirm.title')).toBeNull());
      expect(screen.getByLabelText('settings.bizum.accounts.fields.account_name')).toHaveValue('Draft name');
    });

    it('shows no warning when there is nothing unsaved', async () => {
      await openEditAndDeactivate(false);
      expect(screen.queryByText('settings.bizum.accounts.discardDraftWarning')).toBeNull();
    });

    it('closes the edit dialog too once the deactivation is confirmed', async () => {
      await openEditAndDeactivate(true);
      fireEvent.click(screen.getByRole('button', { name: 'settings.bizum.accounts.deactivateConfirm.confirm' }));
      await waitFor(() => expect(svcMock.setBizumAccountActive).toHaveBeenCalledWith('a1', false));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
