/**
 * Visual Settings Service
 * Manages application-wide visual configuration (cache, DB, and DOM)
 */

import { supabase } from '@/lib/supabase';
import {
  handleError, logError, createValidationError,
  parseSupabaseError, ERROR_CODES
} from './errorHandler';

const CACHE_KEY = 'visual_settings_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Default settings fallback
const DEFAULT_SETTINGS = {
  app_name: 'PapuEnvios',
  site_title: 'PapuEnvios - Remesas y E-Commerce',
  logo_text: 'Papu',
  favicon_url: '/favicon.ico',
  primary_color: '#3B82F6',
  secondary_color: '#10B981',
  support_email: 'soporte@papuenvios.com',
  support_phone: '+53-XXXXXXX',
  maintenance_mode: 'false',
};

/**
 * Fetch visual settings from database
 * Falls back gracefully to DEFAULT_SETTINGS on connection errors
 * @returns {Promise<Object>} Settings object (merged with defaults)
 * @throws {AppError} DB_ERROR on critical failures (but catches to return defaults)
 */
export async function fetchVisualSettings() {
  try {
    // Fetch all settings
    const { data: allData, error: allError } = await supabase
      .from('visual_settings')
      .select('setting_key, setting_value, setting_type');

    if (allError) {
      // Graceful fallback: Log but don't throw - UI must work without settings
      logError(
        handleError(allError, ERROR_CODES.DB_ERROR, { operation: 'fetchVisualSettings' }),
        { operation: 'fetchVisualSettings' }
      );
      return DEFAULT_SETTINGS;
    }

    // Transform to object
    const settings = {};
    if (Array.isArray(allData)) {
      allData.forEach(item => {
        // Parse values based on type
        let value = item.setting_value;
        if (item.setting_type === 'boolean') {
          value = item.setting_value === 'true';
        } else if (item.setting_type === 'number') {
          value = parseFloat(item.setting_value);
        }
        settings[item.setting_key] = value;
      });
    }

    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (err) {
    // Graceful fallback: Log but don't throw
    logError(
      handleError(err, ERROR_CODES.DB_ERROR, { operation: 'fetchVisualSettings' }),
      { operation: 'fetchVisualSettings' }
    );
    return DEFAULT_SETTINGS;
  }
}

/**
 * Get cached visual settings
 * @returns {Object} Settings object (with cache)
 */
export function getCachedVisualSettings() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        console.log('[VisualSettings] Using cached settings');
        return data;
      }
    }
  } catch (err) {
    console.error('[VisualSettings] Cache error:', err);
  }
  return DEFAULT_SETTINGS;
}

/**
 * Cache visual settings
 * @param {Object} settings - Settings to cache
 */
export function setCachedVisualSettings(settings) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        data: settings,
        timestamp: Date.now(),
      })
    );
  } catch (err) {
    console.error('[VisualSettings] Cache write error:', err);
  }
}

/**
 * Clear settings cache
 */
export function clearSettingsCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (err) {
    console.error('[VisualSettings] Cache clear error:', err);
  }
}

/**
 * Update a visual setting (admin only)
 * @param {string} key - Setting key identifier
 * @param {string} value - Setting value (will be stored as string)
 * @returns {Promise<boolean>} Success status
 * @throws {AppError} VALIDATION_FAILED if key/value invalid, DB_ERROR on failure
 */
export async function updateVisualSetting(key, value) {
  try {
    if (!key) {
      throw createValidationError({ key: 'Setting key is required' }, 'Missing setting key');
    }
    if (value === undefined || value === null) {
      throw createValidationError({ value: 'Setting value is required' }, 'Missing setting value');
    }

    const { error } = await supabase
      .from('visual_settings')
      .upsert(
        { setting_key: key, setting_value: String(value) },
        { onConflict: 'setting_key' }
      );

    if (error) {
      const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateVisualSetting', key });
      logError(appError, { operation: 'updateVisualSetting', key });
      throw appError;
    }

    // Clear cache to force refresh
    clearSettingsCache();
    return true;
  } catch (err) {
    if (err.code) throw err;
    const appError = handleError(err, ERROR_CODES.DB_ERROR, { operation: 'updateVisualSetting', key });
    logError(appError, { operation: 'updateVisualSetting', key });
    throw appError;
  }
}

/**
 * Apply visual settings to DOM
 * @param {Object} settings - Settings object
 */
export function applyVisualSettings(settings) {
  try {
    // Update document title
    if (settings.site_title) {
      document.title = settings.site_title;
    }

    // Update favicon
    if (settings.favicon_url) {
      const link = document.querySelector("link[rel='icon']") ||
                   document.createElement('link');
      link.rel = 'icon';
      link.href = settings.favicon_url;
      if (!document.querySelector("link[rel='icon']")) {
        document.head.appendChild(link);
      }
    }

    // Update CSS variables for colors
    if (settings.primary_color) {
      document.documentElement.style.setProperty(
        '--color-primary',
        settings.primary_color
      );
    }

    if (settings.secondary_color) {
      document.documentElement.style.setProperty(
        '--color-secondary',
        settings.secondary_color
      );
    }

    console.log('[VisualSettings] Applied to DOM');
  } catch (err) {
    console.error('[VisualSettings] DOM apply error:', err);
  }
}

/**
 * Initialize visual settings
 * @returns {Promise<Object>} Settings object
 */
export async function initializeVisualSettings() {
  try {
    // Check cache first
    const cached = getCachedVisualSettings();
    if (cached && cached.app_name !== DEFAULT_SETTINGS.app_name) {
      applyVisualSettings(cached);
      return cached;
    }

    // Fetch from database
    const settings = await fetchVisualSettings();

    // Cache and apply
    setCachedVisualSettings(settings);
    applyVisualSettings(settings);

    return settings;
  } catch (err) {
    console.error('[VisualSettings] Initialize error:', err);
    return DEFAULT_SETTINGS;
  }
}
