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

  it('no module requests a wildcard from a guarded table any more (Phase 0b moved the admin reads to RPCs)', () => {
    expect(wildcardChains()).toEqual([]);
  });
});

// Ratchet: the only modules allowed to name a sensitive column. After Phase 0b none of them
// QUERIES a hidden column any more (see the next describe): each one either consumes rows that
// the admin_list_* RPCs merged in (src/lib/adminCostService.js), edits those values in a form, or
// writes them in an insert/update payload (column UPDATE privileges stay). DashboardPage left
// the list when it moved to the RPCs. A new file appearing here means a new dependency on a
// column that the contract file hides: read it through an RPC instead.
const ADMIN_ONLY_SENSITIVE_COLUMN_READERS = [
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
  it('lists exactly the admin modules that still name a cost column (as data or as a write payload)', () => {
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

describe('no query reads a hidden column (it would fail with 42501 after the contract file)', () => {
  // First argument of the PostgREST builder methods that make the database READ or FILTER a column.
  const READ_CALL = /\.(select|order|eq|neq|gt|gte|lt|lte|in|is|like|ilike|or|filter|not)\(\s*(['"`])([\s\S]*?)\2/g;

  const offenders = () => {
    const found = [];
    listSourceFiles(resolve(ROOT, 'src')).forEach((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(READ_CALL)) {
        const hidden = sensitiveIn(match[3]);
        if (hidden.length) found.push(`${relative(ROOT, file)}: .${match[1]}(${hidden.join(', ')})`);
      }
    });
    return found.sort();
  };

  it('no .select / .order / filter call names a sensitive column anywhere in src', () => {
    expect(offenders()).toEqual([]);
  });

  // admin_list_refunds is a different RPC (refunds queue); only its own client may call it.
  const REFUND_RPC_ALLOWLIST = ['src/lib/refundService.js'];

  it('the admin cost RPC wrapper is the only module that calls the admin_list_* cost functions (refundService.js is allow-listed for admin_list_refunds)', () => {
    const callers = listSourceFiles(resolve(ROOT, 'src'))
      // admin_list_deliveries_without_accrual belongs to the courier module (courierService), not to the cost RPCs
      .filter((file) => /admin_list_(?!deliveries_without_accrual)/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(ROOT, file))
      .filter((file) => !REFUND_RPC_ALLOWLIST.includes(file));
    expect(callers).toEqual(['src/lib/adminCostService.js']);
  });
});
