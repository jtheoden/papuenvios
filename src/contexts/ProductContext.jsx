import { createContext, useContext, useState, useEffect } from 'react';
import { getProducts, getCategories } from '@/lib/productService';
import { getCombos } from '@/lib/comboService';
import { getTestimonials } from '@/lib/testimonialService';
import { getCarouselSlides } from '@/lib/carouselService';

const ProductContext = createContext();

/**
 * ProductContext
 * Manages catalog data: products, categories, combos, testimonials, carousel slides
 * Separated from BusinessContext for better performance and modularity
 *
 * Only re-renders components that depend on product/catalog data
 */
export const ProductProvider = ({ children }) => {
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch products from Supabase
  const refreshProducts = async (includeInactive = false) => {
    try {
      setError(null);
      const data = await getProducts(includeInactive);
      setProducts(data || []);
    } catch (error) {
      console.error('Error refreshing products:', error);
      setError(error.message);
    }
  };

  // Fetch categories from Supabase
  const refreshCategories = async () => {
    try {
      setError(null);
      const data = await getCategories();
      setCategories(data || []);
    } catch (error) {
      console.error('Error refreshing categories:', error);
      setError(error.message);
    }
  };

  // Fetch combos from Supabase
  // @param {Array|null} preloadedProducts - Optional pre-fetched products to avoid duplicate query
  const refreshCombos = async (includeInactive = false, preloadedProducts = null) => {
    try {
      const data = await getCombos(includeInactive);

      // Get current products to check stock (use preloaded if available)
      let productsMap = {};
      try {
        const productsData = preloadedProducts || (products?.length ? products : await getProducts());
        (productsData || []).forEach(p => {
          productsMap[p.id] = p;
        });
      } catch (productError) {
        console.error('Error refreshing products for combos:', productError);
      }

      // Transform to match existing format with quantities
      const transformedCombos = (data || []).map(c => {
        const productQuantities = {};
        const products = (c.items || []).reduce((acc, item) => {
          const productId = item?.product?.id;

          if (!productId) {
            console.warn('[refreshCombos] Missing product in combo item', { comboId: c.id, item });
            return acc;
          }

          productQuantities[productId] = item.quantity;
          acc.push(productId);
          return acc;
        }, []);

        // Check if combo should be active based on product stock
        let hasInsufficientStock = false;
        if (Object.keys(productsMap).length > 0) {
          for (const productId of products) {
            const product = productsMap[productId];
            if (!product) continue;

            const requiredQuantity = productQuantities[productId] || 1;
            const availableStock = product?.stock ?? 0;

            if (availableStock === 0 || availableStock < requiredQuantity) {
              hasInsufficientStock = true;
              break;
            }
          }
        }

        return {
          id: c.id,
          name: c.name_es,
          description: c.description_es,
          image: c.image_url,
          products: products,
          productQuantities: productQuantities,
          items: c.items || [],
          profitMargin: c.profit_margin,
          baseTotalPrice: c.base_total_price,
          is_active: c.is_active,
          hasStockIssues: hasInsufficientStock
        };
      });

      setCombos(transformedCombos);
    } catch (error) {
      console.error('Error refreshing combos:', error);
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
      const data = await getCarouselSlides(activeOnly);
      setCarouselSlides(data || []);
    } catch (error) {
      console.error('Error refreshing carousel slides:', error);
      setError(error);
    }
  };

  // Initial data load
  // Products load first so combos can reuse the data (avoids duplicate getProducts() query)
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      // Phase 1: Load products + lightweight parallel queries
      const [productsData] = await Promise.all([
        getProducts().catch(err => { console.error('Error loading products:', err); return []; }),
        refreshCategories(),
        refreshTestimonials(false),
        refreshCarouselSlides(false)
      ]);
      setProducts(productsData || []);
      // Phase 2: Combos need products for stock checks — pass preloaded data
      await refreshCombos(false, productsData || []);
      setLoading(false);
    };

    loadInitialData();
  }, []);

  // Helper functions for products
  const addProduct = (product) => setProducts(prev => [...prev, product]);
  const updateProduct = (updatedProduct) => setProducts(prev =>
    prev.map(p => p.id === updatedProduct.id ? updatedProduct : p)
  );

  const value = {
    // Products
    products,
    addProduct,
    updateProduct,
    refreshProducts,
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
    error
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
