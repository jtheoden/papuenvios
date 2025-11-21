import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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
  const refreshProducts = async () => {
    try {
      setError(null);
      const { data, error } = await getProducts();
      if (error) throw error;
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
      const { data, error } = await getCategories();
      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error refreshing categories:', error);
      setError(error.message);
    }
  };

  // Fetch combos from Supabase
  const refreshCombos = async (includeInactive = false) => {
    try {
      const { data, error } = await getCombos(includeInactive);
      if (error) throw error;

      // Get current products to check stock
      const { data: productsData } = await getProducts();
      const productsMap = {};
      (productsData || []).forEach(p => {
        productsMap[p.id] = p;
      });

      // Transform to match existing format with quantities
      const transformedCombos = (data || []).map(c => {
        const productQuantities = {};
        const products = c.items?.map(i => {
          productQuantities[i.product.id] = i.quantity;
          return i.product.id;
        }) || [];

        // Check if combo should be active based on product stock
        let hasInsufficientStock = false;
        for (const productId of products) {
          const product = productsMap[productId];
          const requiredQuantity = productQuantities[productId] || 1;
          const availableStock = product?.stock || 0;

          if (availableStock === 0 || availableStock < requiredQuantity) {
            hasInsufficientStock = true;
            break;
          }
        }

        // Auto-deactivate combo if it has insufficient stock
        if (hasInsufficientStock && c.is_active) {
          supabase
            .from('combo_products')
            .update({ is_active: false })
            .eq('id', c.id)
            .then(() => console.log(`Combo ${c.id} auto-deactivated due to insufficient stock`));
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
          is_active: hasInsufficientStock ? false : c.is_active
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
      const { data, error } = await getTestimonials(adminView);
      if (error) throw error;
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
      const { data, error } = await getCarouselSlides(activeOnly);
      if (error) throw error;
      setCarouselSlides(data || []);
    } catch (error) {
      console.error('Error refreshing carousel slides:', error);
      setError(error);
    }
  };

  // Initial data load
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      await Promise.all([
        refreshProducts(),
        refreshCategories(),
        refreshCombos(),
        refreshTestimonials(false),
        refreshCarouselSlides(false)
      ]);
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
