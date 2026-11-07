import { BRAND_PALETTE, isHexColor } from '@/lib/brandPalette';
import { contrastRatio } from '@/lib/contrast';

// Image data URLs (what the Visual settings upload stores) or https; anything else (javascript:, data:text/html) is dropped.
const SAFE_LOGO = /^(?:data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/i;

// The upload validates files at 2 MB (IMAGE_CONSTRAINTS.logo.maxSizeMB); the same limit as base64 text (4/3 overhead + header).
const MAX_LOADER_IMAGE_CHARS = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 64;

export const safeLogoSrc = (value) => (typeof value === 'string' && SAFE_LOGO.test(value) ? value : '');

/** The company name is rendered beside a logo unless the admin unchecked it (the logo already contains it). Absent => true. */
export const showNameWithLogo = (settings) => settings?.showCompanyNameWithLogo !== false;

/**
 * Cleans the additive branding keys of a settings object. Keys that are absent stay absent (old rows are untouched);
 * present ones are coerced or blanked so nothing unchecked reaches an <img src> or a style attribute.
 */
export const normalizeBrandingSettings = (settings) => {
  const next = { ...(settings && typeof settings === 'object' ? settings : {}) };
  if ('showCompanyNameWithLogo' in next) next.showCompanyNameWithLogo = next.showCompanyNameWithLogo !== false;
  if ('loaderBgColor' in next) next.loaderBgColor = isHexColor(next.loaderBgColor) ? next.loaderBgColor : '';
  if ('loaderImage' in next) next.loaderImage = next.loaderImage?.length <= MAX_LOADER_IMAGE_CHARS ? safeLogoSrc(next.loaderImage) : '';
  return next;
};

/**
 * What the initial loader paints. Empty strings mean "not configured": the caller uses the theme tokens and, for the
 * image, falls back to the site logo and then to the wordmark.
 */
export const getLoaderConfig = (settings) => ({
  image: safeLogoSrc(settings?.loaderImage) || safeLogoSrc(settings?.logo),
  bgColor: isHexColor(settings?.loaderBgColor) ? settings.loaderBgColor : '',
});

/** White or charcoal, whichever reads better on the given hex background. */
export const readableTextOn = (bg) => {
  const { charcoal } = BRAND_PALETTE;
  return contrastRatio('#ffffff', bg) > contrastRatio(charcoal, bg) ? '#ffffff' : charcoal;
};
