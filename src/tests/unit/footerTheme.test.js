import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { BRAND_PRESET } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { contrastRatio } from '@/lib/contrast';
import { buildFooterTheme } from '@/lib/footerTheme';

// Row stored in production today, merged over the code defaults like loadVisualSettings does.
const PROD = {
  ...DEFAULT_VISUAL_SETTINGS,
  useGradient: true,
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  footerLinkColor: '#2563eb',
  footerLinkHoverColor: '#9333ea',
  accentColor: '#9333ea',
};
const PRESET = { ...PROD, ...BRAND_PRESET };
const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };

describe('buildFooterTheme (S4)', () => {
  describe('production row, preset not applied: keeps the current look', () => {
    const theme = buildFooterTheme(PROD);

    it('keeps the footer, text and link colours stored in the row', () => {
      expect(theme.backgroundColor).toBe('#ffffff');
      expect(theme['--ftr-text']).toBe('#374151');
      expect(theme['--ftr-link']).toBe('#2563eb');
      expect(theme['--ftr-link-hover']).toBe('#9333ea');
    });

    it('keeps the primary colour on the company name and the tinted top border', () => {
      expect(theme['--ftr-brand']).toBe('#3499dc');
      expect(theme['--ftr-border']).toBe('#3499dc20');
      expect(theme['--ftr-divider']).toBe('#3499dc10');
    });

    it('keeps the 80% secondary text and plain (not underlined) signature link', () => {
      expect(theme['--ftr-text-opacity']).toBe('0.8');
      expect(theme['--ftr-link-decoration']).toBe('none');
    });
  });

  describe('brand preset applied', () => {
    const theme = buildFooterTheme(PRESET);

    it('takes every colour from the footer settings, not from the legacy primary/secondary', () => {
      expect(theme.backgroundColor).toBe('#FFFFFF');
      expect(theme['--ftr-text']).toBe('#605B52');
      expect(theme['--ftr-link']).toBe('#171717');
      expect(theme['--ftr-link-hover']).toBe('#605B52');
      expect(theme['--ftr-brand']).toBe('#171717');
      expect(theme['--ftr-border']).toBe('#E8E0D2');
      expect(theme['--ftr-divider']).toBe('#E8E0D2');
    });

    it('drops the opacity and underlines the signature link so it is not told apart by colour alone', () => {
      expect(theme['--ftr-text-opacity']).toBe('1');
      expect(theme['--ftr-link-decoration']).toBe('underline');
    });

    it('reaches WCAG AA 4.5:1 for text, links and company name on the footer background (read from the output)', () => {
      const bg = theme.backgroundColor;
      for (const key of ['--ftr-text', '--ftr-link', '--ftr-link-hover', '--ftr-brand']) {
        expect(contrastRatio(theme[key], bg), key).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('ignores primary/secondary/accent colours (poisoned settings)', () => {
      const poisoned = buildFooterTheme({ ...PRESET, ...POISON });
      const dump = JSON.stringify(poisoned).toLowerCase();
      Object.values(POISON).forEach((hex) => expect(dump).not.toContain(hex));
      expect(poisoned).toEqual(theme);
    });
  });

  describe('customised settings', () => {
    it('follows a customised link, hover, text and background colour', () => {
      const theme = buildFooterTheme({
        ...PRESET,
        footerBgColor: '#101010',
        footerTextColor: '#eeeeee',
        footerLinkColor: '#ffd9a0',
        footerLinkHoverColor: '#ffffff',
      });
      expect(theme.backgroundColor).toBe('#101010');
      expect(theme['--ftr-text']).toBe('#eeeeee');
      expect(theme['--ftr-link']).toBe('#ffd9a0');
      expect(theme['--ftr-link-hover']).toBe('#ffffff');
    });

    it('keeps the focus ring visible: falls back to the text colour when the ring is invisible on the footer', () => {
      const dark = buildFooterTheme({ ...PRESET, footerBgColor: '#101010', footerTextColor: '#eeeeee', focusRingColor: '#171717' });
      expect(dark['--ftr-focus']).toBe('#eeeeee');
      expect(buildFooterTheme(PRESET)['--ftr-focus']).toBe('#171717');
    });
  });

  describe('safe fallbacks', () => {
    it('falls back for missing settings without throwing', () => {
      const theme = buildFooterTheme({});
      expect(theme.backgroundColor).toBe('#ffffff');
      expect(theme['--ftr-text']).toBe('#374151');
      expect(contrastRatio(theme['--ftr-link'], theme.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      expect(() => buildFooterTheme()).not.toThrow();
    });

    it('never lets a non-HEX value reach a style attribute', () => {
      const evil = 'red; background:url(//evil.test/x)';
      const theme = buildFooterTheme({
        ...PRESET,
        footerBgColor: evil,
        footerTextColor: evil,
        footerLinkColor: evil,
        footerLinkHoverColor: 'var(--x)',
        headingColor: 'javascript:alert(1)',
        borderColor: 'url(x)',
        focusRingColor: evil,
      });
      for (const value of Object.values(theme)) {
        expect(String(value)).not.toMatch(/evil|url|javascript|var\(--x\)|;/i);
      }
    });

    it('falls back both colours of a pair so a good text colour is not left on the other fallback', () => {
      const theme = buildFooterTheme({ ...PRESET, footerBgColor: 'nope', footerTextColor: '#f5f5f5' });
      expect(contrastRatio(theme['--ftr-text'], theme.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
