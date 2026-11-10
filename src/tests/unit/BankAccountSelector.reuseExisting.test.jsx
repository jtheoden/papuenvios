/**
 * A customer's saved bank accounts can be linked to another recipient (the holder need not be the recipient).
 * Only accounts in the delivery currency that the recipient does not have yet are offered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getBankAccountsForRecipient: vi.fn(),
  linkBankAccountToRecipient: vi.fn(),
  getBankAccountsByUser: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/BankAccountForm', () => ({ default: () => <div data-testid="account-form" /> }));
vi.mock('@/lib/recipientService', () => api);

import BankAccountSelector from '@/components/BankAccountSelector';

const mine = (id, last4, currency, holder = 'Otra Persona') => ({
  id,
  account_number_last4: last4,
  account_holder_name: holder,
  bank: { name: 'Banco Metropolitano' },
  account_type: { name: 'debit_card' },
  currency: { code: currency }
});

const linked = (linkId, accountId, last4) => ({
  id: linkId,
  is_default: true,
  bank_account: { ...mine(accountId, last4, 'USD'), is_active: true }
});

const usd = { delivery_currency: 'USD' };

beforeEach(() => {
  vi.clearAllMocks();
  api.getBankAccountsForRecipient.mockResolvedValue([]);
  api.getBankAccountsByUser.mockResolvedValue([mine('acc-usd', '1111', 'USD'), mine('acc-cup', '2222', 'CUP')]);
  api.linkBankAccountToRecipient.mockResolvedValue({ id: 'link-new' });
});

describe('BankAccountSelector: use one of my saved accounts', () => {
  it('offers only saved accounts in the delivery currency', async () => {
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

    expect(await screen.findByText(/\*\*\*\*1111/)).toBeInTheDocument();
    expect(screen.queryByText(/\*\*\*\*2222/)).toBeNull();
  });

  it('does not offer an account the recipient already has', async () => {
    api.getBankAccountsForRecipient.mockResolvedValue([linked('link-1', 'acc-usd', '1111')]);
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

    await waitFor(() => expect(api.getBankAccountsByUser).toHaveBeenCalled());
    // it is already in the recipient's own list, so it is not offered again as an option to link
    expect((await screen.findAllByText(/\*\*\*\*1111/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Usar cuenta/ })).toBeNull();
  });

  it('links the chosen account to the recipient and selects it', async () => {
    const onSelect = vi.fn();
    api.getBankAccountsForRecipient
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([linked('link-new', 'acc-usd', '1111')]);
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: /Usar cuenta.*1111/ }));

    await waitFor(() => expect(api.linkBankAccountToRecipient).toHaveBeenCalledWith('rec-1', 'acc-usd', true));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'link-new' })));
  });

  describe('empty-state notice', () => {
    it('does not tell the customer to create a new account when saved ones can be used', async () => {
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      await screen.findByRole('button', { name: /Usar cuenta.*1111/ });
      expect(screen.getByText(/Elige una de tus cuentas guardadas o agrega una nueva/)).toBeInTheDocument();
      expect(screen.queryByText(/Crea una nueva/)).toBeNull();
    });

    it('still says to create one when there is nothing to reuse', async () => {
      api.getBankAccountsByUser.mockResolvedValue([]);
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      expect(await screen.findByText(/Crea una nueva\./)).toBeInTheDocument();
      expect(screen.queryByText(/Elige una de tus cuentas guardadas/)).toBeNull();
    });

    it('with accounts in another currency shows only the currency notice, not "no linked accounts" too', async () => {
      api.getBankAccountsForRecipient.mockResolvedValue([{ ...linked('link-1', 'acc-cup-linked', '3333'), bank_account: { ...mine('acc-cup-linked', '3333', 'CUP'), is_active: true } }]);
      api.getBankAccountsByUser.mockResolvedValue([]);
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      expect(await screen.findByText(/ninguna es en USD/)).toBeInTheDocument();
      expect(screen.queryByText(/no tiene cuentas bancarias vinculadas/)).toBeNull();
    });

    it('with accounts in another currency and a saved USD one, points to the saved account instead of "create a compatible one"', async () => {
      api.getBankAccountsForRecipient.mockResolvedValue([{ ...linked('link-1', 'acc-cup-linked', '3333'), bank_account: { ...mine('acc-cup-linked', '3333', 'CUP'), is_active: true } }]);
      render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

      await screen.findByRole('button', { name: /Usar cuenta.*1111/ });
      expect(screen.getByText(/ninguna es en USD\. Elige una de tus cuentas guardadas en USD o agrega una nueva/)).toBeInTheDocument();
      expect(screen.queryByText(/Crea una nueva cuenta compatible/)).toBeNull();
    });
  });

  it('shows no list when the customer has no other saved account', async () => {
    api.getBankAccountsByUser.mockResolvedValue([]);
    render(<BankAccountSelector recipientId="rec-1" selectedRemittanceType={usd} onSelect={vi.fn()} />);

    await screen.findByText(/Agregar Nueva Cuenta Bancaria/);
    expect(screen.queryByRole('button', { name: /Usar cuenta/ })).toBeNull();
  });
});
