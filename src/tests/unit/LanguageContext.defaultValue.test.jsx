import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';

const Probe = ({ k, params }) => {
  const { t } = useLanguage();
  return <span data-testid="out">{t(k, params)}</span>;
};

const renderT = (k, params) =>
  render(
    <LanguageProvider>
      <Probe k={k} params={params} />
    </LanguageProvider>
  );

describe('LanguageContext.t defaultValue', () => {
  beforeEach(() => {
    localStorage.setItem('preferredLanguage', 'es');
  });

  it('returns defaultValue when the key is missing', () => {
    renderT('nope.missing.key', { defaultValue: 'Fallback label' });
    expect(screen.getByTestId('out').textContent).toBe('Fallback label');
  });

  it('keeps returning the key when there is no defaultValue (legacy behaviour)', () => {
    renderT('nope.missing.key');
    expect(screen.getByTestId('out').textContent).toBe('nope.missing.key');
  });

  it('prefers the translation over defaultValue when the key exists', () => {
    renderT('activityLog.actions.login', { defaultValue: 'ignored' });
    expect(screen.getByTestId('out').textContent).toBe('Inicio de sesión');
  });

  it('still interpolates {placeholders} when a translation exists', () => {
    renderT('users.confirmDelete', { email: 'a@x.test', defaultValue: 'x' });
    expect(screen.getByTestId('out').textContent).toContain('a@x.test');
  });
});
