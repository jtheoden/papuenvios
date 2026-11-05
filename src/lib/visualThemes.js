import { BRAND_PRESET } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

/**
 * Built-in default themes. A theme is a set of values for the keys of BRAND_PRESET; the resolvers
 * (headerTheme, footerTheme, loadingTheme, styleUtils) keep reading those VALUES, never the theme name,
 * so both themes resolve exactly as before. `activeTheme` only records which one the super admin chose.
 */
export const THEME_IDS = ['classic', 'papuenvios'];
export const DEFAULT_THEME_ID = 'classic';

const PRESET_KEYS = Object.keys(BRAND_PRESET);

const pickPresetKeys = (source = {}) =>
  Object.fromEntries(PRESET_KEYS.filter((key) => key in source).map((key) => [key, source[key]]));

export const THEME_PRESETS = {
  // The production look: the code defaults for the keys the brand preset sets.
  classic: pickPresetKeys(DEFAULT_VISUAL_SETTINGS),
  papuenvios: BRAND_PRESET,
};

/** Missing, null or unknown => classic, so a row without the key keeps today's look. */
export const resolveThemeId = (settings) => (THEME_IDS.includes(settings?.activeTheme) ? settings.activeTheme : DEFAULT_THEME_ID);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The theme-related keys a form copies from the stored settings. */
export const pickThemeKeys = (settings = {}) => ({
  activeTheme: resolveThemeId(settings),
  classicSnapshot: isPlainObject(settings?.classicSnapshot) ? settings.classicSnapshot : null,
});

/**
 * Only preset keys, and only values of the same type as the preset (string/boolean). Not HEX-only: a stored
 * 8-digit or rgba value must come back untouched (the resolvers validate before painting).
 */
const sanitizeSnapshot = (raw) =>
  isPlainObject(raw)
    ? Object.fromEntries(
        PRESET_KEYS.filter((key) => Object.hasOwn(raw, key) && typeof raw[key] === typeof BRAND_PRESET[key]).map((key) => [key, raw[key]])
      )
    : {};

const sameValue = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Returns the form values after choosing a theme. Pure: nothing is persisted here.
 * - Same theme as the current one: unchanged (custom colours are never replaced by defaults).
 * - classic -> papuenvios: keeps the current values of the preset keys in `classicSnapshot` (unless they already are
 *   the brand values) and applies the brand preset.
 * - papuenvios -> classic: restores that snapshot over the classic preset and drops it.
 * Keys outside the preset (primary/secondary colours, logo, texts, carousel...) are never touched.
 */
export const selectTheme = (form, targetId) => {
  if (!THEME_IDS.includes(targetId) || resolveThemeId(form) === targetId) return form;

  if (targetId === 'papuenvios') {
    const current = pickPresetKeys(form);
    const alreadyBrand = PRESET_KEYS.every((key) => sameValue(current[key], BRAND_PRESET[key]));
    return { ...form, ...BRAND_PRESET, activeTheme: 'papuenvios', classicSnapshot: alreadyBrand ? null : current };
  }

  return { ...form, ...THEME_PRESETS.classic, ...sanitizeSnapshot(form.classicSnapshot), activeTheme: 'classic', classicSnapshot: null };
};
