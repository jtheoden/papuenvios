import React, { createContext, useContext } from 'react';
import { ProductProvider, useProducts } from './ProductContext';
import { CartProvider, useCart } from './CartContext';
import { SettingsProvider, useSettings } from './SettingsContext';

const BusinessContext = createContext();

/**
 * BusinessProvider (REFACTORED)
 *
 * This provider now composes three separate contexts for better performance:
 * - ProductContext: products, combos, categories, testimonials, carousel
 * - CartContext: shopping cart
 * - SettingsContext: all configuration (financial, notification, visual, payment accounts)
 *
 * Benefits:
 * - Components only re-render when their specific data changes
 * - Better separation of concerns
 * - Easier to maintain and test
 * - More scalable architecture
 *
 * BACKWARD COMPATIBILITY:
 * - useBusiness() still works and returns combined data from all 3 contexts
 * - Existing code doesn't need immediate changes
 * - Can migrate gradually to useProducts(), useCart(), useSettings()
 *
 * MIGRATION PATH:
 * Replace: const { products, cart, visualSettings } = useBusiness();
 * With: const { products } = useProducts(); const { cart } = useCart(); const { visualSettings } = useSettings();
 */
export const BusinessProvider = ({ children }) => {
  return (
    <ProductProvider>
      <CartProvider>
        <SettingsProvider>
          <BusinessContextWrapper>{children}</BusinessContextWrapper>
        </SettingsProvider>
      </CartProvider>
    </ProductProvider>
  );
};

// Internal wrapper to combine all contexts
const BusinessContextWrapper = ({ children }) => {
  const products = useProducts();
  const cart = useCart();
  const settings = useSettings();

  // Combined value for backward compatibility
  const value = {
    // From ProductContext
    ...products,
    // From CartContext
    ...cart,
    // From SettingsContext
    ...settings
  };

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
};

/**
 * useBusiness Hook
 *
 * DEPRECATED: Use specific hooks instead
 * - useProducts() for product/catalog data
 * - useCart() for shopping cart
 * - useSettings() for all settings
 *
 * This hook is maintained for backward compatibility
 * and will return combined data from all 3 contexts
 */
export const useBusiness = () => {
  const context = useContext(BusinessContext);
  if (context === undefined) {
    throw new Error('useBusiness must be used within a BusinessProvider');
  }
  return context;
};

// Re-export individual context hooks for new code
export { useProducts } from './ProductContext';
export { useCart } from './CartContext';
export { useSettings } from './SettingsContext';
