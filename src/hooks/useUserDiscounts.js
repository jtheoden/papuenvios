import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserCategoryWithDiscount } from '@/lib/orderDiscountService';

/**
 * Centralized hook to load and expose user discount information
 * so all views (cart, products, combos, orders) display consistent data.
 */
export const useUserDiscounts = () => {
  const { user, userCategory } = useAuth();
  const [categoryInfo, setCategoryInfo] = useState({ category: 'regular', discountPercent: 0, enabled: false });
  const [loading, setLoading] = useState(false);

  const loadCategory = useCallback(async () => {
    if (!user?.id) {
      setCategoryInfo({ category: 'regular', discountPercent: 0, enabled: false });
      return;
    }

    try {
      setLoading(true);
      const info = await getUserCategoryWithDiscount(user.id);

      // Fallback to category provided by AuthContext if Supabase query returns nothing
      const fallbackCategory = userCategory?.category_name || userCategory?.category || userCategory?.categoryName;
      const fallbackDiscount = userCategory?.discount_percentage || userCategory?.discountPercent;

      const resolvedCategory = info.category || fallbackCategory || 'regular';
      const resolvedDiscount = info.enabled === false
        ? 0
        : (info.discountPercent ?? fallbackDiscount ?? 0);

      setCategoryInfo({
        category: resolvedCategory,
        discountPercent: resolvedDiscount,
        enabled: Boolean(resolvedDiscount > 0 && info.enabled !== false),
        categoryDiscount: info.categoryDiscount || null
      });
    } catch (error) {
      console.error('Error loading user discount info:', error);
      setCategoryInfo({ category: 'regular', discountPercent: 0, enabled: false });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadCategory();
  }, [loadCategory]);

  return {
    categoryInfo,
    categoryDiscountPercent: categoryInfo.discountPercent || 0,
    isDiscountLoading: loading,
    reloadUserDiscount: loadCategory
  };
};

export default useUserDiscounts;
