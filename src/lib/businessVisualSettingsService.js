/**
 * Business Visual Settings Service
 * Handles persistence of visual settings to/from Supabase database
 */

import { supabase } from '@/lib/supabase';

const LOCAL_CACHE_KEY = 'business_visual_settings_cache';
const CACHE_DURATION = 60 * 1000; // 1 minute cache

// Default settings - used when no DB record exists or on error
export const DEFAULT_VISUAL_SETTINGS = {
  logo: '',
  favicon: '',
  companyName: 'PapuEnvios',
  siteTitle: 'PapuEnvios - Remesas y E-Commerce',
  // Brand colors
  primaryColor: '#2563eb',
  secondaryColor: '#9333ea',
  useGradient: true,
  // Header colors
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
  headerMenuBgColor: '#ffffff',
  headerMenuTextColor: '#1f2937',
  headerMenuHoverBgColor: '#f3f4f6',
  headerMenuActiveColor: '#2563eb',
  // Text/Heading colors
  headingColor: '#1f2937',
  useHeadingGradient: true,
  // Tab colors
  tabActiveColor: '#2563eb',
  tabActiveBgColor: '#eff6ff',
  tabInactiveColor: '#6b7280',
  tabInactiveBgColor: '#f9fafb',
  tabHoverColor: '#1f2937',
  tabHoverBgColor: '#f3f4f6',
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
  cardBgColor: '#ffffff',
  // Logo & branding display
  showCompanyName: true,
  logoMaxHeight: 40,
  // Home page feature cards
  homeFeatures: [
    {
      id: 'products',
      icon: 'ShoppingBag',
      titleEs: 'Venta de Productos',
      titleEn: 'Product Sales',
      descriptionEs: 'Plataforma completa para vendedores independientes con cálculo automático de precios',
      descriptionEn: 'Complete platform for independent sellers with automatic price calculation',
      navigateTo: 'products',
      adminOnly: false,
      isActive: true,
      displayOrder: 0
    },
    {
      id: 'remittances',
      icon: 'DollarSign',
      titleEs: 'Remesas a Cuba',
      titleEn: 'Remittances to Cuba',
      descriptionEs: 'Envía dinero a Cuba desde USA y España de forma rápida y segura',
      descriptionEn: 'Send money to Cuba from USA and Spain quickly and securely',
      navigateTo: 'remittances',
      adminOnly: false,
      isActive: true,
      displayOrder: 1
    },
    {
      id: 'analytics',
      icon: 'TrendingUp',
      titleEs: 'Panel de Ganancias',
      titleEn: 'Profit Dashboard',
      descriptionEs: 'Visualiza tus ganancias diarias y mensuales en tiempo real',
      descriptionEn: 'View your daily and monthly profits in real time',
      navigateTo: 'dashboard',
      adminOnly: true,
      isActive: true,
      displayOrder: 2
    },
    {
      id: 'vendors',
      icon: 'Users',
      titleEs: 'Gestión de Vendedores',
      titleEn: 'Vendor Management',
      descriptionEs: 'Herramientas completas para que vendedores independientes gestionen su inventario',
      descriptionEn: 'Complete tools for independent vendors to manage inventory',
      navigateTo: 'admin',
      adminOnly: true,
      isActive: true,
      displayOrder: 3
    }
  ],
  // Nav bar active item colors (decoupled from buttons)
  navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff',
  // Header interaction states
  headerMenuHoverTextColor: '#1f2937',
  headerMenuActiveBgColor: '#eff6ff',
  useHeaderGradient: false,
  headerGradientColor: '#9333ea',
  // Semantic status colors
  successColor: '#10b981',
  warningColor: '#f59e0b',
  errorColor: '#ef4444',
  infoColor: '#0ea5e9',
  // Shadow system
  useButtonShadow: false,
  buttonShadowColor: '#2563eb',
  useCardShadow: true,
  cardShadowColor: '#00000015',
  useTextShadow: false,
  textShadowColor: '#00000030',
  // Gradient enhancements
  gradientDirection: '135',
  useButtonGradient: true,
  useTabGradient: false,
  // Footer colors
  footerBgColor: '#ffffff',
  footerTextColor: '#374151',
  footerLinkColor: '#2563eb',
  footerLinkHoverColor: '#9333ea',
  // Carousel settings
  carouselEnabled: true,
  carouselAutoplaySpeed: 5000,
  carouselTransitionSpeed: 1000
};

/**
 * Get cached settings from localStorage
 */
function getCachedSettings() {
  try {
    const cached = localStorage.getItem(LOCAL_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[BusinessVisualSettings] Cache read error:', err);
  }
  return null;
}

/**
 * Set cached settings in localStorage
 */
function setCachedSettings(settings) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
      data: settings,
      timestamp: Date.now()
    }));
  } catch (err) {
    console.warn('[BusinessVisualSettings] Cache write error:', err);
  }
}

