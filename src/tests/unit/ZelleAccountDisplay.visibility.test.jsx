import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));

import ZelleAccountDisplay from '@/components/shared/ZelleAccountDisplay';
import { getZelleTableColumns } from '@/components/settings/ZelleAccountTableConfig';

const base = { account_name: 'Main', email: 'a@b.com', phone: '+15550001' };

describe('ZelleAccountDisplay contact visibility', () => {
  it.each([
    [{ email: null, phone: '+15550001', show_email: false, show_phone: true }, '+15550001'],
    [{ email: 'a@b.com', phone: null, show_email: true, show_phone: false }, 'a@b.com']
  ])('renders nullable contacts in the customer display and admin table: %j', (contact, visible) => {
    const account = { ...base, ...contact };
    const columns = getZelleTableColumns((key) => key, String);
    const email = columns.find((column) => column.key === 'email');
    const phone = columns.find((column) => column.key === 'phone_number');
    render(<>
      <ZelleAccountDisplay account={account} />
      <div>{email.render(account.email, account)}{phone.render(null, account)}</div>
    </>);
    expect(screen.getAllByText(visible)).toHaveLength(2);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('shows email and phone when both flags are on', () => {
    render(<ZelleAccountDisplay account={{ ...base, show_email: true, show_phone: true }} />);
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(screen.getByText('+15550001')).toBeInTheDocument();
  });

  it('hides the email when show_email is false', () => {
    render(<ZelleAccountDisplay account={{ ...base, show_email: false, show_phone: true }} />);
    expect(screen.queryByText('a@b.com')).not.toBeInTheDocument();
    expect(screen.getByText('+15550001')).toBeInTheDocument();
  });

  it('hides the phone when show_phone is false', () => {
    render(<ZelleAccountDisplay account={{ ...base, show_email: true, show_phone: false }} />);
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(screen.queryByText('+15550001')).not.toBeInTheDocument();
  });
});
