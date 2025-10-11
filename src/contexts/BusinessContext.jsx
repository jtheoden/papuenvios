import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getProducts, getCategories } from '@/lib/productService';
import { getCombos } from '@/lib/comboService';
import { getTestimonials } from '@/lib/testimonialService';
import { getCarouselSlides } from '@/lib/carouselService';

const BusinessContext = createContext();

const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue];
};

export const BusinessProvider = ({ children }) => {
  // State for Supabase-backed data
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // State for localStorage-backed data (cart and settings)
  const [cart, setCart] = useLocalStorage('cart', []);
  const [zelleAccounts, setZelleAccounts] = useLocalStorage('zelleAccounts', [
    { id: 1, email: 'payment1@example.com', name: 'Main Sales', forProducts: true, forRemittances: false, active: true, payments: { weekly: 12, monthly: 50, yearly: 600, total: 1500 } },
    { id: 2, email: 'remit@example.com', name: 'Remittances Only', forProducts: false, forRemittances: true, active: true, payments: { weekly: 5, monthly: 20, yearly: 250, total: 400 } },
  ]);
  const [financialSettings, setFinancialSettings] = useLocalStorage('financialSettings', {
    usdToLocal: 36.5,
    currencies: [
      { code: 'USD', name: 'US Dollar', rate: 1, symbol: '$' },
      { code: 'EUR', name: 'Euro', rate: 0.92, symbol: '€' },
    ],
    productProfit: 40,
    comboProfit: 35,
    remittanceProfit: 5,
    // Shipping configuration
    shippingType: 'undetermined', // 'free', 'fixed', 'undetermined', 'calculated'
    shippingFixedAmount: 0,
    shippingFreeThreshold: 100, // Free shipping over this amount
  });
  const [notificationSettings, setNotificationSettings] = useLocalStorage('notificationSettings', {
    whatsapp: '',
    whatsappGroup: '',
    adminEmail: '',
  });
  const [visualSettings, setVisualSettings] = useLocalStorage('visualSettings', {
    logo: '',
    favicon: '',
    companyName: 'PapuEnvíos',
    // Brand colors
    primaryColor: '#2563eb',
    secondaryColor: '#9333ea',
    useGradient: true,
    // Header colors
    headerBgColor: '#ffffff',
    headerTextColor: '#1f2937',
    // Text/Heading colors
    headingColor: '#1f2937',
    useHeadingGradient: true,
    // Button colors
    buttonBgColor: '#2563eb',
    buttonTextColor: '#ffffff',
    buttonHoverBgColor: '#1d4ed8',
    // Destructive button colors
    destructiveBgColor: '#dc2626',
    destructiveTextColor: '#ffffff',
    destructiveHoverBgColor: '#b91c1c',
    // Accent colors
    accentColor: '#9333ea',
    // Background colors
    pageBgColor: '#f9fafb',
    cardBgColor: '#ffffff'
  });

  // Fetch products from Supabase
  const refreshProducts = async () => {
    try {
      setError(null);
      const { data, error } = await getProducts();
      if (error) throw error;

      // Keep the full product data structure from the service
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

      // Keep the full category data structure from the service
      setCategories(data || []);
    } catch (error) {
      console.error('Error refreshing categories:', error);
      setError(error.message);
      // Don't clear categories on error, keep existing data
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
          // Update combo in database to set is_active = false
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
        refreshTestimonials(false), // Public view
        refreshCarouselSlides(false) // All slides for admin
      ]);
      setLoading(false);
    };

    loadInitialData();
  }, []);

  const addProduct = (product) => setProducts(prev => [...prev, product]);
  const updateProduct = (updatedProduct) => setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
  const addToCart = (product) => {
    setCart(prev => {
      const existingItem = prev.find(item => item.id === product.id);
      if (existingItem) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };
  const removeFromCart = (productId) => setCart(prev => prev.filter(item => item.id !== productId));
  const updateCartQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(prev => prev.map(item => item.id === productId ? { ...item, quantity } : item));
  };
  const clearCart = () => setCart([]);

  const value = {
    products, addProduct, updateProduct, refreshProducts,
    combos, setCombos, refreshCombos,
    cart, addToCart, removeFromCart, updateCartQuantity, clearCart,
    categories, setCategories, refreshCategories,
    testimonials, setTestimonials, refreshTestimonials,
    carouselSlides, setCarouselSlides, refreshCarouselSlides,
    zelleAccounts, setZelleAccounts,
    financialSettings, setFinancialSettings,
    notificationSettings, setNotificationSettings,
    visualSettings, setVisualSettings,
    loading,
    error,
    exchangeRate: financialSettings.currencies.find(c => c.code === 'USD')?.rate || 1,
  };

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
};

export const useBusiness = () => {
  const context = useContext(BusinessContext);
  if (context === undefined) {
    throw new Error('useBusiness must be used within a BusinessProvider');
  }
  return context;
};