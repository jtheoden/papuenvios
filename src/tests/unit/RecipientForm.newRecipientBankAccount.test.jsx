/**
 * A brand-new recipient has no id until it is saved, so there is no bank account to list or link yet.
 * The form must say so instead of mounting the account selector, which would spin on "Loading accounts..."
 * forever with no way to add one. Once the recipient exists (id known), the selector is back.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/BankAccountSelector', () => ({ default: () => <div data-testid="bank-selector" /> }));

import RecipientForm from '@/components/RecipientForm';

const HINT = /Guarda el destinatario para vincular su cuenta bancaria/;

describe('RecipientForm bank account block', () => {
  it.each(['transfer', 'card', 'moneypocket'])(
    'tells a new recipient (%s delivery) to save first and does not mount the account selector',
    (deliveryMethod) => {
      render(<RecipientForm deliveryMethod={deliveryMethod} recipientId={null} />);

      expect(screen.getByText(HINT)).toBeInTheDocument();
      expect(screen.queryByTestId('bank-selector')).toBeNull();
    }
  );

  it('shows the account selector once the recipient exists', () => {
    render(<RecipientForm deliveryMethod="transfer" recipientId="rec-1" />);

    expect(screen.getByTestId('bank-selector')).toBeInTheDocument();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows neither for cash delivery', () => {
    render(<RecipientForm deliveryMethod="cash" recipientId={null} />);

    expect(screen.queryByTestId('bank-selector')).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
