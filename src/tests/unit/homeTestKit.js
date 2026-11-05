// Shared fixtures for the Home brand tests (S2/S3). No vi.mock here: mocks must live in each test file.
import { BRAND_PRESET } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

// Row stored in production today (blue/violet, gradient on, no logo), merged over the code defaults
// the same way loadVisualSettings does.
export const PROD_ROW = {
  useGradient: true,
  useButtonGradient: true,
  useHeadingGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  accentColor: '#9333ea',
  headerGradientColor: '#9333ea',
  gradientDirection: '320',
  navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff',
  headerMenuActiveBgColor: '#eff6ff',
  headerMenuActiveColor: '#2563eb',
  tabActiveColor: '#2563eb',
  footerLinkColor: '#2563eb',
  footerLinkHoverColor: '#9333ea',
  buttonBgColor: '#2563eb',
  buttonTextColor: '#ffffff',
  buttonHoverBgColor: '#1d4ed8',
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
  pageBgColor: '#f9fafb',
};
export const PROD = { ...DEFAULT_VISUAL_SETTINGS, ...PROD_ROW };
// What the form holds after "Aplicar paleta PapuEnvios" and Save (the preset is written over the row).
export const PRESET = { ...DEFAULT_VISUAL_SETTINGS, ...PROD_ROW, ...BRAND_PRESET };

export const SLIDES = [
  { id: 's1', image_url: 'https://cdn.example.test/poster-1.png', title_es: 'Envíos a toda Cuba', title_en: 'Shipping all over Cuba', subtitle_es: 'a', subtitle_en: 'a' },
  { id: 's2', image_url: 'https://cdn.example.test/poster-2.png', title_es: 'Remesas seguras', title_en: 'Safe remittances', subtitle_es: 'b', subtitle_en: 'b' },
  { id: 's3', image_url: 'https://cdn.example.test/poster-3.png', title_es: 'Combos de comida', title_en: 'Food combos', subtitle_es: 'c', subtitle_en: 'c' },
];

// Colour-only fingerprint of a DOM subtree: tag + class tokens that name a colour + colour-ish inline
// declarations. Layout/size/spacing classes are ignored on purpose, so responsive fixes do not matter.
const COLOR_WORDS = /(white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand|transparent|current)/;
const COLOR_PROPS = /(color|background|border|shadow|fill|stroke)/;

export const colorSignature = (root) =>
  [root, ...root.querySelectorAll('*')]
    .map((el) => {
      const classes = (el.getAttribute('class') || '').split(/\s+/).filter((c) => c && COLOR_WORDS.test(c)).sort();
      const decls = [...el.style].filter((p) => COLOR_PROPS.test(p)).map((p) => `${p}:${el.style.getPropertyValue(p)}`).sort();
      return classes.length || decls.length ? `${el.tagName.toLowerCase()} [${classes.join(' ')}] {${decls.join('; ')}}` : null;
    })
    .filter(Boolean);
