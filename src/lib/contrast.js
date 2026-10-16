const parseHex = (hex) => {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const value = parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/**
 * WCAG 2.1 contrast ratio between a foreground and a background hex colour.
 * `alpha` blends the foreground over the background first (e.g. text with opacity).
 */
export const contrastRatio = (fg, bg, alpha = 1) => {
  const back = parseHex(bg);
  const front = parseHex(fg).map((c, i) => c * alpha + back[i] * (1 - alpha));
  const [hi, lo] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};
