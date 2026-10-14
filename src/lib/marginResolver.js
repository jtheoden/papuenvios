/**
 * Margin resolution helpers (pure, no I/O).
 * Precedence: product > category > global.
 */

export const MARGIN_MIN = 0;
export const MARGIN_MAX = 999.99;

const toUsableNumber = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {{ product?: unknown, category?: unknown, global?: unknown }} [sources]
 * @returns {{ value: number, source: 'product'|'category'|'global' } | null}
 */
export const resolveMargin = ({ product, category, global } = {}) => {
  const candidates = [
    ['product', product],
    ['category', category],
    ['global', global]
  ];

  for (const [source, raw] of candidates) {
    const value = toUsableNumber(raw);
    if (value !== null) return { value, source };
  }
  return null;
};

/**
 * A valid margin percent is a finite number within 0..999.99
 * (matches numeric(5,2) columns and the DB CHECK constraints).
 * @param {unknown} value
 * @returns {boolean}
 */
export const validateMarginPercent = (value) => {
  const n = toUsableNumber(value);
  return n !== null && n >= MARGIN_MIN && n <= MARGIN_MAX;
};
