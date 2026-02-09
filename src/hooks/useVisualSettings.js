/**
 * Custom Hook: useVisualSettings
 * Provides access to visual settings throughout the application
 */

import { useState, useEffect } from 'react';
import {
  fetchVisualSettings,
  getCachedVisualSettings,
  setCachedVisualSettings,
  applyVisualSettings,
  initializeVisualSettings,
} from '@/lib/visualSettingsService';

export function useVisualSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        setError(null);

        // Initialize (includes caching and DOM application)
        const loadedSettings = await initializeVisualSettings();
        setSettings(loadedSettings);

      } catch (err) {
        console.error('[useVisualSettings] Error loading settings:', err);
        setError(err);

        // Fallback to cached or defaults
        const cached = getCachedVisualSettings();
        setSettings(cached);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Getter function for a specific setting
  const getSetting = (key, defaultValue = null) => {
    return settings?.[key] ?? defaultValue;
  };

  return {
    settings,
    loading,
    error,
    getSetting,
    appName: settings?.app_name,
    siteTitle: settings?.site_title,
    logoText: settings?.logo_text,
    faviconUrl: settings?.favicon_url,
    primaryColor: settings?.primary_color,
    secondaryColor: settings?.secondary_color,
    supportEmail: settings?.support_email,
    supportPhone: settings?.support_phone,
    maintenanceMode: settings?.maintenance_mode === 'true' || settings?.maintenance_mode === true,
  };
}

/**
 * Hook variant that returns just a specific setting
 * Useful when you only need one setting
 */
export function useSetting(key, defaultValue = null) {
  const { getSetting } = useVisualSettings();
  return getSetting(key, defaultValue);
}

/**
 * Hook for admin/manager to manage settings
 */
export function useVisualSettingsAdmin() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        const loadedSettings = await fetchVisualSettings();
        setSettings(loadedSettings);
      } catch (err) {
        setError(err.message || 'Error loading settings');
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const updateSetting = async (key, value) => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Update local state immediately
      setSettings(prev => ({
        ...prev,
        [key]: value,
      }));

      // Update in database
      const { error: dbError } = await supabase
        .from('visual_settings')
        .upsert(
          { setting_key: key, setting_value: String(value) },
          { onConflict: 'setting_key' }
        );

      if (dbError) {
        throw dbError;
      }

      // Update cache
      setCachedVisualSettings(settings);

      // Apply to DOM
      applyVisualSettings(settings);

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('[useVisualSettingsAdmin] Error:', err);
      setError(err.message || 'Error saving setting');
      // Revert local state on error
      const reloaded = await fetchVisualSettings();
      setSettings(reloaded);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    // Reset all settings to defaults
    // This would require a function in visualSettingsService
    // For now, just reload
    window.location.reload();
  };

  return {
    settings,
    loading,
    saving,
    error,
    success,
    updateSetting,
    resetToDefaults,
  };
}
