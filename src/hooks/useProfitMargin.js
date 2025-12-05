import { useMemo } from 'react';
import { useSettings } from '@/contexts/SettingsContext';

/**
 * useProfitMargin Hook
 *
 * Centralizes profit margin calculation logic
 * Eliminates duplicate margin calculations across components
 *
 * @param {Object} options - Configuration options
 * @param {string} options.itemType - Type of item: 'product' | 'combo' | 'remittance'
 * @param {string} options.categoryId - Optional category ID for category-specific margins
 * @param {number} options.overridePercent - Optional override percentage (0-100)
 *
 * @returns {Object} Margin information
 *   - percentageValue: Number (35 for 35%)
 *   - multiplier: Number (1.35 for 35% markup)
 *   - apply(basePrice): Function to apply margin to base price
 *   - applyAsync(basePrice): Async version for async operations
 */
export const useProfitMargin = ({ itemType = 'product', categoryId = null, overridePercent = null } = {}) => {
  const { financialSettings } = useSettings();

  const profitData = useMemo(() => {
    // Use override if provided
    if (overridePercent !== null && !isNaN(overridePercent)) {
      const percent = parseFloat(overridePercent);
      return {
        percentageValue: percent,
        multiplier: 1 + percent / 100
      };
    }

    // Determine margin based on item type
    let marginPercent = 40; // Default fallback

    if (financialSettings) {
      switch (itemType.toLowerCase()) {
        case 'product':
          marginPercent = parseFloat(financialSettings.productProfit) || 40;
          break;
        case 'combo':
          marginPercent = parseFloat(financialSettings.comboProfit) || 35;
          break;
        case 'remittance':
          marginPercent = parseFloat(financialSettings.remittanceProfit) || 10;
          break;
        default:
          marginPercent = 40;
      }
    }

    return {
      percentageValue: marginPercent,
      multiplier: 1 + marginPercent / 100
    };
  }, [itemType, categoryId, financialSettings, overridePercent]);

  /**
   * Apply profit margin to base price
   * @param {number} basePrice - Original price
   * @returns {number} Price with margin applied
   */
  const apply = (basePrice) => {
    if (!basePrice || isNaN(basePrice)) return 0;
    return parseFloat(basePrice) * profitData.multiplier;
  };

  /**
   * Async version for use in async contexts
   * Currently same as sync version but separated for future extension
   * @param {number} basePrice - Original price
   * @returns {Promise<number>} Price with margin applied
   */
  const applyAsync = async (basePrice) => {
    return apply(basePrice);
  };

  return {
    ...profitData,
    apply,
    applyAsync
  };
};

export default useProfitMargin;
