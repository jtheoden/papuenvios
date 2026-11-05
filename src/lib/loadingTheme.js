import { BRAND_PALETTE, BRAND_PRESET, hex } from '@/lib/brandPalette';
import { LOCAL_CACHE_KEY } from '@/lib/constants';

const { charcoal, warmGray } = BRAND_PALETTE;

/**
 * Visual settings the app cached on its last load. AuthLoadingScreen runs before BusinessProvider
 * (it is rendered by AuthProvider), so it cannot use the context. The 1 minute TTL of the cache is
 * ignored on purpose: for a splash screen a slightly stale look beats the wrong one.
 */
export const readStoredVisualSettings = () => {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || 'null')?.data;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
};

/**
 * Loading screen colours as CSS custom properties for its root.
 * Nothing stored (first visit) => the brand look, matching the static splash and the --t-* defaults (no
 * ivory -> gradient -> ivory flash); classic only when the stored settings say so.
 * While useGradient is on it keeps the look it always had: fixed blue to violet
 * gradient on a white card. That screen never honoured the stored colours (it read a key nobody writes),
 * so production keeps its look until the brand preset (useGradient off) is applied; then the page,
 * card and text follow the settings. The accent is charcoal there: the brand gold is 1.97:1 on white,
 * too faint for a spinner. Only the secondary text moved from #9ca3af (2.5:1) to #6b7280 (4.83:1) for AA.
 */
export const buildLoadingTheme = (s) => {
  const settings = s ?? BRAND_PRESET;
  if (settings.useGradient ?? true) {
    return {
      '--ld-bg': 'linear-gradient(to right, #2563eb, #9333ea)',
      '--ld-card-bg': '#ffffff',
      '--ld-accent': '#2563eb',
      '--ld-text': '#4b5563',
      '--ld-muted': '#6b7280',
    };
  }

  const ink = hex(settings.headingColor, charcoal);
  return {
    '--ld-bg': hex(settings.pageBgColor, '#f9fafb'),
    '--ld-card-bg': hex(settings.cardBgColor, '#ffffff'),
    '--ld-accent': ink,
    '--ld-text': ink,
    '--ld-muted': hex(settings.mutedTextColor, warmGray),
  };
};
