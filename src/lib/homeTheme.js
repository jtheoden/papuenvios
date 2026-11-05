import { BRAND_PALETTE, NEW_KEY_DEFAULTS, isHexColor } from '@/lib/brandPalette';

const { white, charcoal, warmGray, gold, goldDeep, goldSoft, beige } = BRAND_PALETTE;

/** First value that is a HEX colour, so nothing unchecked reaches a style attribute. */
const hex = (...candidates) => candidates.find(isHexColor);

/** A text/background pair: if either colour is invalid BOTH fall back, so a good text colour never lands on the other fallback. */
const pair = (fg, bg, fgFallback, bgFallback) => (isHexColor(fg) && isHexColor(bg) ? [fg, bg] : [fgFallback, bgFallback]);

// Legacy blue/violet fallbacks, kept only for the stored-gradient CTA so the production look does not move.
const LEGACY_FROM = '#2563eb';
const LEGACY_TO = '#9333ea';

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
  const softAccent = hex(s.softAccentColor, goldSoft);
  const focusRing = hex(s.focusRingColor, charcoal);
  const dotActive = hex(s.carouselDotActiveColor, NEW_KEY_DEFAULTS.carouselDotActiveColor);

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
    legacy: Boolean(s.useGradient),
    ctaStyle,
    buttonBg,
    buttonText,
    ink,
    border,
    softAccent,
    dotActive,
    cardBg: hex(s.cardBgColor, white),
    muted: hex(s.mutedTextColor, warmGray),
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
