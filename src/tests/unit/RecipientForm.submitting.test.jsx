import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/BankAccountSelector', () => ({ default: () => null }));

import RecipientForm from '@/components/RecipientForm';

describe('RecipientForm submitting state', () => {
  it('disables the submit button, marks it busy and ignores clicks while submitting', () => {
    const onSubmit = vi.fn();
    render(<RecipientForm onSubmit={onSubmit} submitting submitLabel="Guardar" deliveryMethod="transfer" />);

    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stays enabled when not submitting', () => {
    const onSubmit = vi.fn();
    render(<RecipientForm onSubmit={onSubmit} submitLabel="Guardar" deliveryMethod="transfer" />);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
