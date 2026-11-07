/**
 * Business Visual Settings Service
 * Handles persistence of visual settings to/from Supabase database
 */

import { supabase, withTimeout } from '@/lib/supabase';
import { NEW_KEY_DEFAULTS, BRAND_CSS_VARS, isHexColor, resolveLookId } from '@/lib/brandPalette';
import { LOCAL_CACHE_KEY } from '@/lib/constants';
import { normalizeBrandingSettings } from '@/lib/brandingDisplay';

const CACHE_DURATION = 60 * 1000; // 1 minute cache
// Startup waits for these settings (StartupGate), after auth's own cap: a hung query must not block the app.
export const VISUAL_SETTINGS_TIMEOUT_MS = 3500;

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
  carouselTransitionSpeed: 1000,
  // heroLayout ('spaced' | 'cover', see heroLayout.js) is deliberately NOT a default: everything that spreads these
  // defaults would persist it. A missing key already resolves to 'spaced'.
  // Brand refresh keys (additive; see brandPalette.js)
  ...NEW_KEY_DEFAULTS
  // No `activeTheme` here on purpose: visualThemes.resolveThemeId infers it from the stored values
};

/**
 * Get cached settings from localStorage. `ignoreTtl` is for load failures: a stale look beats flipping to the code
 * defaults (the inline script in index.html also ignores the TTL).
 */
function getCachedSettings(ignoreTtl = false) {
  try {
    const cached = localStorage.getItem(LOCAL_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (data && (ignoreTtl || Date.now() - timestamp < CACHE_DURATION)) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[BusinessVisualSettings] Cache read error:', err);
  }
  return null;
}

// Last settings that really came from the database/cache/an admin save, for failed reloads in the same session.
let lastGoodSettings = null;
// A late request cannot replace a newer verified load/cache hit/admin save.
let settingsRevision = 0;
let lastGoodRevision = 0;
// Code defaults handed out because a load FAILED (nothing better known): applyVisualSettingsToDOM must not let them
// pick the look, since the defaults are classic and the stored (production) row is the brand.
const unverifiedSettings = new WeakSet();

/** What to use when the settings request fails: last good settings, else the stale cache, else unverified defaults. */
function settingsAfterFailure() {
  if (lastGoodSettings) return lastGoodSettings;
  const stale = getCachedSettings(true);
  if (stale) return { ...DEFAULT_VISUAL_SETTINGS, ...normalizeBrandingSettings(stale) };
  const fallback = { ...DEFAULT_VISUAL_SETTINGS };
  unverifiedSettings.add(fallback);
  return fallback;
}

/**
 * Set cached settings in localStorage
 */
function setCachedSettings(settings) {
  const write = (data) => localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  try {
    write(settings);
  } catch (err) {
    console.warn('[BusinessVisualSettings] Cache write error:', err);
    // Quota is usually the base64 images: keep the rest cached; if that fails too, drop the entry rather than leave it stale.
    try {
      const { logo, loaderImage, ...light } = settings;
      write(light);
    } catch {
      try { localStorage.removeItem(LOCAL_CACHE_KEY); } catch { /* storage unavailable: nothing else to do */ }
    }
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
 * @param {Object} options - Optional late-success handler and consumer lifetime/change guard
 * @returns {Promise<Object>} Visual settings object (the startup wait is bounded, not the request)
 */
export async function loadVisualSettings({ onLateSettings, isCurrent = () => true } = {}) {
  const revision = ++settingsRevision;
  let timedOut = false;
  try {
    // Check cache first
    const cached = getCachedSettings();
    if (cached) {
      lastGoodSettings = { ...DEFAULT_VISUAL_SETTINGS, ...normalizeBrandingSettings(cached) };
      lastGoodRevision = revision;
      return lastGoodSettings;
    }

    // Observe the underlying request, not just the race: slow connections can still deliver a verified row later.
    const request = Promise.resolve(
      supabase.from('business_visual_settings').select('settings').limit(1).single()
    ).then(({ data, error }) => {
      if (error) {
        // Missing rows/tables retain the existing foreground default behavior, but are NOT a verified late row.
        if (error.code === 'PGRST116' || error.code === '42P01') return DEFAULT_VISUAL_SETTINGS;
        throw error;
      }

      if (!isCurrent() || revision < lastGoodRevision) return settingsAfterFailure();
      if (timedOut && (!data?.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))) {
        return settingsAfterFailure();
      }
      const settings = { ...DEFAULT_VISUAL_SETTINGS, ...normalizeBrandingSettings(data?.settings) };
      setCachedSettings(settings);
      lastGoodSettings = settings;
      lastGoodRevision = revision;
      if (timedOut) onLateSettings?.(settings);
      return settings;
    });

    return await withTimeout(
      request,
      VISUAL_SETTINGS_TIMEOUT_MS,
      'business_visual_settings'
    );
  } catch (err) {
    timedOut = true;
    console.error('[BusinessVisualSettings] Load exception:', err);
    // Timeout (withTimeout) or network failure: same fallback as a DB error.
    return settingsAfterFailure();
  }
}

/**
 * Save visual settings to database
 * @param {Object} settings - Visual settings object to save
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveVisualSettings(rawSettings) {
  const settings = normalizeBrandingSettings(rawSettings);
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
    lastGoodSettings = settings;
    lastGoodRevision = ++settingsRevision;

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
  // Failed-load defaults are not a theme: preserve ALL first-paint tokens, body styles and metadata.
  if (unverifiedSettings.has(settings)) return;
  try {
    // First on purpose: it switches the --t-* tokens, so nothing below may keep it from running. The try/catch is
    // the guard for environments without a document.
    document.documentElement.dataset.theme = resolveLookId(settings);

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

    // Brand variables for the Tailwind `brand-*` colours. Invalid values are removed so the
    // Tailwind fallback (brand HEX) applies; nothing user-supplied reaches the stylesheet unchecked.
    for (const [key, cssVar] of Object.entries(BRAND_CSS_VARS)) {
      if (isHexColor(settings[key])) root.style.setProperty(cssVar, settings[key]);
      else root.style.removeProperty(cssVar);
    }

    // Apply page background to body. In the classic look it sits under the stylesheet gradient (index.css); in the
    // brand look the gradient is off (data-theme above), so this colour is the page. Never touch background-image here.
    document.body.style.backgroundColor = settings.pageBgColor || '#f9fafb';

  } catch (err) {
    console.error('[BusinessVisualSettings] DOM apply error:', err);
  }
}
