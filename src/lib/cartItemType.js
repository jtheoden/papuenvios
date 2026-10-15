/**
 * Order item type for a cart entry.
 *
 * Combos are recognised by an explicit `type: 'combo'` OR by carrying a `products`
 * array (the same rule CartPage and ProductDetailPage use to tell them apart).
 * Without the second rule, a combo added from the detail page (which does not set
 * `type`) was stored as item_type 'product' and escaped stock handling.
 *
 * @param {{ type?: string, products?: unknown }} item
 * @returns {'product' | 'combo'}
 */
export const resolveCartItemType = (item) => {
  if (item?.type === 'combo') return 'combo';
  if (item?.products) return 'combo';
  return 'product';
};
