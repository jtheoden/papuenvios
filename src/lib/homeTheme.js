import { BRAND_PALETTE, NEW_KEY_DEFAULTS, isHexColor } from '@/lib/brandPalette';

const { white, charcoal, warmGray, gold, goldDeep, goldSoft, beige } = BRAND_PALETTE;

/** First value that is a HEX colour, so nothing unchecked reaches a style attribute. */
const hex = (...candidates) => candidates.find(isHexColor);

/** A text/background pair: if either colour is invalid BOTH fall back, so a good text colour never lands on the other fallback. */
const pair = (fg, bg, fgFallback, bgFallback) => (isHexColor(fg) && isHexColor(bg) ? [fg, bg] : [fgFallback, bgFallback]);

// Legacy blue/violet fallbacks, kept only for the stored-gradient CTA so the production look does not move.
const LEGACY_FROM = '#2563eb';
const LEGACY_TO = '#9333ea';
const LEGACY_PAGE_BG = '#f9fafb';
const LEGACY_MUTED = '#4b5563';

// #rgb -> #rrggbb so an alpha suffix stays a valid 8-digit colour
const long = (c) => (c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c);

/**
 * Home colours resolved from the Visual settings.
 *
 * `legacy` (useGradient on) is the look stored in production: the sections outside the hero keep their
 * blue/violet gradients and tints until the super admin applies the brand preset, which turns it off.
 * `vars` are the --brand-* variables for the Home root. They are also set on :root by applyVisualSettingsToDOM;
 * repeating them here keeps the Home correct before SettingsContext has applied them (same reason as headerTheme.js).
 */
export const buildHomeTheme = (s = {}) => {
  const [buttonText, buttonBg] = pair(s.buttonTextColor, s.buttonBgColor, charcoal, gold);
  const buttonHoverBg = hex(s.buttonHoverBgColor, goldDeep);
  const ink = hex(s.headingColor, charcoal);
  const border = hex(s.borderColor, beige);
  const legacy = Boolean(s.useGradient);
  const focusRing = hex(s.focusRingColor, charcoal);
  // The brand gold must not appear before the preset: with the legacy look on, the new keys (which the settings
  // merge fills with brand defaults for the stored row) are replaced by the colours the row already has.
  const softAccent = legacy ? `${long(hex(s.accentColor, LEGACY_TO))}20` : hex(s.softAccentColor, goldSoft);
  const dotActive = legacy ? hex(s.primaryColor, LEGACY_FROM) : hex(s.carouselDotActiveColor, NEW_KEY_DEFAULTS.carouselDotActiveColor);

  // CTA: the stored gradient while useButtonGradient is on (falls back to useGradient, as getPrimaryButtonStyle does)
  const ctaGradient = Boolean(s.useButtonGradient ?? s.useGradient);
  const ctaStyle = ctaGradient
    ? {
        background: `linear-gradient(to right, ${hex(s.primaryColor, LEGACY_FROM)}, ${hex(s.secondaryColor, LEGACY_TO)})`,
        color: hex(s.buttonTextColor, white),
        border: 'none',
      }
    : undefined;

  return {
    legacy,
    ctaStyle,
    buttonBg,
    buttonText,
    ink,
    border,
    softAccent,
    dotActive,
    // The Home root paints pageBgColor (ivory with the preset). The legacy default #f9fafb of production is not
    // painted, so the stylesheet gradient keeps showing. shortcut: an admin who really wants #f9fafb gets the gradient.
    pageBg: isHexColor(s.pageBgColor) && s.pageBgColor.toLowerCase() !== LEGACY_PAGE_BG ? s.pageBgColor : undefined,
    cardBg: hex(s.cardBgColor, white),
    muted: legacy ? LEGACY_MUTED : hex(s.mutedTextColor, warmGray),
    vars: {
      '--brand-button-bg': buttonBg,
      '--brand-button-text': buttonText,
      '--brand-button-hover-bg': buttonHoverBg,
      '--brand-border': border,
      '--brand-ink': ink,
      '--brand-soft-accent': softAccent,
      '--brand-focus-ring': focusRing,
      '--brand-dot-active': dotActive,
    },
  };
};
