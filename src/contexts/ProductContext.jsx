import { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  getProducts,
  getProductRows,
  getProductStock,
  mergeProductStock,
  getCategories
} from '@/lib/productService';
import { useAuth } from '@/contexts/AuthContext';
import { getCombos } from '@/lib/comboService';
import { getTestimonials } from '@/lib/testimonialService';
import { getCarouselSlides } from '@/lib/carouselService';
import { loadCached, invalidateCatalog } from '@/lib/catalogCache';
import { classifyCatalogError } from '@/lib/catalogErrors';

const ProductContext = createContext();

const EMPTY_STOCK = { stock: {}, expiry: {} };

// A combo has stock issues when any of its products lacks the required quantity.
const comboHasStockIssues = (productIds, productQuantities, productsMap) => {
  if (Object.keys(productsMap).length === 0) return false;
  for (const productId of productIds) {
    const product = productsMap[productId];
    if (!product) continue;

    const requiredQuantity = productQuantities[productId] || 1;
    const availableStock = product?.stock ?? 0;

    if (availableStock === 0 || availableStock < requiredQuantity) return true;
  }
  return false;
};

const toProductsMap = (productsData) => {
  const map = {};
  (productsData || []).forEach(p => {
    map[p.id] = p;
  });
  return map;
};

// Raw combo rows -> UI shape, with stock issues computed from the given products.
const buildCombos = (rawCombos, productsMap) =>
  (rawCombos || []).map(c => {
    const productQuantities = {};
    const comboProducts = (c.items || []).reduce((acc, item) => {
      const productId = item?.product?.id;

      if (!productId) {
        console.warn('[refreshCombos] Missing product in combo item', { comboId: c.id, item });
        return acc;
      }

      productQuantities[productId] = item.quantity;
      acc.push(productId);
      return acc;
    }, []);

    return {
      id: c.id,
      name: c.name_es,
      description: c.description_es,
      image: c.image_url,
      products: comboProducts,
      productQuantities: productQuantities,
      items: c.items || [],
      // Stored sale price (base currency): the only price the public catalog shows.
      finalPrice: c.final_price,
      // Cost fields only exist on the admin view of the rows; the public rows omit them.
      profitMargin: c.profit_margin,
      baseTotalPrice: c.base_total_price,
      is_active: c.is_active,
      hasStockIssues: comboHasStockIssues(comboProducts, productQuantities, productsMap)
    };
  });

/**
 * ProductContext
 * Manages catalog data: products, categories, combos, testimonials, carousel slides
 * Separated from BusinessContext for better performance and modularity
 *
 * Only re-renders components that depend on product/catalog data
 *
 * Public catalog rows (products, categories, combos, carousel) go through a short
 * in-memory stale-while-revalidate cache (see catalogCache). Stock is never cached:
 * it is read fresh on every load and via refreshStock().
 */
