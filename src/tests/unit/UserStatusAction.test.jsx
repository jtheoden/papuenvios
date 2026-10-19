import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const translate = (key, params = {}) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: 'es' })
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));

const setUserEnabledMock = vi.fn();
vi.mock('@/lib/userStatusService', async () => {
  const actual = await vi.importActual('@/lib/userStatusService');
  return { ...actual, setUserEnabled: (...a) => setUserEnabledMock(...a) };
});

import UserStatusAction from '@/components/admin/UserStatusAction';
import { UserStatusError, USER_STATUS_ERROR } from '@/lib/userStatusService';

const TARGET = { id: 'u-2', email: 'cliente@example.test', role: 'user', is_enabled: true };
const DISABLED = { ...TARGET, is_enabled: false, disabled_reason: 'fraud' };

const renderAction = (props = {}) =>
  render(<UserStatusAction targetUser={TARGET} currentUserId="u-1" isSuperAdmin onChanged={vi.fn()} {...props} />);

beforeEach(() => {
  toastMock.mockReset();
  setUserEnabledMock.mockReset();
  setUserEnabledMock.mockResolvedValue({ changed: true });
});

describe('UserStatusAction visibility', () => {
  it('renders nothing for a non super_admin', () => {
    const { container } = renderAction({ isSuperAdmin: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for the current user or another super_admin', () => {
    const own = renderAction({ targetUser: { ...TARGET, id: 'u-1' } });
    expect(own.container).toBeEmptyDOMElement();
    const sa = renderAction({ targetUser: { ...TARGET, role: 'super_admin' } });
    expect(sa.container).toBeEmptyDOMElement();
  });

  it('shows Disable for an enabled user and Enable for a disabled one', () => {
    renderAction();
    expect(screen.getByRole('button', { name: /Deshabilitar usuario cliente@example.test/ })).toBeInTheDocument();
    renderAction({ targetUser: DISABLED });
    expect(screen.getByRole('button', { name: /Habilitar usuario cliente@example.test/ })).toBeInTheDocument();
  });
});

describe('disable dialog', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: /Deshabilitar usuario/ }));

  it('opens an accessible dialog and keeps confirm disabled until the reason has 3+ characters', () => {
    renderAction();
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const confirm = within(dialog).getByRole('button', { name: ES.users.disableDialog.confirm });
    const textarea = within(dialog).getByLabelText(ES.users.disableDialog.reasonLabel);
    expect(confirm).toBeDisabled();
    fireEvent.change(textarea, { target: { value: ' ab ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(textarea, { target: { value: 'abc' } });
    expect(confirm).toBeEnabled();
    expect(textarea).toHaveAttribute('maxlength', '500');
    expect(within(dialog).getByText('3/500')).toBeInTheDocument();
  });

  it('submits the trimmed reason, toasts success, closes and notifies the parent', async () => {
    const onChanged = vi.fn();
    renderAction({ onChanged });
    open();
    fireEvent.change(screen.getByLabelText(ES.users.disableDialog.reasonLabel), { target: { value: '  fraude  ' } });
    fireEvent.click(screen.getByRole('button', { name: ES.users.disableDialog.confirm }));
    await waitFor(() => expect(setUserEnabledMock).toHaveBeenCalledWith('u-2', false, 'fraude'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: ES.users.userDisabled }));
  });

  it('closes with Escape and with Cancel without calling the service', () => {
    renderAction();
    open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    fireEvent.click(screen.getByRole('button', { name: ES.users.disableDialog.cancel }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(setUserEnabledMock).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the mapped message when the database rejects', async () => {
    setUserEnabledMock.mockRejectedValue(new UserStatusError(USER_STATUS_ERROR.LAST_SUPER_ADMIN, 'x'));
    const onChanged = vi.fn();
    renderAction({ onChanged });
    open();
    fireEvent.change(screen.getByLabelText(ES.users.disableDialog.reasonLabel), { target: { value: 'motivo' } });
    fireEvent.click(screen.getByRole('button', { name: ES.users.disableDialog.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ES.users.statusErrors.lastSuperAdmin);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('enable', () => {
  it('re-enables directly (no reason) and notifies the parent', async () => {
    const onChanged = vi.fn();
    renderAction({ targetUser: DISABLED, onChanged });
    fireEvent.click(screen.getByRole('button', { name: /Habilitar usuario/ }));
    await waitFor(() => expect(setUserEnabledMock).toHaveBeenCalledWith('u-2', true));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: ES.users.userEnabled }));
  });

  it('toasts the mapped error when the database rejects', async () => {
    setUserEnabledMock.mockRejectedValue(new UserStatusError(USER_STATUS_ERROR.FORBIDDEN, 'x'));
    renderAction({ targetUser: DISABLED });
    fireEvent.click(screen.getByRole('button', { name: /Habilitar usuario/ }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: ES.users.statusErrors.forbidden, variant: 'destructive' })
      )
    );
  });
});

describe('i18n parity', () => {
  const keys = (o, p = '') =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  it('has the same users.disableDialog / users.statusErrors keys in ES and EN', () => {
    for (const section of ['disableDialog', 'statusErrors']) {
      expect(keys(EN.users[section]).sort()).toEqual(keys(ES.users[section]).sort());
      expect(keys(ES.users[section]).length).toBeGreaterThan(0);
    }
    for (const k of ['table.disabled', 'disabledReason', 'disabledAt', 'disabledBy']) {
      const get = (o) => k.split('.').reduce((a, p) => a?.[p], o.users);
      expect(typeof get(ES)).toBe('string');
      expect(typeof get(EN)).toBe('string');
    }
  });
});
