import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

const state = vi.hoisted(() => ({ lang: 'es' }));

const translate = (key) => {
  const dict = state.lang === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  return typeof value === 'string' ? value : key;
};

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: state.lang }),
}));

import AuthLoadingScreen from '@/components/AuthLoadingScreen';

const CACHE_KEY = 'business_visual_settings_cache';
const PROD = { ...DEFAULT_VISUAL_SETTINGS, useGradient: true, primaryColor: '#3499dc', secondaryColor: '#9333ea' };
const PRESET = { ...PROD, ...BRAND_PRESET };
const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };

const store = (settings) => localStorage.setItem(CACHE_KEY, JSON.stringify({ data: settings, timestamp: Date.now() - 3600_000 }));

describe('AuthLoadingScreen (S4)', () => {
  beforeEach(() => {
    state.lang = 'es';
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('accessibility', () => {
    it('is a single polite status region', () => {
      render(<AuthLoadingScreen />);
      const status = screen.getByRole('status');
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(status.getAttribute('aria-live')).toBe('polite');
    });

    it.each([
      ['es', ES.auth.authenticating],
      ['en', EN.auth.authenticating],
    ])('announces the translated message in %s', (lang, message) => {
      state.lang = lang;
      render(<AuthLoadingScreen />);
      expect(screen.getByRole('status')).toHaveTextContent(message);
    });

    it('announces the message it is given (permission check)', () => {
      render(<AuthLoadingScreen loadingMessage={ES.auth.verifyingPermissions} />);
      expect(screen.getByRole('status')).toHaveTextContent(ES.auth.verifyingPermissions);
    });

    it('does not re-announce the animated dots or the rotating hints: only the static text is readable', () => {
      vi.useFakeTimers();
      render(<AuthLoadingScreen />);
      const status = screen.getByRole('status');
      const spoken = () =>
        [...status.querySelectorAll('*')]
          .filter((el) => !el.closest('[aria-hidden="true"]') && el.children.length === 0)
          .map((el) => el.textContent)
          .join('');
      const before = spoken();
      expect(before).toBe(ES.auth.authenticating);
      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(spoken()).toBe(before);
      expect(status.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });

    it('stops spinning when the visitor prefers reduced motion', () => {
      const { container } = render(<AuthLoadingScreen />);
      expect(container.querySelector('.animate-spin').className).toMatch(/motion-reduce:animate-none/);
    });
  });

  describe('colours from the visual settings', () => {
    it('without stored settings keeps the shipped blue to violet gradient', () => {
      render(<AuthLoadingScreen />);
      expect(screen.getByRole('status').style.getPropertyValue('--ld-bg')).toBe('linear-gradient(to right, #2563eb, #9333ea)');
    });

    it('reads the settings the app stored (real cache key), even past the cache TTL', () => {
      store(PRESET);
      render(<AuthLoadingScreen />);
      const status = screen.getByRole('status');
      expect(status.style.getPropertyValue('--ld-bg')).toBe('#FAF7F0');
      expect(status.style.getPropertyValue('--ld-accent')).toBe('#171717');
    });

    it('with the production row (gradient on) keeps the shipped gradient: nothing changes until the preset is applied', () => {
      store(PROD);
      render(<AuthLoadingScreen />);
      expect(screen.getByRole('status').style.getPropertyValue('--ld-bg')).toBe('linear-gradient(to right, #2563eb, #9333ea)');
    });

    it('does not depend on primary/secondary/accent colours once the preset is applied (poisoned settings)', () => {
      store({ ...PRESET, ...POISON });
      const { container } = render(<AuthLoadingScreen />);
      const html = container.innerHTML.toLowerCase();
      Object.values(POISON).forEach((hex) => expect(html).not.toContain(hex));
    });

    it('paints the spinner and the page through the theme variables, not through inline colours', () => {
      store(PRESET);
      const { container } = render(<AuthLoadingScreen />);
      expect(container.querySelector('.animate-spin').className).toContain('border-t-[color:var(--ld-accent)]');
      expect(screen.getByRole('status').className).toContain('[background:var(--ld-bg)]');
    });
  });
});
