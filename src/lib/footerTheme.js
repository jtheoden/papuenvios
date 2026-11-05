import { BRAND_PALETTE, hex, pair, toLongHex } from '@/lib/brandPalette';
import { contrastRatio } from '@/lib/contrast';

const { charcoal, beige } = BRAND_PALETTE;

const MIN_FOCUS_CONTRAST = 3;

/**
 * Footer colours resolved from the Visual settings, as CSS custom properties for the footer root.
 * Hover and focus read them through Tailwind classes (hover:text-[color:var(--ftr-link-hover)]),
 * so no inline style or mouse handler can override a state class.
 *
 * primaryColor is read only for the legacy look (company name and tinted borders), and only while
 * useGradient is on, so production keeps its look until the brand preset (which turns it off) is applied.
 * The preset instead underlines the signature link, so it is not told apart from the text by colour alone,
 * and drops the 80% opacity that would pull the grey text under AA.
 */
export const buildFooterTheme = (s = {}) => {
  const [text, bg] = pair(s.footerTextColor, s.footerBgColor, '#374151', '#ffffff');
  const link = hex(s.footerLinkColor, text);
  const ring = hex(s.focusRingColor, charcoal);

  const theme = {
    backgroundColor: bg,
    '--ftr-text': text,
    '--ftr-link': link,
    '--ftr-link-hover': hex(s.footerLinkHoverColor, link),
    '--ftr-focus': contrastRatio(ring, bg) >= MIN_FOCUS_CONTRAST ? ring : text,
  };

  if (s.useGradient) {
    const primary = hex(s.primaryColor);
    const tint = primary ? toLongHex(primary) : null;
    return {
      ...theme,
      '--ftr-brand': primary || link,
      '--ftr-border': tint ? `${tint}20` : hex(s.borderColor, beige),
      '--ftr-divider': tint ? `${tint}10` : hex(s.borderColor, beige),
      '--ftr-text-opacity': '0.8',
      '--ftr-link-decoration': 'none',
    };
  }

  const border = hex(s.borderColor, beige);
  return {
    ...theme,
    '--ftr-brand': hex(s.headingColor, text),
    '--ftr-border': border,
    '--ftr-divider': border,
    '--ftr-text-opacity': '1',
    '--ftr-link-decoration': 'underline',
  };
};
