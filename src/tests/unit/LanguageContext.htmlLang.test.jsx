import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';

// index.html ships lang="es" (the default language); the app keeps <html lang> in sync with the chosen language.
const Switch = () => {
  const { setLanguage } = useLanguage();
  return <button onClick={() => setLanguage('en')}>en</button>;
};

describe('LanguageContext keeps <html lang> in sync', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('lang', 'xx');
  });

  afterEach(() => vi.restoreAllMocks());

  it('falls back to Spanish when storage reads are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<LanguageProvider><Switch /></LanguageProvider>);
    expect(document.documentElement.lang).toBe('es');
    expect(screen.getByRole('button', { name: 'en' })).toBeTruthy();
  });

  it('sets the default language on mount and follows a change', () => {
    render(<LanguageProvider><Switch /></LanguageProvider>);
    expect(document.documentElement.lang).toBe('es');
    fireEvent.click(screen.getByText('en'));
    expect(document.documentElement.lang).toBe('en');
  });

  it('uses the stored preference', () => {
    localStorage.setItem('preferredLanguage', 'en');
    render(<LanguageProvider><Switch /></LanguageProvider>);
    expect(document.documentElement.lang).toBe('en');
  });
});
