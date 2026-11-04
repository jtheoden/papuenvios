import { contrastRatio } from '@/lib/contrast';

/**
 * Official PapuEnvios brand palette. No imports from the settings service on purpose:
 * the service imports this file for its defaults.
 */
export const BRAND_PALETTE = {
  ivory: '#FAF7F0', // page background
  white: '#FFFFFF', // top menu, cards, forms
  charcoal: '#171717', // titles, text, icons
  warmGray: '#605B52', // secondary text
  gold: '#FFA500', // primary buttons, cart badge, active carousel dot
  goldDeep: '#E59400', // primary button hover
  goldSoft: '#FFF1CC', // notices, tags, active menu tab
  beige: '#E8E0D2', // card borders, separators, secondary buttons
};

const { ivory, white, charcoal, warmGray, gold, goldDeep, goldSoft, beige } = BRAND_PALETTE;

/**
 * Keys added by the brand refresh. The merge in loadVisualSettings fills them for rows saved
 * before they existed, so no DB migration is needed.
 * borderColor is already read by UserPanel and styleUtils with a grey fallback, so its default
 * keeps that grey: the brand beige only arrives through BRAND_PRESET.
 */
export const NEW_KEY_DEFAULTS = {
  cartBadgeBgColor: gold,
  cartBadgeTextColor: charcoal,
  carouselDotActiveColor: gold,
  borderColor: '#e5e7eb',
  mutedTextColor: warmGray,
  softAccentColor: goldSoft,
  focusRingColor: charcoal,
};

export const NEW_KEY_NAMES = Object.keys(NEW_KEY_DEFAULTS);

/** Current values (or defaults) for the new keys, for forms that copy settings into local state. */
export const pickNewKeys = (settings = {}) =>
  Object.fromEntries(NEW_KEY_NAMES.map((key) => [key, settings[key] || NEW_KEY_DEFAULTS[key]]));

/**
 * What "Aplicar paleta PapuEnvios" writes into the form. Only existing/new settings keys.
 * primaryColor/secondaryColor are left alone: ~30 admin and user screens use them for text.
 * The gradient flags go off because Header (nav active), HomePage CTA and getHeadingStyle
 * OR them with useGradient, so a solid brand colour would otherwise be ignored.
 */
export const BRAND_PRESET = {
  pageBgColor: ivory,
  cardBgColor: white,
  accentColor: gold,
  useGradient: false,
  useHeaderGradient: false,
  // Header and navigation
  headerBgColor: white,
  headerTextColor: charcoal,
  headerMenuBgColor: white,
  headerMenuTextColor: charcoal,
  headerMenuHoverBgColor: ivory,
  headerMenuHoverTextColor: charcoal,
  headerMenuActiveBgColor: goldSoft,
  headerMenuActiveColor: charcoal,
  navBarActiveBgColor: goldSoft,
  navBarActiveTextColor: charcoal,
  // Headings
  headingColor: charcoal,
  useHeadingGradient: false,
  // Tabs
  tabActiveColor: charcoal,
  tabActiveBgColor: goldSoft,
  tabInactiveColor: warmGray,
  tabInactiveBgColor: white,
  tabHoverColor: charcoal,
  tabHoverBgColor: ivory,
  // Buttons
  buttonBgColor: gold,
  buttonTextColor: charcoal,
  buttonHoverBgColor: goldDeep,
  useButtonGradient: false,
  // Footer
  footerBgColor: white,
  footerTextColor: warmGray,
  footerLinkColor: charcoal,
  footerLinkHoverColor: warmGray,
  // New keys
  cartBadgeBgColor: gold,
  cartBadgeTextColor: charcoal,
  carouselDotActiveColor: gold,
  borderColor: beige,
  mutedTextColor: warmGray,
  softAccentColor: goldSoft,
  focusRingColor: charcoal,
};

/** setting key -> CSS variable consumed by the Tailwind `brand-*` colours. */
export const BRAND_CSS_VARS = {
  buttonBgColor: '--brand-button-bg',
  buttonHoverBgColor: '--brand-button-hover-bg',
  buttonTextColor: '--brand-button-text',
  headingColor: '--brand-ink',
  cartBadgeBgColor: '--brand-cart-badge-bg',
  cartBadgeTextColor: '--brand-cart-badge-text',
  carouselDotActiveColor: '--brand-dot-active',
  borderColor: '--brand-border',
  mutedTextColor: '--brand-muted-text',
  softAccentColor: '--brand-soft-accent',
  focusRingColor: '--brand-focus-ring',
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHexColor = (value) => typeof value === 'string' && HEX.test(value);

export const MIN_TEXT_CONTRAST = 4.5;

/** [id, text key, background key] - the pairs the Visual settings screen checks. */
const CONTRAST_PAIRS = [
  ['header', 'headerTextColor', 'headerBgColor'],
  ['navActive', 'navBarActiveTextColor', 'navBarActiveBgColor'],
  ['menuActive', 'headerMenuActiveColor', 'headerMenuActiveBgColor'],
  ['tab', 'tabActiveColor', 'tabActiveBgColor'],
  ['button', 'buttonTextColor', 'buttonBgColor'],
  ['cartBadge', 'cartBadgeTextColor', 'cartBadgeBgColor'],
];

/** Text/background pairs below WCAG AA (4.5:1). Pairs with a non-HEX value are skipped. */
export const getContrastIssues = (settings) =>
  CONTRAST_PAIRS.flatMap(([id, fgKey, bgKey]) => {
    const fg = settings[fgKey];
    const bg = settings[bgKey];
    if (!isHexColor(fg) || !isHexColor(bg)) return [];
    const ratio = contrastRatio(fg, bg);
    return ratio < MIN_TEXT_CONTRAST ? [{ id, fg, bg, ratio }] : [];
  });
