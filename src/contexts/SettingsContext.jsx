import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_SETTINGS, loadNotificationSettings, getFreshNotificationSettings } from '@/lib/notificationSettingsService';

const SettingsContext = createContext();

const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = React.useState(() => {
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

/**
 * SettingsContext
 * Manages all application settings: financial, notification, visual, payment accounts
 * Separated from BusinessContext for better performance and modularity
 *
 * Only re-renders components that depend on settings
 */
export const SettingsProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [zelleAccounts, setZelleAccounts] = useLocalStorage('zelleAccounts', [
    {
      id: 1,
      email: 'payment1@example.com',
      name: 'Main Sales',
      forProducts: true,
      forRemittances: false,
      active: true,
      payments: { weekly: 12, monthly: 50, yearly: 600, total: 1500 }
    },
    {
      id: 2,
      email: 'remit@example.com',
      name: 'Remittances Only',
      forProducts: false,
      forRemittances: true,
      active: true,
      payments: { weekly: 5, monthly: 20, yearly: 250, total: 400 }
    }
  ]);

  const [financialSettings, setFinancialSettings] = useLocalStorage('financialSettings', {
    usdToLocal: 36.5,
    currencies: [
      { code: 'USD', name: 'US Dollar', rate: 1, symbol: '$' },
      { code: 'EUR', name: 'Euro', rate: 0.92, symbol: '€' }
    ],
    productProfit: 40,
    comboProfit: 35,
    remittanceProfit: 5,
    // Shipping configuration
    shippingType: 'undetermined', // 'free', 'fixed', 'undetermined', 'calculated'
    shippingFixedAmount: 0,
    shippingFreeThreshold: 100 // Free shipping over this amount
  });

  // Notification settings now loaded from Supabase system_config table
  const [notificationSettings, setNotificationSettings] = useState(DEFAULT_SETTINGS);

  // Function to refresh notification settings from DB (bypasses cache)
  const refreshNotificationSettings = useCallback(async () => {
    try {
      const settings = await getFreshNotificationSettings();
      setNotificationSettings(settings);
      return settings;
    } catch (err) {
      console.error('Failed to refresh notification settings:', err);
      return notificationSettings; // Return current if refresh fails
    }
  }, [notificationSettings]);

  // Load notification settings from Supabase on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await loadNotificationSettings();
        setNotificationSettings(settings);
      } catch (err) {
        console.error('Failed to load notification settings:', err);
        setNotificationSettings(DEFAULT_SETTINGS);
      }
    };

    if (!isAuthenticated) {
      setNotificationSettings(DEFAULT_SETTINGS);
      return;
    }

    loadSettings();
  }, [isAuthenticated]);

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

  // Helper: get exchange rate for USD
  const getExchangeRate = (currencyCode = 'USD') => {
    return financialSettings.currencies.find(c => c.code === currencyCode)?.rate || 1;
  };

  const value = {
    // Zelle accounts
    zelleAccounts,
    setZelleAccounts,
    // Financial settings
    financialSettings,
    setFinancialSettings,
    // Notification settings
    notificationSettings,
    setNotificationSettings,
    refreshNotificationSettings, // Function to refresh from DB (bypasses cache)
    // Visual settings
    visualSettings,
    setVisualSettings,
    // Helpers
    exchangeRate: getExchangeRate('USD'),
    getExchangeRate
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
