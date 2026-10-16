/**
 * Pure path <-> page mapping for the app's history-API navigation.
 * vercel.json rewrites every URL to index.html, so these paths are shareable and reload-safe.
 */

export const PAGE_PATHS = {
  home: '/',
  products: '/products',
  remittances: '/remittances',
  'send-remittance': '/remittances/send',
  'my-remittances': '/remittances/my',
  recipients: '/recipients',
  dashboard: '/dashboard',
  admin: '/admin',
  settings: '/settings',
  cart: '/cart',
  login: '/login',
  'user-panel': '/user-panel',
  'user-management': '/user-management',
  blog: '/blog',
  terms: '/terms',
  privacy: '/privacy',
  'auth/callback': '/auth/callback',
};

const PATH_PAGES = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page])
);

export const normalizePath = (path) => path.replace(/\/$/, '') || '/';

/**
 * @param {string} path - location.pathname
 * @returns {{page: string, params?: {itemId: string, itemType: 'product'|'combo'}}}
 */
export const resolvePageFromPathname = (path) => {
  const normalized = normalizePath(path);

  const productMatch = normalized.match(/^\/product\/([^/]+)$/);
  if (productMatch) {
    return { page: 'product-detail', params: { itemId: productMatch[1], itemType: 'product' } };
  }

  const comboMatch = normalized.match(/^\/combo\/([^/]+)$/);
  if (comboMatch) {
    return { page: 'product-detail', params: { itemId: comboMatch[1], itemType: 'combo' } };
  }

  return { page: PATH_PAGES[normalized] || 'home' };
};

/**
 * @param {string} page
 * @returns {string} URL path for the page ('/' when unknown)
 */
export const pageToPath = (page) => PAGE_PATHS[page] || '/';

/** Pages where the footer must not repeat the regulatory notice (contextual notice or admin UI). */
const FOOTER_NOTICE_HIDDEN_PAGES = new Set([
  'cart',
  'send-remittance',
  'admin',
  'dashboard',
  'settings',
  'user-management',
]);

/**
 * @param {string} page
 * @returns {boolean} Whether the footer should render the regulatory notice on this page
 */
export const shouldShowFooterNotice = (page) => !FOOTER_NOTICE_HIDDEN_PAGES.has(page);
