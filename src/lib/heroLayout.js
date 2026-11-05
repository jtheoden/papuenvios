// Home hero composition, stored as `heroLayout` in business_visual_settings.settings (jsonb).
//   spaced  the separated block (title, cards, framed carousel). It is what production shows, hence the default.
//   cover   the original full-bleed cover with the slide text over the image (not called `classic`, to avoid
//           confusion with the `classic` activeTheme).
export const HERO_LAYOUTS = ['cover', 'spaced'];
export const DEFAULT_HERO_LAYOUT = 'spaced';

/**
 * Closed enumeration: only an exact match of a listed value is honoured; anything else (missing, wrong type,
 * other case, markup) resolves to the default. The stored value is never returned as-is, so it can never reach
 * a class name or a style.
 */
export const resolveHeroLayout = (settings) => {
  const stored = settings && typeof settings === 'object' ? settings.heroLayout : undefined;
  return HERO_LAYOUTS.find((layout) => layout === stored) ?? DEFAULT_HERO_LAYOUT;
};
