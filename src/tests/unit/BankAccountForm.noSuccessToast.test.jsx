/**
 * The account form only creates/finds the account. The caller then links it to the recipient and tells the customer
 * the outcome, which can still be a refusal (the account belongs to another recipient). The form therefore must not
 * announce success itself: "created successfully" followed by an error would contradict each other.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createBankAccount: vi.fn(),
  toast: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: api.toast }));
vi.mock('@/lib/recipientService', () => ({ createBankAccount: api.createBankAccount }));
vi.mock('@/lib/bankService', () => ({
  getAllBanks: vi.fn(async () => [{ id: 'bank-1', name: 'BANDEC' }]),
  getAllCurrencies: vi.fn(async () => [{ id: 'cur-usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar' }])
}));

import BankAccountForm from '@/components/BankAccountForm';

describe('BankAccountForm', () => {
  it('hands the account to the caller without announcing success itself', async () => {
    api.createBankAccount.mockResolvedValue({ id: 'acc-1' });
    const onSuccess = vi.fn();
    const { container } = render(
      <BankAccountForm userId="u1" onSuccess={onSuccess} onCancel={vi.fn()} selectedRemittanceType={{ delivery_currency: 'USD' }} />
    );

    await screen.findByText(/BANDEC/);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'bank-1' } });
    const [numberInput, holderInput] = screen.getAllByRole('textbox');
    fireEvent.change(numberInput, { target: { value: '9225000011112222' } });
    fireEvent.change(holderInput, { target: { value: 'Cualquier Titular' } });
    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'acc-1' }));
    expect(api.toast).not.toHaveBeenCalled();
  });
});
