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
      console.log('[BusinessVisualSettings] Using cached settings');
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
        console.log('[BusinessVisualSettings] No settings found, using defaults');
        return DEFAULT_VISUAL_SETTINGS;
      }
      console.error('[BusinessVisualSettings] Load error:', error);
      return DEFAULT_VISUAL_SETTINGS;
    }

    const settings = { ...DEFAULT_VISUAL_SETTINGS, ...(data?.settings || {}) };
    setCachedSettings(settings);
    console.log('[BusinessVisualSettings] Loaded from database');
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

    console.log('[BusinessVisualSettings] Saved to database');
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
    if (settings.primaryColor) {
      root.style.setProperty('--color-primary', settings.primaryColor);
    }
    if (settings.secondaryColor) {
      root.style.setProperty('--color-secondary', settings.secondaryColor);
    }
    if (settings.accentColor) {
      root.style.setProperty('--color-accent', settings.accentColor);
    }
    if (settings.pageBgColor) {
      root.style.setProperty('--color-page-bg', settings.pageBgColor);
    }

    console.log('[BusinessVisualSettings] Applied to DOM');
  } catch (err) {
    console.error('[BusinessVisualSettings] DOM apply error:', err);
  }
}
