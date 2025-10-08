/**
 * Remittance Configuration Service
 * Manages remittance types and payment methods
 */

import { supabase } from '@/lib/supabase';

/**
 * Get all remittance configurations
 * @returns {Promise<{success: boolean, configs: Array, error?: string}>}
 */
export const getRemittanceConfigs = async () => {
  try {
    // For now, return default configs
    // TODO: Implement proper storage when remittance configurations table is created
    return {
      success: true,
      configs: getDefaultRemittanceConfigs()
    };
  } catch (error) {
    console.error('Error fetching remittance configs:', error);
    return { success: false, configs: getDefaultRemittanceConfigs(), error: error.message };
  }
};

/**
 * Default remittance configurations
 */
export const getDefaultRemittanceConfigs = () => [
  {
    id: 'temp-mn',
    currency: 'MN',
    name: 'Moneda Nacional',
    enabled: true,
    paymentMethods: [
      { id: 'cash', name: 'Efectivo', enabled: true },
      { id: 'transfer', name: 'Transferencia', enabled: true }
    ],
    isNew: true
  },
  {
    id: 'temp-usd',
    currency: 'USD',
    name: 'Dólar Estadounidense',
    enabled: true,
    paymentMethods: [
      { id: 'cash', name: 'Efectivo', enabled: true },
      { id: 'card_transfer', name: 'Transferencia Tarjeta Clásica', enabled: true }
    ],
    isNew: true
  },
  {
    id: 'temp-mlc',
    currency: 'MLC',
    name: 'Moneda Libremente Convertible',
    enabled: true,
    paymentMethods: [
      { id: 'card', name: 'Tarjeta MLC', enabled: true }
    ],
    isNew: true
  }
];

/**
 * Create or update remittance configuration
 * @param {Object} config - Configuration object
 * @returns {Promise<{success: boolean, config?: Object, error?: string}>}
 */
export const saveRemittanceConfig = async (config) => {
  try {
    // TODO: Implement when remittance configurations table is created
    console.warn('Remittance config save not implemented yet');
    return {
      success: true,
      config: config
    };
  } catch (error) {
    console.error('Error saving remittance config:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete remittance configuration
 * @param {string} configId - Configuration ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteRemittanceConfig = async (configId) => {
  try {
    // TODO: Implement when remittance configurations table is created
    console.warn('Remittance config delete not implemented yet');
    return { success: true };
  } catch (error) {
    console.error('Error deleting remittance config:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get enabled remittance configs for customer-facing forms
 * @returns {Promise<{success: boolean, configs: Array, error?: string}>}
 */
export const getEnabledRemittanceConfigs = async () => {
  try {
    const result = await getRemittanceConfigs();
    if (!result.success) return result;

    const enabledConfigs = result.configs.filter(config => config.enabled !== false);

    return { success: true, configs: enabledConfigs };
  } catch (error) {
    console.error('Error fetching enabled remittance configs:', error);
    return { success: false, configs: [], error: error.message };
  }
};

/**
 * Get payment methods for a specific currency
 * @param {string} currency - Currency code (MN, USD, MLC)
 * @returns {Promise<{success: boolean, methods: Array, error?: string}>}
 */
export const getPaymentMethodsForCurrency = async (currency) => {
  try {
    const result = await getRemittanceConfigs();
    if (!result.success) return { success: false, methods: [], error: result.error };

    const config = result.configs.find(c => c.currency === currency);
    if (!config) {
      return { success: false, methods: [], error: 'Currency not found' };
    }

    const enabledMethods = config.paymentMethods?.filter(m => m.enabled !== false) || [];

    return { success: true, methods: enabledMethods };
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return { success: false, methods: [], error: error.message };
  }
};
