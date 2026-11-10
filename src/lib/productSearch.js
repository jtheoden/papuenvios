/**
 * Lowercase, accent-insensitive (NFD) form of a value, trimmed.
 * @param {unknown} value
 * @returns {string}
 */
export const normalizeSearchText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
};

/**
 * Pure, non-mutating product filter used by admin pickers.
 * Matches name_es, name_en (and legacy name) and sku, ignoring case and accents.
 * An empty or whitespace-only query returns a copy of the full list.
 * @param {Array<object>} products
 * @param {string} query
 * @returns {Array<object>}
 */
export const filterProducts = (products, query) => {
  const list = Array.isArray(products) ? products : [];
  const needle = normalizeSearchText(query);
  if (!needle) return [...list];
  return list.filter((p) =>
    [p?.name_es, p?.name_en, p?.name, p?.sku].some((field) => normalizeSearchText(field).includes(needle))
  );
};
