// Footer classes, shared by Footer.jsx and the Settings > Visual preview so both paint the same.
// Colours come from the footer CSS variables (see footerTheme.js); hover and focus are classes, never inline styles.
const FOCUS = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ftr-focus)] focus-visible:ring-offset-2 motion-reduce:transition-none';

export const LINK = `text-[color:var(--ftr-link)] hover:text-[color:var(--ftr-link-hover)] transition-colors duration-200 ${FOCUS}`;
export const LEGAL_LINK = `${LINK} underline`;
export const SIGNATURE = `text-[color:var(--ftr-link)] hover:text-[color:var(--ftr-sig-hover)] transition-colors duration-200 ${FOCUS} [text-decoration-line:var(--ftr-link-decoration)] underline-offset-2 font-semibold`;
export const MUTED = 'text-[color:var(--ftr-text)] opacity-[var(--ftr-text-opacity)]';
export const BRAND = 'text-[color:var(--ftr-brand)] font-semibold';
export const FOOTER_ROOT = 'border-t border-[color:var(--ftr-border)]';
export const FOOTER_DIVIDER = 'border-t border-[color:var(--ftr-divider)]';
