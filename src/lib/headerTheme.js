import { BRAND_PALETTE, isHexColor } from '@/lib/brandPalette';

const { white, charcoal, goldSoft, gold, goldDeep, beige } = BRAND_PALETTE;

/** First value that is a HEX colour, so nothing unchecked reaches the style attribute. */
const hex = (...candidates) => candidates.find(isHexColor);

/**
 * Header colours resolved from the Visual settings, as CSS custom properties for the header root.
 * Hover/focus/active states read them through Tailwind classes (hover:bg-[color:var(--hdr-hover-bg)]),
 * so no inline style can override a state class. Primary/secondary colours are not read on purpose.
 * The active gradient is kept for rows saved with useGradient/useHeaderGradient; it needs a valid
 * headerGradientColor, otherwise the active tab stays flat.
 */
export const buildHeaderTheme = (s = {}) => {
  const text = hex(s.headerTextColor, charcoal);
  const hoverBg = hex(s.headerMenuHoverBgColor, goldSoft);
  const activeBg = hex(s.navBarActiveBgColor, goldSoft);
  const gradientEnd = hex(s.headerGradientColor);
  const useGradient = Boolean(s.useHeaderGradient || s.useGradient) && gradientEnd;
  const direction = Number.parseInt(s.gradientDirection, 10) || 135;
  const menuActiveBg = hex(s.headerMenuActiveBgColor, hoverBg);

  return {
    backgroundColor: hex(s.headerBgColor, white),
    color: text,
    '--hdr-text': text,
    '--hdr-hover-bg': hoverBg,
    '--hdr-hover-text': hex(s.headerMenuHoverTextColor, text),
    '--hdr-active-bg': activeBg,
    // one `background` value (solid or gradient): a separate bg-image class would be merged away by tailwind-merge
    '--hdr-active-background': useGradient ? `linear-gradient(${direction}deg, ${activeBg}, ${gradientEnd})` : activeBg,
    '--hdr-active-text': hex(s.navBarActiveTextColor, charcoal),
    '--hdr-menu-bg': hex(s.headerMenuBgColor, s.headerBgColor, white),
    '--hdr-menu-text': hex(s.headerMenuTextColor, text),
    '--hdr-menu-active-bg': menuActiveBg,
    '--hdr-menu-active-text': hex(s.headerMenuActiveColor, charcoal),
    '--hdr-border': hex(s.borderColor, beige),
    '--brand-cart-badge-bg': hex(s.cartBadgeBgColor, gold),
    '--brand-cart-badge-text': hex(s.cartBadgeTextColor, charcoal),
    '--brand-focus-ring': hex(s.focusRingColor, charcoal),
    '--brand-button-bg': hex(s.buttonBgColor, gold),
    '--brand-button-text': hex(s.buttonTextColor, charcoal),
    '--brand-button-hover-bg': hex(s.buttonHoverBgColor, goldDeep),
  };
};