export const ProductProvider = ({ children }) => {
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Public catalog load failure ({ kind: 'permission' | 'load' }), shown instead of an empty catalog
  const [catalogError, setCatalogError] = useState(null);
  const { userRole } = useAuth();
  // Category profit margins are internal: only admins load them
  const canSeeMargins = userRole === 'admin' || userRole === 'super_admin';

  // Latest products/combo rows, readable from async callbacks without stale closures
  const productsRef = useRef([]);
  const rawCombosRef = useRef([]);
  const commitProducts = (next) => {
    productsRef.current = next;
    setProducts(next);
  };

  // A permission failure outranks a generic one: it is the one a reload can fix (stale bundle).
  const recordCatalogFailure = (failure) => {
    const kind = classifyCatalogError(failure);
    setCatalogError(prev => (prev?.kind === 'permission' ? prev : { kind }));
  };

  // Public products: cached rows + fresh stock, loaded in parallel
  const loadPublicProducts = async () => {
    const [{ data: rows }, stockData] = await Promise.all([
      loadCached('products:public', () => getProductRows(false), {
        // Background revalidation: keep the stock we already have for each product
        onUpdate: (freshRows) => {
          const current = toProductsMap(productsRef.current);
          commitProducts(freshRows.map(row => ({
            ...row,
            stock: current[row.id]?.stock ?? 0,
            expiry_date: current[row.id]?.expiry_date ?? null
          })));
        }
      }),
      getProductStock().catch(() => EMPTY_STOCK)
    ]);
    return mergeProductStock(rows, stockData);
  };

  // Fetch products from Supabase
  // includeInactive=true is the admin view: it always bypasses (and invalidates) the public cache
  const refreshProducts = async (includeInactive = false) => {
    try {
      setError(null);
      const loaded = includeInactive
        ? (invalidateCatalog(), (await getProducts(true)) || [])
        : await loadPublicProducts();
      commitProducts(loaded);
      return loaded;
    } catch (error) {
      console.error('Error refreshing products:', error);
      setError(error.message);
      if (!includeInactive) recordCatalogFailure(error);
    }
  };

  // Display-only stock refresh: re-reads inventory (not products) and merges it in.
  // Availability stays server-authoritative (reserve_order_inventory).
  const refreshStock = async () => {
    try {
      const stockData = await getProductStock();
      const merged = mergeProductStock(productsRef.current, stockData);
      commitProducts(merged);
      const productsMap = toProductsMap(merged);
      setCombos(prev => prev.map(combo => ({
        ...combo,
        hasStockIssues: comboHasStockIssues(combo.products, combo.productQuantities, productsMap)
      })));
    } catch {
      // Keep the previous values: stock display is best-effort
    }
  };

  // Cached loader for rows that rarely change; applies stale data instantly
  // and the revalidated data when it arrives.
  const loadThroughCache = async (key, fetcher, apply) => {
    const { data } = await loadCached(key, fetcher, { onUpdate: apply });
    apply(data || []);
  };

  // Fetch categories from Supabase
  const refreshCategories = async () => {
    try {
      setError(null);
      await loadThroughCache(
        canSeeMargins ? 'categories:margin' : 'categories:public',
        () => getCategories(canSeeMargins ? { includeMargin: true } : undefined),
        setCategories
      );
    } catch (error) {
      console.error('Error refreshing categories:', error);
      setError(error.message);
      if (!canSeeMargins) recordCatalogFailure(error);
    }
  };

  // Combo rows: cached for the public view, direct for the admin view
  const fetchRawCombos = async (includeInactive) => {
    if (includeInactive) {
      return getCombos(true);
    }
    const { data } = await loadCached('combos:public', () => getCombos(false), {
      onUpdate: (freshRaw) => {
        rawCombosRef.current = freshRaw;
        setCombos(buildCombos(freshRaw, toProductsMap(productsRef.current)));
      }
    });
    return data;
  };

  // Fetch combos from Supabase
  // @param {Array|Promise|null} preloadedProducts - Optional pre-fetched products (or the promise of
  //   them) to avoid a duplicate query; the combos query itself never waits for them
  const refreshCombos = async (includeInactive = false, preloadedProducts = null) => {
    try {
      const data = await fetchRawCombos(includeInactive);
      rawCombosRef.current = data || [];

      // Products only come from the network when none are loaded yet
      let productsMap = {};
      try {
        const productsData = (await preloadedProducts)
          || (productsRef.current.length ? productsRef.current : await getProducts());
        productsMap = toProductsMap(productsData);
      } catch (productError) {
        console.error('Error refreshing products for combos:', productError);
      }

      setCombos(buildCombos(data, productsMap));
    } catch (error) {
      console.error('Error refreshing combos:', error);
      if (!includeInactive) recordCatalogFailure(error);
    }
  };

  // Fetch testimonials from Supabase
  const refreshTestimonials = async (adminView = false) => {
    try {
      setError(null);
      const data = await getTestimonials(adminView);
      setTestimonials(data || []);
    } catch (error) {
      console.error('Error refreshing testimonials:', error);
      setError(error);
    }
  };

  // Fetch carousel slides from Supabase
  const refreshCarouselSlides = async (activeOnly = false) => {
    try {
      setError(null);
      await loadThroughCache(
        activeOnly ? 'carousel:active' : 'carousel:all',
        () => getCarouselSlides(activeOnly),
        setCarouselSlides
      );
    } catch (error) {
      console.error('Error refreshing carousel slides:', error);
      setError(error);
    }
  };

  // Initial data load: everything runs in parallel; combos only need the
  // products once both are in, so the stock check is computed after the join.
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      setCatalogError(null);
      const [productsData, rawCombos] = await Promise.all([
        loadPublicProducts().catch(err => {
          console.error('Error loading products:', err);
          recordCatalogFailure(err);
          return [];
        }),
        fetchRawCombos(false).catch(err => {
          console.error('Error refreshing combos:', err);
          recordCatalogFailure(err);
          return [];
        }),
        refreshCategories(),
        refreshTestimonials(false),
        refreshCarouselSlides(false)
      ]);
      commitProducts(productsData || []);
      rawCombosRef.current = rawCombos || [];
      setCombos(buildCombos(rawCombos, toProductsMap(productsData)));
      setLoading(false);
    };

    loadInitialData();
  }, []);

  // The role resolves after sign-in/out: reload categories when margin visibility changes
  // (the initial load above already used the value at mount time)
  const previousCanSeeMargins = useRef(canSeeMargins);
  useEffect(() => {
    if (previousCanSeeMargins.current === canSeeMargins) return;
    previousCanSeeMargins.current = canSeeMargins;
    refreshCategories();
  }, [canSeeMargins]);

  // Helper functions for products
  const addProduct = (product) => commitProducts([...productsRef.current, product]);
  const updateProduct = (updatedProduct) => commitProducts(
    productsRef.current.map(p => p.id === updatedProduct.id ? updatedProduct : p)
  );

  const value = {
    // Products
    products,
    addProduct,
    updateProduct,
    refreshProducts,
    refreshStock,
    // Combos
    combos,
    setCombos,
    refreshCombos,
    // Categories
    categories,
    setCategories,
    refreshCategories,
    // Testimonials
    testimonials,
    setTestimonials,
    refreshTestimonials,
    // Carousel
    carouselSlides,
    setCarouselSlides,
    refreshCarouselSlides,
    // State
    loading,
    error,
    catalogError
  };

  return (
    <ProductContext.Provider value={value}>
      {children}
    </ProductContext.Provider>
  );
};

export const useProducts = () => {
  const context = useContext(ProductContext);
  if (context === undefined) {
    throw new Error('useProducts must be used within a ProductProvider');
  }
  return context;
};
