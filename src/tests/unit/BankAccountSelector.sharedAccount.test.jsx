/**
 * A recipient can have several accounts, and an account should not repeat between recipients. The selector only works
 * with the selected recipient's accounts (it never offers the customer's other saved accounts). When the account to
 * link is already held by other recipients it names them and asks for confirmation; only a confirmation links it to
 * both. Its notices never contradict each other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getBankAccountsForRecipient: vi.fn(),
  linkBankAccountToRecipient: vi.fn(),
  getBankAccountsByUser: vi.fn(),
  toast: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: api.toast }));
vi.mock('@/components/BankAccountForm', () => ({
  default: ({ onSuccess }) => <button type="button" onClick={() => onSuccess({ id: 'acc-new' })}>Crear Cuenta</button>
}));
vi.mock('@/lib/recipientService', () => ({
  getBankAccountsForRecipient: api.getBankAccountsForRecipient,
  linkBankAccountToRecipient: api.linkBankAccountToRecipient,
  getBankAccountsByUser: api.getBankAccountsByUser
}));

import BankAccountSelector from '@/components/BankAccountSelector';

const linked = (linkId, accountId, last4, currency) => ({
  id: linkId,
  is_default: true,
  bank_account: {
    id: accountId,
    account_number_last4: last4,
    account_holder_name: 'Cualquier Titular',
    is_active: true,
    bank: { name: 'Banco Metropolitano' },
    account_type: { name: 'checking' },
    currency: { code: currency }
  }
});

const usd = { delivery_currency: 'USD' };

beforeEach(() => {
  vi.clearAllMocks();
  api.getBankAccountsForRecipient.mockResolvedValue([]);
  api.getBankAccountsByUser.mockResolvedValue([{ id: 'acc-other', account_number_last4: '9999', currency: { code: 'USD' } }]);
  api.linkBankAccountToRecipient.mockResolvedValue({ id: 'link-new' });
});

describe('BankAccountSelector: accounts and recipients', () => {
  it('never offers the customer\'s other saved accounts', async () => {
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

    await screen.findByText(/Agregar Nueva Cuenta Bancaria/);
    expect(api.getBankAccountsByUser).not.toHaveBeenCalled();
    expect(screen.queryByText(/cuentas guardadas/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Usar cuenta/ })).toBeNull();
  });

  it('tells a recipient without accounts to add one', async () => {
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

    expect(await screen.findByText(/no tiene cuentas bancarias vinculadas\. Crea una nueva\./)).toBeInTheDocument();
  });

  it('with accounts only in another currency shows just the currency notice, not "no linked accounts" too', async () => {
    api.getBankAccountsForRecipient.mockResolvedValue([linked('link-1', 'acc-cup', '3333', 'CUP')]);
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

    expect(await screen.findByText(/ninguna es en USD\. Crea una nueva cuenta compatible\./)).toBeInTheDocument();
    expect(screen.queryByText(/no tiene cuentas bancarias vinculadas/)).toBeNull();
  });

  describe('account already held by another recipient', () => {
    const conflict = (names) => Object.assign(new Error('Bank account is already linked to another recipient'), {
      code: 'CONFLICT',
      context: { reason: 'BANK_ACCOUNT_SHARED', recipientNames: names }
    });
    const addAccount = async () => {
      fireEvent.click(await screen.findByText(/Agregar Nueva Cuenta Bancaria/));
      fireEvent.click(await screen.findByRole('button', { name: 'Crear Cuenta' }));
    };

    it('names the recipients that hold it and asks for confirmation instead of failing', async () => {
      api.linkBankAccountToRecipient.mockRejectedValueOnce(conflict(['Ana Pérez', 'Luis Gómez']));
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      await addAccount();

      expect(await screen.findByText(/Ana Pérez, Luis Gómez/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sí, asociarla también/ })).toBeInTheDocument();
      expect(api.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
      expect(api.linkBankAccountToRecipient).toHaveBeenCalledTimes(1);
    });

    it('links it to this recipient too once confirmed, and selects it', async () => {
      const onSelect = vi.fn();
      api.linkBankAccountToRecipient.mockRejectedValueOnce(conflict(['Ana Pérez']));
      api.getBankAccountsForRecipient
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([linked('link-new', 'acc-new', '1111', 'USD')]);
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={onSelect} />);

      await addAccount();
      fireEvent.click(await screen.findByRole('button', { name: /Sí, asociarla también/ }));

      await waitFor(() => expect(api.linkBankAccountToRecipient).toHaveBeenLastCalledWith('rec-1', 'acc-new', true, { confirmShared: true }));
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'link-new' })));
      expect(screen.queryByRole('button', { name: /Sí, asociarla también/ })).toBeNull();
    });

    it('does not link anything when the customer cancels', async () => {
      api.linkBankAccountToRecipient.mockRejectedValueOnce(conflict(['Ana Pérez']));
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      await addAccount();
      fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('button', { name: /Sí, asociarla también/ })).toBeNull();
      expect(api.linkBankAccountToRecipient).toHaveBeenCalledTimes(1);
    });

    it('still reports any other failure as an error', async () => {
      api.linkBankAccountToRecipient.mockRejectedValueOnce(new Error('boom'));
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      await addAccount();

      await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'boom' })));
      expect(screen.queryByRole('button', { name: /Sí, asociarla también/ })).toBeNull();
    });
  });
});
