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
 * cartBadge* keeps the legacy red (white text, 4.83:1) so production does not change look until
 * the super admin applies the preset, which sets the brand gold.
 */
export const NEW_KEY_DEFAULTS = {
  cartBadgeBgColor: '#dc2626',
  cartBadgeTextColor: '#ffffff',
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
 * Identity colours are readable on the brand surfaces; they only persist after an explicit form save.
 * The gradient flags go off because Header (nav active), HomePage CTA and getHeadingStyle
 * OR them with useGradient, so a solid brand colour would otherwise be ignored.
 */
export const BRAND_PRESET = {
  primaryColor: charcoal,
  secondaryColor: warmGray,
  headerGradientColor: warmGray,
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

export const LOOK_IDS = ['classic', 'papuenvios'];

const sameValue = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

// Identity keys were not in the original preset. Ignore them for legacy look inference, otherwise an
// existing brand row with the old blue/purple identity would suddenly load the Classic look.
const IDENTITY_KEYS = ['primaryColor', 'secondaryColor', 'headerGradientColor'];

/** True when every original brand look key holds the brand value (HEX compared case-insensitively). */
const matchesBrandPreset = (settings) =>
  Object.keys(BRAND_PRESET).filter((key) => !IDENTITY_KEYS.includes(key)).every((key) => sameValue(settings?.[key], BRAND_PRESET[key]));

/**
 * Look of the site: 'classic' or 'papuenvios'. Single source for the `data-theme` on <html> (the --t-* tokens in
 * index.css) AND the Settings > Visual selector (visualThemes.resolveThemeId is this function), so they never diverge.
 * A valid stored `activeTheme` wins; without one (rows saved before the selector) every brand preset value present
 * => papuenvios, anything else => classic. It lives here, not in visualThemes, because visualThemes imports the
 * settings service, which imports this file (an import cycle). The inline script in index.html mirrors it.
 */
export const resolveLookId = (settings) => {
  if (LOOK_IDS.includes(settings?.activeTheme)) return settings.activeTheme;
  return matchesBrandPreset(settings) ? 'papuenvios' : 'classic';
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

/** First value that is a HEX colour, so nothing unchecked reaches a style attribute. */
export const hex = (...candidates) => candidates.find(isHexColor);

/**
 * A text/background pair: if either colour is not a valid HEX, BOTH fall back, so a good text colour
 * chosen for one background is never left on top of the fallback of the other one.
 */
export const pair = (fg, bg, fgFallback, bgFallback) => (isHexColor(fg) && isHexColor(bg) ? [fg, bg] : [fgFallback, bgFallback]);

/** #rgb -> #rrggbb, so an alpha suffix stays a valid 8-digit colour. Expects a valid HEX. */
export const toLongHex = (value) => (value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join('')}` : value);

export const MIN_TEXT_CONTRAST = 4.5;

/** [id, text key, background key] - the pairs the Visual settings screen checks. */
const CONTRAST_PAIRS = [
  ['header', 'headerTextColor', 'headerBgColor'],
  ['navActive', 'navBarActiveTextColor', 'navBarActiveBgColor'],
  ['menuActive', 'headerMenuActiveColor', 'headerMenuActiveBgColor'],
  ['tab', 'tabActiveColor', 'tabActiveBgColor'],
  ['button', 'buttonTextColor', 'buttonBgColor'],
  ['cartBadge', 'cartBadgeTextColor', 'cartBadgeBgColor'],
  ['footerLink', 'footerLinkColor', 'footerBgColor'],
  ['footerLinkHover', 'footerLinkHoverColor', 'footerBgColor'],
];

/**
 * Pairs whose colour or opacity depends on the look, mirroring footerTheme.js: while useGradient is on the
 * footer text is painted at 80% opacity and the company name uses primaryColor; with the preset the text is solid
 * and the name uses headingColor.
 */
const footerLookPairs = (s) => [
  ['footerText', s.footerTextColor, s.footerBgColor, s.useGradient ? 0.8 : 1],
  ['footerBrand', s.useGradient ? s.primaryColor : s.headingColor, s.footerBgColor, 1],
];

/** Text/background pairs below WCAG AA (4.5:1). Pairs with a non-HEX value are skipped. */
export const getContrastIssues = (settings) =>
  [
    ...CONTRAST_PAIRS.map(([id, fgKey, bgKey]) => [id, settings[fgKey], settings[bgKey], 1]),
    ...footerLookPairs(settings),
  ].flatMap(([id, fg, bg, alpha]) => {
    if (!isHexColor(fg) || !isHexColor(bg)) return [];
    const ratio = contrastRatio(fg, bg, alpha);
    return ratio < MIN_TEXT_CONTRAST ? [{ id, fg, bg, ratio }] : [];
  });