/**
 * Clear the settings cache
 */
export function clearVisualSettingsCache() {
  try {
    localStorage.removeItem(LOCAL_CACHE_KEY);
  } catch (err) {
    console.warn('[BusinessVisualSettings] Cache clear error:', err);
  }
}

/**
 * Load visual settings from database
 * Falls back to defaults on error
 * @returns {Promise<Object>} Visual settings object
 */
export async function loadVisualSettings() {
  try {
    // Check cache first
    const cached = getCachedSettings();
    if (cached) {
      return { ...DEFAULT_VISUAL_SETTINGS, ...cached };
    }

    const { data, error } = await supabase
      .from('business_visual_settings')
      .select('settings')
      .limit(1)
      .single();

    if (error) {
      // If table doesn't exist or no rows, return defaults
      if (error.code === 'PGRST116' || error.code === '42P01') {
        return DEFAULT_VISUAL_SETTINGS;
      }
      console.error('[BusinessVisualSettings] Load error:', error);
      return DEFAULT_VISUAL_SETTINGS;
    }

    const settings = { ...DEFAULT_VISUAL_SETTINGS, ...(data?.settings || {}) };
    setCachedSettings(settings);
    return settings;
  } catch (err) {
    console.error('[BusinessVisualSettings] Load exception:', err);
    return DEFAULT_VISUAL_SETTINGS;
  }
}

/**
 * Save visual settings to database
 * @param {Object} settings - Visual settings object to save
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveVisualSettings(settings) {
  try {
    // First check if a row exists
    const { data: existing, error: fetchError } = await supabase
      .from('business_visual_settings')
      .select('id')
      .limit(1)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[BusinessVisualSettings] Fetch error:', fetchError);
      return { success: false, error: fetchError.message };
    }

    let result;
    if (existing) {
      // Update existing row
      result = await supabase
        .from('business_visual_settings')
        .update({ settings })
        .eq('id', existing.id);
    } else {
      // Insert new row
      result = await supabase
        .from('business_visual_settings')
        .insert({ settings });
    }

    if (result.error) {
      console.error('[BusinessVisualSettings] Save error:', result.error);
      return { success: false, error: result.error.message };
    }

    // Clear cache to force refresh
    clearVisualSettingsCache();
    // Re-cache with new settings
    setCachedSettings(settings);

    return { success: true };
  } catch (err) {
    console.error('[BusinessVisualSettings] Save exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Apply visual settings to the DOM (title, favicon, CSS variables)
 * @param {Object} settings - Visual settings object
 */
export function applyVisualSettingsToDOM(settings) {
  try {
    // Update document title
    if (settings.siteTitle) {
      document.title = settings.siteTitle;
    } else if (settings.companyName) {
      document.title = settings.companyName;
    }

    // Update favicon if provided
    if (settings.favicon) {
      const link = document.querySelector("link[rel='icon']") ||
                   document.createElement('link');
      link.rel = 'icon';
      link.href = settings.favicon;
      if (!document.querySelector("link[rel='icon']")) {
        document.head.appendChild(link);
      }
    }

    // Set CSS custom properties for global access
    const root = document.documentElement;

    // Brand colors
    root.style.setProperty('--color-primary', settings.primaryColor || '#2563eb');
    root.style.setProperty('--color-secondary', settings.secondaryColor || '#9333ea');
    root.style.setProperty('--color-accent', settings.accentColor || '#9333ea');
    root.style.setProperty('--color-page-bg', settings.pageBgColor || '#f9fafb');

    // Status colors
    root.style.setProperty('--color-success', settings.successColor || '#10b981');
    root.style.setProperty('--color-warning', settings.warningColor || '#f59e0b');
    root.style.setProperty('--color-error', settings.errorColor || '#ef4444');
    root.style.setProperty('--color-info', settings.infoColor || '#0ea5e9');

    // Gradient direction
    root.style.setProperty('--gradient-direction', `${settings.gradientDirection || 135}deg`);

    // Shadow variables
    root.style.setProperty('--button-shadow',
      settings.useButtonShadow
        ? `0 4px 14px 0 ${settings.buttonShadowColor || settings.primaryColor || '#2563eb'}40`
        : 'none'
    );
    root.style.setProperty('--card-shadow',
      settings.useCardShadow
        ? `0 4px 6px -1px ${settings.cardShadowColor || '#00000015'}, 0 2px 4px -2px ${settings.cardShadowColor || '#00000010'}`
        : 'none'
    );
    root.style.setProperty('--text-shadow',
      settings.useTextShadow
        ? `0 2px 4px ${settings.textShadowColor || '#00000030'}`
        : 'none'
    );

    // Apply page background to body
    document.body.style.backgroundColor = settings.pageBgColor || '#f9fafb';

  } catch (err) {
    console.error('[BusinessVisualSettings] DOM apply error:', err);
  }
}
