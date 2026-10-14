import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));

import ZelleAccountDisplay from '@/components/shared/ZelleAccountDisplay';

const base = { account_name: 'Main', email: 'a@b.com', phone: '+15550001' };

describe('ZelleAccountDisplay contact visibility', () => {
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
