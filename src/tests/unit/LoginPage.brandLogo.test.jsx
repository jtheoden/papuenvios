import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ visualSettings: {} }));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: state.visualSettings }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signInWithGoogle: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/LegalConsentLine', () => ({ default: () => null }));

import LoginPage from '@/components/LoginPage';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('LoginPage brand logo', () => {
  beforeEach(() => {
    state.visualSettings = { logo: PNG, companyName: 'Acme Envios', logoMaxHeight: 48 };
  });

  it('shows the configured logo with the company name as alt text', () => {
    render(<LoginPage onNavigate={vi.fn()} />);
    const logo = screen.getByRole('img', { name: 'Acme Envios' });
    expect(logo).toHaveAttribute('src', PNG);
    expect(logo.style.maxHeight).toBe('48px');
  });

  it('falls back to the company wordmark when no logo is configured', () => {
    state.visualSettings = { logo: '', companyName: 'Acme Envios' };
    render(<LoginPage onNavigate={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('no longer paints the blue-purple gradient badge', () => {
    const { container } = render(<LoginPage onNavigate={vi.fn()} />);
    expect(container.querySelector('[class*="from-blue-500"], [class*="to-purple-600"]')).toBeNull();
  });
});
