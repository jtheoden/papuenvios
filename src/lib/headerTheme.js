import { BRAND_PALETTE, NEW_KEY_DEFAULTS, isHexColor } from '@/lib/brandPalette';

const { white, charcoal, goldSoft, gold, goldDeep, beige } = BRAND_PALETTE;

/** First value that is a HEX colour, so nothing unchecked reaches the style attribute. */
const hex = (...candidates) => candidates.find(isHexColor);

/**
 * A text/background pair: if either colour is not a valid HEX, BOTH fall back, so a good text colour
 * chosen for one background is never left on top of the fallback of the other one.
 */
const pair = (fg, bg, fgFallback, bgFallback) => (isHexColor(fg) && isHexColor(bg) ? [fg, bg] : [fgFallback, bgFallback]);

/**
 * Header colours resolved from the Visual settings, as CSS custom properties for the header root.
 * Hover/focus/active states read them through Tailwind classes (hover:bg-[color:var(--hdr-hover-bg)]),
 * so no inline style can override a state class.
 *
 * primaryColor/secondaryColor are read only for the legacy look (gradient wordmark + tinted mobile
 * pills/globe/dividers), and only while useGradient is on. The brand preset turns it off, which
 * leaves the plain wordmark and neutral pills.
 * (The regular-category indicator in Header.jsx also reads primaryColor; it is not a brand surface.)
 * The active gradient is kept for rows saved with useGradient/useHeaderGradient; it needs a valid
 * headerGradientColor, otherwise the active tab stays flat.
 *
 * The --brand-* variables are also set on :root by applyVisualSettingsToDOM. They are repeated here
 * on purpose: SettingsContext only applies them after the settings load, so without them the header
 * would flash the Tailwind fallback (brand gold) before that.
 */
export const buildHeaderTheme = (s = {}) => {
  const [text, bg] = pair(s.headerTextColor, s.headerBgColor, charcoal, white);
  const [hoverText, hoverBg] = pair(s.headerMenuHoverTextColor, s.headerMenuHoverBgColor, charcoal, goldSoft);
  const [activeText, activeBg] = pair(s.navBarActiveTextColor, s.navBarActiveBgColor, charcoal, goldSoft);
  const [menuText, menuBg] = pair(s.headerMenuTextColor, s.headerMenuBgColor, text, bg);
  const [menuActiveText, menuActiveBg] = pair(s.headerMenuActiveColor, s.headerMenuActiveBgColor, charcoal, goldSoft);
  const [badgeText, badgeBg] = pair(s.cartBadgeTextColor, s.cartBadgeBgColor, NEW_KEY_DEFAULTS.cartBadgeTextColor, NEW_KEY_DEFAULTS.cartBadgeBgColor);
  const [buttonText, buttonBg] = pair(s.buttonTextColor, s.buttonBgColor, charcoal, gold);
  const gradientEnd = hex(s.headerGradientColor);
  const useNavGradient = Boolean(s.useHeaderGradient || s.useGradient) && gradientEnd;
  const parsedDirection = Number.parseInt(s.gradientDirection, 10);
  const direction = Number.isFinite(parsedDirection) ? parsedDirection : 135;

  const theme = {
    backgroundColor: bg,
    color: text,
    '--hdr-text': text,
    '--hdr-hover-bg': hoverBg,
    '--hdr-hover-text': hoverText,
    '--hdr-active-bg': activeBg,
    // one `background` value (solid or gradient): a separate bg-image class would be merged away by tailwind-merge
    '--hdr-active-background': useNavGradient ? `linear-gradient(${direction}deg, ${activeBg}, ${gradientEnd})` : activeBg,
    '--hdr-active-text': activeText,
    '--hdr-menu-bg': menuBg,
    '--hdr-menu-text': menuText,
    '--hdr-menu-active-bg': menuActiveBg,
    '--hdr-menu-active-text': menuActiveText,
    '--brand-border': hex(s.borderColor, beige),
    '--brand-ink': hex(s.headingColor, charcoal),
    '--brand-soft-accent': hex(s.softAccentColor, goldSoft),
    '--brand-cart-badge-bg': badgeBg,
    '--brand-cart-badge-text': badgeText,
    '--brand-focus-ring': hex(s.focusRingColor, charcoal),
    '--brand-button-bg': buttonBg,
    '--brand-button-text': buttonText,
    '--brand-button-hover-bg': hex(s.buttonHoverBgColor, goldDeep),
  };

  const border = theme['--brand-border'];
  Object.assign(theme, {
    '--hdr-pill-bg': 'transparent',
    '--hdr-pill-border': border,
    '--hdr-pill-text': text,
    '--hdr-pills-divider': border,
    '--hdr-menu-divider': border,
    '--hdr-globe': text,
  });

  // shortcut: legacy look (icon tile, gradient name, primary-tinted mobile chrome) while useGradient is on,
  // so production keeps its look until the preset is applied; drop it when S5 brings the official logo.
  if (s.useGradient) {
    const from = hex(s.primaryColor, charcoal);
    // #rgb -> #rrggbb so the alpha suffixes below stay valid 8-digit colours
    const long = from.length === 4 ? `#${[...from.slice(1)].map((c) => c + c).join('')}` : from;
    Object.assign(theme, {
      '--hdr-mark-from': from,
      '--hdr-mark-to': hex(s.secondaryColor, from, charcoal),
      '--hdr-pill-bg': `${long}12`,
      '--hdr-pill-border': `${long}30`,
      '--hdr-pill-text': from,
      '--hdr-pills-divider': `${long}20`,
      '--hdr-menu-divider': 'rgba(255, 255, 255, 0.2)',
      '--hdr-globe': from,
    });
  }
  return theme;
};
