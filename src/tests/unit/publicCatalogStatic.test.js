import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

// Static guard for Phase 0a: the public catalog path must not depend on sensitive columns,
// nor request "everything" (select('*'), empty .select(), (*) embeds) from the guarded tables.

const ROOT = resolve(process.cwd());
const read = (file) => readFileSync(resolve(ROOT, file), 'utf8');

// Comments may mention the columns (history, rationale); only executable code counts.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SENSITIVE_TOKENS = [
  'base_price', 'cost_price', 'profit_margin', 'cost_per_unit', 'supplier_reference',
  'base_total_price', 'transport_cost',
  'basePrice', 'costPrice', 'profitMargin', 'costPerUnit', 'supplierReference',
  'baseTotalPrice', 'transportCost'
];

const sensitiveIn = (code) => SENSITIVE_TOKENS.filter((token) => new RegExp(`\\b${token}\\b`).test(code));

const WILDCARD = /\.select\(\s*\)|\.select\(\s*['"`]\s*\*\s*['"`]|\(\s*\*\s*\)/;

// Modules that only serve the public catalog / cart / checkout. They must be clean as a whole.
const PUBLIC_ONLY_FILES = [
  'src/lib/publicCatalogColumns.js',
  'src/lib/publicPricing.js',
  'src/lib/catalogErrors.js',
  'src/lib/cartPricing.js',
  'src/lib/orderComboService.js',
  'src/components/CatalogLoadError.jsx',
  'src/components/ProductsPage.jsx',
  'src/components/ProductDetailPage.jsx',
  'src/components/CartPage.jsx',
  'src/components/SendRemittancePage.jsx'
];

// Public functions that live in files shared with admin code: scanned function by function.
const PUBLIC_FUNCTIONS = {
  'src/lib/productService.js': ['getProductRows', 'getProductStock', 'mergeProductStock', 'getProducts', 'getCategories'],
  'src/lib/comboService.js': ['getCombos'],
  'src/lib/shippingService.js': [
    'getActiveShippingZones', 'getShippingZoneById', 'getShippingZoneByProvince',
    'getShippingZoneByMunicipality', 'getShippingZoneForLocation', 'calculateShippingCost',
    'getFreeShippingProvinces', 'getShippingStatistics', 'validateProvinceName'
  ]
};

const extractFunction = (source, name) => {
  const start = source.search(new RegExp(`^export const ${name}\\b`, 'm'));
  expect(start, `${name} must exist as a top-level export`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:export )?const \w+|^\/\*\*/m);
  return source.slice(start, next === -1 ? undefined : start + 1 + next);
};

describe('public-only modules', () => {
  it.each(PUBLIC_ONLY_FILES)('%s names no sensitive column and requests no wildcard', (file) => {
    const code = stripComments(read(file));
    expect(sensitiveIn(code)).toEqual([]);
    expect(code).not.toMatch(WILDCARD);
  });

  it('the public pages do not import the admin combo recompute', () => {
    ['src/components/ProductsPage.jsx', 'src/components/ProductDetailPage.jsx', 'src/lib/cartPricing.js'].forEach((file) => {
      expect(read(file)).not.toMatch(/computeComboPricing|calculateComboPrices/);
    });
  });
});

describe('public functions inside shared service files', () => {
  Object.entries(PUBLIC_FUNCTIONS).forEach(([file, names]) => {
    it.each(names)(`${file}: %s is clean`, (name) => {
      const code = stripComments(extractFunction(read(file), name));
      expect(sensitiveIn(code)).toEqual([]);
      expect(code).not.toMatch(WILDCARD);
    });
  });
});

const GUARDED_TABLES = [
  'products', 'combo_products', 'product_categories', 'inventory',
  'shipping_zones', 'remittance_services', 'combo_items'
];

const listSourceFiles = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'tests' ? [] : listSourceFiles(full);
    return /\.(js|jsx)$/.test(entry) ? [full] : [];
  });

describe('guarded tables are never queried with a wildcard', () => {
  const chainPattern = new RegExp(`\\.from\\(\\s*['"](${GUARDED_TABLES.join('|')})['"]\\s*\\)([\\s\\S]*?);`, 'g');

  const wildcardChains = () => {
    const found = [];
    listSourceFiles(resolve(ROOT, 'src')).forEach((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(chainPattern)) {
        if (WILDCARD.test(match[2])) found.push(`${relative(ROOT, file)}:${match[1]}`);
      }
    });
    return found.sort();
  };

  it('only the two admin shipping reads keep select(*) until Phase 0b moves them to RPCs', () => {
    expect(wildcardChains()).toEqual([
      'src/lib/shippingService.js:shipping_zones',
      'src/lib/shippingService.js:shipping_zones'
    ]);
  });
});

// Ratchet: the only modules allowed to name a sensitive column. Every entry is an admin or
// vendor screen / service that Phase 0b must move to admin read RPCs. A new file appearing
// here means a new dependency on a column that is about to be hidden.
const ADMIN_ONLY_SENSITIVE_COLUMN_READERS = [
  'src/components/DashboardPage.jsx',
  'src/components/inventory/InventoryManagement.jsx',
  'src/components/inventory/InventoryTableConfig.jsx',
  'src/components/settings/SettingsPageShipping.jsx',
  'src/components/vendor/ProductTableConfig.jsx',
  'src/components/vendor/VendorCategoriesTab.jsx',
  'src/components/vendor/VendorCombosTab.jsx',
  'src/components/vendor/VendorInventoryTab.jsx',
  'src/contexts/ProductContext.jsx',
  'src/lib/adminCatalogColumns.js',
  'src/lib/comboService.js',
  'src/lib/comboUtils.js',
  'src/lib/dashboardMetrics.js',
  'src/lib/productService.js',
  'src/lib/shippingService.js'
];

describe('sensitive column readers are frozen to the admin surface', () => {
  it('lists exactly the admin modules that Phase 0b must migrate', () => {
    const snakeCase = SENSITIVE_TOKENS.filter((token) => token.includes('_'));
    const readers = listSourceFiles(resolve(ROOT, 'src'))
      .filter((file) => !file.includes(`${join('src', 'translations')}`))
      .filter((file) => {
        const code = stripComments(readFileSync(file, 'utf8'));
        return snakeCase.some((token) => new RegExp(`\\b${token}\\b`).test(code));
      })
      .map((file) => relative(ROOT, file))
      .sort();

    expect(readers).toEqual(ADMIN_ONLY_SENSITIVE_COLUMN_READERS);
  });
});
