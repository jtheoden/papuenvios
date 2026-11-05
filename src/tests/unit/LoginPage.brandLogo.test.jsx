import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({ settings: {}, signIn: vi.fn() }));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: state.settings }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signInWithGoogle: state.signIn }),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

import LoginPage from '@/components/LoginPage';

const logoOf = () => screen.getByRole('img', { name: 'Papu Test' });

beforeEach(() => {
  state.settings = { companyName: 'Papu Test', logo: '', logoMaxHeight: 40 };
  state.signIn = vi.fn(() => new Promise(() => {}));
});

describe('LoginPage brand logo', () => {
  it('shows the logo configured in Ajustes > Visual, eager, bounded by logoMaxHeight', () => {
    state.settings.logo = 'https://cdn.test/logo.png';
    render(<LoginPage onNavigate={vi.fn()} />);
    const img = logoOf();
    expect(img).toHaveAttribute('src', 'https://cdn.test/logo.png');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img.style.height).toBe('40px');
    expect(img.style.maxWidth).toBe('min(100%, 320px)');
  });

  it('caps an oversized logoMaxHeight', () => {
    state.settings = { ...state.settings, logo: 'https://cdn.test/logo.png', logoMaxHeight: 500 };
    render(<LoginPage onNavigate={vi.fn()} />);
    expect(logoOf().style.height).toBe('64px');
  });

  it('falls back to the brand wordmark (light-background variant) when no logo is set', () => {
    render(<LoginPage onNavigate={vi.fn()} />);
    const img = logoOf();
    expect(img.getAttribute('src')).toMatch(/papuenvios-wordmark-onlight\.svg/);
    expect(img).toHaveAttribute('width', '1557');
    expect(img).toHaveAttribute('height', '235');
  });

  it('falls back to the wordmark when the configured logo fails to load, then to the company name', () => {
    state.settings.logo = 'https://cdn.test/broken.png';
    render(<LoginPage onNavigate={vi.fn()} />);
    fireEvent.error(logoOf());
    const wordmark = logoOf();
    expect(wordmark.getAttribute('src')).toMatch(/papuenvios-wordmark-onlight\.svg/);
    fireEvent.error(wordmark);
    expect(screen.queryByRole('img', { name: 'Papu Test' })).not.toBeInTheDocument();
    expect(screen.getByText('Papu Test')).toBeInTheDocument();
  });

  it('no longer renders the gradient icon tile, and keeps the Connecting state of the button', () => {
    const { container } = render(<LoginPage onNavigate={vi.fn()} />);
    expect(container.querySelector('.bg-gradient-to-br')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /auth.loginWithGoogle/ }));
    expect(screen.getByRole('button', { name: /Conectando/ })).toBeDisabled();
  });
});
