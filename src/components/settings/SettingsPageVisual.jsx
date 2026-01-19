import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Palette, Upload, Plus, Trash2, Check, RefreshCw, Save, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { DEFAULT_VISUAL_SETTINGS, clearVisualSettingsCache, saveVisualSettings, applyVisualSettingsToDOM } from '@/lib/businessVisualSettingsService';
import {
  getCarouselSlides, createCarouselSlide, updateCarouselSlide,
  hardDeleteCarouselSlide
} from '@/lib/carouselService';

const SettingsPageVisual = ({ localVisual, setLocalVisual, visualSettings, setVisualSettings }) => {
  const { t, language } = useLanguage();
  const [livePreview, setLivePreview] = useState(true); // Toggle for live preview
  const isUserEditing = useRef(false); // Track if user is actively editing
  const originalSettings = useRef(null); // Store original settings for cancel functionality
  const [hasChanges, setHasChanges] = useState(false); // Track if there are unsaved changes

  const [appearance, setAppearance] = useState({
    companyName: visualSettings.companyName || 'PapuEnvíos',
    siteTitle: visualSettings.siteTitle || 'PapuEnvios - Remesas y E-Commerce',
    logo: visualSettings.logo || '',
    favicon: visualSettings.favicon || '',
    primaryColor: visualSettings.primaryColor || '#2563eb',
    secondaryColor: visualSettings.secondaryColor || '#9333ea',
    useGradient: visualSettings.useGradient !== undefined ? visualSettings.useGradient : true,
    // Header/Menu colors
    headerBgColor: visualSettings.headerBgColor || '#ffffff',
    headerTextColor: visualSettings.headerTextColor || '#1f2937',
    headerMenuBgColor: visualSettings.headerMenuBgColor || '#ffffff',
    headerMenuTextColor: visualSettings.headerMenuTextColor || '#1f2937',
    headerMenuHoverBgColor: visualSettings.headerMenuHoverBgColor || '#f3f4f6',
    headerMenuActiveColor: visualSettings.headerMenuActiveColor || '#2563eb',
    // Heading colors
    headingColor: visualSettings.headingColor || '#1f2937',
    useHeadingGradient: visualSettings.useHeadingGradient !== undefined ? visualSettings.useHeadingGradient : true,
    // Tab colors
    tabActiveColor: visualSettings.tabActiveColor || '#2563eb',
    tabActiveBgColor: visualSettings.tabActiveBgColor || '#eff6ff',
    tabInactiveColor: visualSettings.tabInactiveColor || '#6b7280',
    tabInactiveBgColor: visualSettings.tabInactiveBgColor || '#f9fafb',
    // Button colors
    buttonBgColor: visualSettings.buttonBgColor || '#2563eb',
    buttonTextColor: visualSettings.buttonTextColor || '#ffffff',
    buttonHoverBgColor: visualSettings.buttonHoverBgColor || '#1d4ed8',
    destructiveBgColor: visualSettings.destructiveBgColor || '#dc2626',
    destructiveTextColor: visualSettings.destructiveTextColor || '#ffffff',
    destructiveHoverBgColor: visualSettings.destructiveHoverBgColor || '#b91c1c',
    accentColor: visualSettings.accentColor || '#9333ea',
    pageBgColor: visualSettings.pageBgColor || '#f9fafb',
    cardBgColor: visualSettings.cardBgColor || '#ffffff'
  });
  const [logoPreview, setLogoPreview] = useState(visualSettings.logo || '');
  const [faviconPreview, setFaviconPreview] = useState(visualSettings.favicon || '');

  // Carousel states
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [savingSlide, setSavingSlide] = useState(null);
  const [savedSlide, setSavedSlide] = useState(null);
  const [slidePreviews, setSlidePreviews] = useState({});
  const [slideDebounceTimers, setSlideDebounceTimers] = useState({});

  useEffect(() => {
    loadCarouselSlides();
  }, []);

  // Capture original settings on mount for cancel functionality
  useEffect(() => {
    if (!originalSettings.current) {
      originalSettings.current = { ...visualSettings };
    }
  }, []);

  // Sync appearance state when visualSettings changes from external source (DB load)
  // Skip if user is actively editing to avoid overwriting their changes
  useEffect(() => {
    if (isUserEditing.current) return;

    const newAppearance = {
      companyName: visualSettings.companyName || 'PapuEnvíos',
      siteTitle: visualSettings.siteTitle || 'PapuEnvios - Remesas y E-Commerce',
      logo: visualSettings.logo || '',
      favicon: visualSettings.favicon || '',
      primaryColor: visualSettings.primaryColor || '#2563eb',
      secondaryColor: visualSettings.secondaryColor || '#9333ea',
      useGradient: visualSettings.useGradient !== undefined ? visualSettings.useGradient : true,
      headerBgColor: visualSettings.headerBgColor || '#ffffff',
      headerTextColor: visualSettings.headerTextColor || '#1f2937',
      headerMenuBgColor: visualSettings.headerMenuBgColor || '#ffffff',
      headerMenuTextColor: visualSettings.headerMenuTextColor || '#1f2937',
      headerMenuHoverBgColor: visualSettings.headerMenuHoverBgColor || '#f3f4f6',
      headerMenuActiveColor: visualSettings.headerMenuActiveColor || '#2563eb',
      headingColor: visualSettings.headingColor || '#1f2937',
      useHeadingGradient: visualSettings.useHeadingGradient !== undefined ? visualSettings.useHeadingGradient : true,
      tabActiveColor: visualSettings.tabActiveColor || '#2563eb',
      tabActiveBgColor: visualSettings.tabActiveBgColor || '#eff6ff',
      tabInactiveColor: visualSettings.tabInactiveColor || '#6b7280',
      tabInactiveBgColor: visualSettings.tabInactiveBgColor || '#f9fafb',
      buttonBgColor: visualSettings.buttonBgColor || '#2563eb',
      buttonTextColor: visualSettings.buttonTextColor || '#ffffff',
      buttonHoverBgColor: visualSettings.buttonHoverBgColor || '#1d4ed8',
      destructiveBgColor: visualSettings.destructiveBgColor || '#dc2626',
      destructiveTextColor: visualSettings.destructiveTextColor || '#ffffff',
      destructiveHoverBgColor: visualSettings.destructiveHoverBgColor || '#b91c1c',
      accentColor: visualSettings.accentColor || '#9333ea',
      pageBgColor: visualSettings.pageBgColor || '#f9fafb',
      cardBgColor: visualSettings.cardBgColor || '#ffffff'
    };
    setAppearance(newAppearance);
    setLogoPreview(visualSettings.logo || '');
    setFaviconPreview(visualSettings.favicon || '');
    setHasChanges(false);
  }, [visualSettings]);

  // Update appearance with live preview
  const updateAppearance = useCallback((key, value) => {
    isUserEditing.current = true;
    setHasChanges(true);
    const newAppearance = { ...appearance, [key]: value };
    setAppearance(newAppearance);

    // Apply live preview to the entire system
    if (livePreview) {
      setVisualSettings({ ...visualSettings, ...newAppearance });
    }

    // Reset editing flag after a delay
    setTimeout(() => { isUserEditing.current = false; }, 1000);
  }, [appearance, visualSettings, setVisualSettings, livePreview]);

  // ===== APPEARANCE HANDLERS =====
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateAndProcessImage(file, 'logo');
      if (!result.success) {
        toast({
          title: t('settings.visual.validationError'),
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      setLogoPreview(result.base64);
      setAppearance(prev => ({ ...prev, logo: result.base64 }));

      toast({
        title: t('settings.visual.logoUploaded'),
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions}`,
      });
    } catch (error) {
      console.error('Error processing logo:', error);
      toast({
        title: t('settings.visual.errorProcessingImage'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleFaviconUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateAndProcessImage(file, 'favicon');
      if (!result.success) {
        toast({
          title: t('settings.visual.validationError'),
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      setFaviconPreview(result.base64);
      setAppearance(prev => ({ ...prev, favicon: result.base64 }));
      setHasChanges(true);

      // Update favicon in browser immediately if live preview is on
      if (livePreview) {
        const link = document.querySelector("link[rel='icon']") || document.createElement('link');
        link.rel = 'icon';
        link.href = result.base64;
        if (!document.querySelector("link[rel='icon']")) {
          document.head.appendChild(link);
        }
      }

      toast({
        title: t('settings.visual.faviconUploaded'),
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions}`,
      });
    } catch (error) {
      console.error('Error processing favicon:', error);
      toast({
        title: t('settings.visual.errorProcessingImage'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleAppearanceSave = async () => {
    const newSettings = {
      ...visualSettings,
      ...appearance
    };
    await setVisualSettings(newSettings);
    // Update browser tab title
    document.title = appearance.siteTitle || appearance.companyName;
    // Update original settings reference after successful save
    originalSettings.current = { ...newSettings };
    setHasChanges(false);
    toast({
      title: t('settings.saveSuccess'),
      description: t('settings.visual.changesSaved')
    });
  };

  // Restore theme to factory defaults: clears localStorage, saves defaults to DB
  const handleAppearanceCancel = async () => {
    try {
      // 1. Clear localStorage cache
      clearVisualSettingsCache();
      // Also clear any legacy cache keys that might exist
      localStorage.removeItem('visual_settings_cache');
      localStorage.removeItem('visualSettings');

      // 2. Save DEFAULT_VISUAL_SETTINGS to database
      const result = await saveVisualSettings(DEFAULT_VISUAL_SETTINGS);
      if (!result.success) {
        console.error('[RestoreTheme] Failed to save defaults to DB:', result.error);
        toast({
          title: 'Error',
          description: result.error || 'Error al restaurar configuración',
          variant: 'destructive'
        });
        return;
      }

      // 3. Update local state with defaults
      setAppearance({ ...DEFAULT_VISUAL_SETTINGS });
      setLogoPreview(DEFAULT_VISUAL_SETTINGS.logo || '');
      setFaviconPreview(DEFAULT_VISUAL_SETTINGS.favicon || '');

      // 4. Apply defaults to context (propagates to entire app)
      setVisualSettings({ ...DEFAULT_VISUAL_SETTINGS });

      // 5. Apply defaults to DOM immediately
      applyVisualSettingsToDOM(DEFAULT_VISUAL_SETTINGS);
      document.body.style.backgroundColor = DEFAULT_VISUAL_SETTINGS.pageBgColor;

      // 6. Reset favicon to default (empty means browser default)
      const existingFavicon = document.querySelector("link[rel='icon']");
      if (existingFavicon && !DEFAULT_VISUAL_SETTINGS.favicon) {
        existingFavicon.href = '/favicon.ico'; // Reset to default favicon
      }

      // 7. Update originalSettings reference
      originalSettings.current = { ...DEFAULT_VISUAL_SETTINGS };
      setHasChanges(false);

      toast({
        title: t('settings.visual.changesDiscarded'),
        description: t('settings.visual.settingsRestored')
      });

      console.log('[RestoreTheme] Successfully restored to factory defaults');
    } catch (err) {
      console.error('[RestoreTheme] Exception:', err);
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive'
      });
    }
  };

  // ===== CAROUSEL HANDLERS =====
  const loadCarouselSlides = async () => {
    setLoadingSlides(true);
    try {
      const slides = await getCarouselSlides();
      setCarouselSlides(slides || []);
    } catch (error) {
      console.error('Error loading carousel slides:', error);
      setCarouselSlides([]);
      toast({
        title: t('settings.visual.errorLoadingSlides'),
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoadingSlides(false);
    }
  };

  const handleAddSlide = async () => {
    try {
      await createCarouselSlide({
        title_es: '', title_en: '', subtitle_es: '', subtitle_en: '',
        image_url: '', link_url: '', is_active: false
      });

      await loadCarouselSlides();
      toast({
        title: t('settings.visual.slideCreated')
      });
    } catch (error) {
      console.error('Error creating slide:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleSlideChange = async (id, updates) => {
    try {
      setSavingSlide(id);
      setSavedSlide(null);

      const { error } = await updateCarouselSlide(id, updates);
      if (error) throw error;

      setCarouselSlides(prev =>
        prev.map(slide => (slide.id === id ? { ...slide, ...updates } : slide))
      );

      setSavingSlide(null);
      setSavedSlide(id);
      setTimeout(() => setSavedSlide(null), 1500);
    } catch (error) {
      console.error('Error updating slide:', error);
      setSavingSlide(null);
      toast({
        title: t('settings.visual.errorUpdating'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleSlideTextChange = (id, field, value) => {
    setCarouselSlides(prev =>
      prev.map(slide => (slide.id === id ? { ...slide, [field]: value } : slide))
    );

    if (slideDebounceTimers[id]) {
      clearTimeout(slideDebounceTimers[id]);
    }

    const timer = setTimeout(() => {
      handleSlideChange(id, { [field]: value });
    }, 800);

    setSlideDebounceTimers(prev => ({ ...prev, [id]: timer }));
  };

  const handleRemoveSlide = async (id) => {
    if (!confirm(t('settings.visual.confirmDeleteSlide'))) {
      return;
    }

    try {
      const { error } = await hardDeleteCarouselSlide(id);
      if (error) throw error;

      await loadCarouselSlides();
      setSlidePreviews(prev => {
        const newPreviews = { ...prev };
        delete newPreviews[id];
        return newPreviews;
      });

      toast({
        title: t('settings.visual.slideDeleted')
      });
    } catch (error) {
      console.error('Error deleting slide:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleSlideOrderChange = async (id, newOrder) => {
    try {
      setSavingSlide(id);
      setSavedSlide(null);

      const { error } = await updateCarouselSlide(id, { display_order: parseInt(newOrder) });
      if (error) throw error;

      setCarouselSlides(prev =>
        prev.map(slide => (slide.id === id ? { ...slide, display_order: parseInt(newOrder) } : slide))
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      );

      setSavingSlide(null);
      setSavedSlide(id);
      setTimeout(() => setSavedSlide(null), 1500);
    } catch (error) {
      console.error('Error updating slide order:', error);
      setSavingSlide(null);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleSlideImageUpload = async (slideId, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateAndProcessImage(file, 'carousel');
      if (!result.success) {
        toast({
          title: t('settings.visual.validationError'),
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      await handleSlideChange(slideId, { image_url: result.base64 });
      setSlidePreviews(prev => ({ ...prev, [slideId]: result.base64 }));

      toast({
        title: t('settings.visual.imageOptimized'),
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions}`,
      });
    } catch (error) {
      console.error('Error processing slide image:', error);
      toast({
        title: t('settings.visual.errorProcessingImage'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      {/* Appearance Customization */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-2xl font-semibold flex items-center">
            <Palette className="mr-3 text-purple-600" />
            {t('settings.visual.appearance')}
          </h2>
          {/* Live Preview Toggle */}
          <label className="flex items-center gap-2 cursor-pointer bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
            <Eye className={`h-4 w-4 ${livePreview ? 'text-blue-600' : 'text-gray-400'}`} />
            <input
              type="checkbox"
              checked={livePreview}
              onChange={e => setLivePreview(e.target.checked)}
              className="rounded"
            />
            <span className={`text-sm font-medium ${livePreview ? 'text-blue-700' : 'text-gray-500'}`}>
              {t('settings.visual.livePreview')}
            </span>
          </label>
        </div>

        {livePreview && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 flex items-center gap-2">
            <Eye className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-700">
              {t('settings.visual.livePreviewHint')}
            </span>
          </div>
        )}

        {/* Logo & Favicon Upload */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('settings.visual.logo')}</label>
            {logoPreview && (
              <div className="mb-4">
                <img src={logoPreview} alt="Logo preview" className="h-16 w-auto" />
              </div>
            )}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50" title={t('settings.visual.uploadLogo')}>
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{t('settings.visual.uploadLogo')}</span>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Favicon Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('settings.visual.favicon')}</label>
            {faviconPreview && (
              <div className="mb-4">
                <img src={faviconPreview} alt="Favicon preview" className="h-8 w-8 object-contain" />
              </div>
            )}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50" title={t('settings.visual.uploadFavicon')}>
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{t('settings.visual.uploadFavicon')}</span>
                <input type="file" accept=".ico,.png,.svg,.webp,image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,image/webp" onChange={handleFaviconUpload} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">{t('settings.visual.faviconHint')}</p>
          </div>
        </div>

        {/* Company Name & Site Title */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">{t('settings.visual.companyName')}</label>
            <input
              type="text"
              value={appearance.companyName}
              onChange={e => updateAppearance('companyName', e.target.value)}
              className="input-style w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              {t('settings.visual.siteTitle')}
            </label>
            <input
              type="text"
              value={appearance.siteTitle}
              onChange={e => updateAppearance('siteTitle', e.target.value)}
              className="input-style w-full"
              placeholder="PapuEnvios - Remesas y E-Commerce"
            />
          </div>
        </div>

        {/* Brand Colors */}
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-3 text-gray-700">
            {t('settings.visual.brandColors')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { key: 'primaryColor', label: t('settings.visual.primaryColor') },
              { key: 'secondaryColor', label: t('settings.visual.secondaryColor') },
              { key: 'accentColor', label: t('settings.visual.accentColor') },
              { key: 'headingColor', label: t('settings.visual.headingColor') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-2">{label}</label>
                <input
                  type="color"
                  value={appearance[key]}
                  onChange={e => updateAppearance(key, e.target.value)}
                  className="w-full h-10 rounded-lg cursor-pointer border border-gray-300"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Header & Menu Colors */}
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-3 text-gray-700">
            {t('settings.visual.headerMenuColors')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { key: 'headerBgColor', label: t('settings.visual.headerBackground') },
              { key: 'headerTextColor', label: t('settings.visual.headerText') },
              { key: 'headerMenuBgColor', label: t('settings.visual.menuBackground') },
              { key: 'headerMenuTextColor', label: t('settings.visual.menuText') },
              { key: 'headerMenuHoverBgColor', label: t('settings.visual.menuHover') },
              { key: 'headerMenuActiveColor', label: t('settings.visual.menuActive') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-2">{label}</label>
                <input
                  type="color"
                  value={appearance[key]}
                  onChange={e => updateAppearance(key, e.target.value)}
                  className="w-full h-10 rounded-lg cursor-pointer border border-gray-300"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Tab Colors */}
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-3 text-gray-700">
            {t('settings.visual.tabColors')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { key: 'tabActiveColor', label: t('settings.visual.tabActiveText') },
              { key: 'tabActiveBgColor', label: t('settings.visual.tabActiveBg') },
              { key: 'tabInactiveColor', label: t('settings.visual.tabInactiveText') },
              { key: 'tabInactiveBgColor', label: t('settings.visual.tabInactiveBg') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-2">{label}</label>
                <input
                  type="color"
                  value={appearance[key]}
                  onChange={e => updateAppearance(key, e.target.value)}
                  className="w-full h-10 rounded-lg cursor-pointer border border-gray-300"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Button & Background Colors */}
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-3 text-gray-700">
            {t('settings.visual.buttonBackgroundColors')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { key: 'buttonBgColor', label: t('settings.visual.buttonColor') },
              { key: 'buttonHoverBgColor', label: t('settings.visual.buttonHoverColor') },
              { key: 'destructiveBgColor', label: t('settings.visual.destructiveColor') },
              { key: 'pageBgColor', label: t('settings.visual.pageBackground') },
              { key: 'cardBgColor', label: t('settings.visual.cardBackground') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-2">{label}</label>
                <input
                  type="color"
                  value={appearance[key]}
                  onChange={e => updateAppearance(key, e.target.value)}
                  className="w-full h-10 rounded-lg cursor-pointer border border-gray-300"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3 mb-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={appearance.useGradient}
              onChange={e => updateAppearance('useGradient', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">{t('settings.visual.useGradient')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={appearance.useHeadingGradient}
              onChange={e => updateAppearance('useHeadingGradient', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">{t('settings.visual.useHeadingGradient')}</span>
          </label>
        </div>

        {/* Color Preview */}
        <div className="p-4 bg-gray-50 rounded-lg mb-6 space-y-3">
          <div
            className="px-4 py-3 rounded-lg text-white font-semibold"
            style={{
              backgroundColor: appearance.buttonBgColor,
              color: appearance.buttonTextColor
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = appearance.buttonHoverBgColor}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = appearance.buttonBgColor}
          >
            {t('settings.visual.primaryButton')}
          </div>
          <div
            className="px-4 py-3 rounded-lg text-white font-semibold"
            style={{
              backgroundColor: appearance.destructiveBgColor,
              color: appearance.destructiveTextColor
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = appearance.destructiveHoverBgColor}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = appearance.destructiveBgColor}
          >
            {t('settings.visual.deleteButton')}
          </div>
          <div className="flex gap-4 flex-wrap items-center">
            <div
              className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: `${appearance.accentColor}20`,
                color: appearance.accentColor
              }}
            >
              {t('settings.visual.badge')}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            onClick={handleAppearanceCancel}
            variant="outline"
            className="h-9 px-3"
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('settings.visual.restoreTheme')}</span>
          </Button>
          <Button onClick={handleAppearanceSave} style={getPrimaryButtonStyle(visualSettings)} className="h-9 px-3">
            <Save className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('settings.visual.saveCustomization')}</span>
          </Button>
        </div>
      </motion.div>

      {/* Carousel Slides Section */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-effect p-8 rounded-2xl mt-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
          <h2 className="text-xl sm:text-2xl font-semibold">{t('settings.visual.slides')}</h2>
          <Button
            onClick={handleAddSlide}
            style={getPrimaryButtonStyle(visualSettings)}
            className="h-8 px-2 sm:px-3"
            title={t('settings.visual.addSlide')}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('settings.visual.addSlide')}</span>
          </Button>
        </div>

        {loadingSlides ? (
          <div className="text-center py-8 text-gray-500">
            {t('settings.visual.loadingSlides')}
          </div>
        ) : carouselSlides.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {t('settings.visual.noSlides')}
          </div>
        ) : (
          <div className="space-y-4">
            {carouselSlides.map(slide => (
              <div key={slide.id} className="p-4 border rounded-lg space-y-3">
                {savingSlide === slide.id && (
                  <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-2 rounded">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>{t('settings.visual.saving')}</span>
                  </div>
                )}
                {savedSlide === slide.id && savingSlide !== slide.id && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 p-2 rounded">
                    <Check className="h-4 w-4" />
                    <span>{t('settings.visual.saved')}</span>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('settings.visual.order')}</label>
                    <input
                      type="number"
                      value={slide.display_order ?? 0}
                      onChange={e => handleSlideOrderChange(slide.id, e.target.value)}
                      className="input-style w-full"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('settings.visual.linkUrl')}</label>
                    <input
                      type="url"
                      value={slide.link_url || ''}
                      onChange={e => handleSlideChange(slide.id, { link_url: e.target.value })}
                      placeholder="https://..."
                      className="input-style w-full"
                    />
                  </div>
                </div>

                {(slide.image_url || slidePreviews[slide.id]) && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      {t('settings.visual.preview')}
                    </p>
                    <div className="relative w-full aspect-[16/9] max-w-2xl rounded-lg overflow-hidden border-2 border-gray-300 bg-gray-100">
                      <img
                        src={slidePreviews[slide.id] || slide.image_url}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">{t('settings.visual.image')}</label>
                  <input
                    type="url"
                    value={slide.image_url || ''}
                    onChange={e => handleSlideChange(slide.id, { image_url: e.target.value })}
                    placeholder="https://..."
                    className="input-style w-full mb-2"
                  />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleSlideImageUpload(slide.id, e)}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('settings.visual.mainText')} (ES)</label>
                    <input
                      type="text"
                      value={slide.title_es || ''}
                      onChange={e => handleSlideTextChange(slide.id, 'title_es', e.target.value)}
                      placeholder="Título en español"
                      className="input-style w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('settings.visual.mainText')} (EN)</label>
                    <input
                      type="text"
                      value={slide.title_en || ''}
                      onChange={e => handleSlideTextChange(slide.id, 'title_en', e.target.value)}
                      placeholder="Title in English"
                      className="input-style w-full"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('settings.visual.secondaryText')} (ES)</label>
                    <input
                      type="text"
                      value={slide.subtitle_es || ''}
                      onChange={e => handleSlideTextChange(slide.id, 'subtitle_es', e.target.value)}
                      placeholder="Subtítulo en español"
                      className="input-style w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('settings.visual.secondaryText')} (EN)</label>
                    <input
                      type="text"
                      value={slide.subtitle_en || ''}
                      onChange={e => handleSlideTextChange(slide.id, 'subtitle_en', e.target.value)}
                      placeholder="Subtitle in English"
                      className="input-style w-full"
                    />
                  </div>
                </div>

                <div className="text-right">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 px-2 sm:px-3"
                    onClick={() => handleRemoveSlide(slide.id)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('common.delete')}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </>
  );
};

export default SettingsPageVisual;
