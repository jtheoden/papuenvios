import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Palette, Upload, Plus, Trash2, Check, RefreshCw, Save, Eye, Image, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { isImageUploadError, getImageUploadMessageKey } from '@/lib/imageStorage';
import { pickNewKeys, getContrastIssues, isHexColor, toLongHex } from '@/lib/brandPalette';
import { showNameWithLogo, getLoaderConfig } from '@/lib/brandingDisplay';
import HeaderPreview from '@/components/settings/HeaderPreview';
import LoaderPreview from '@/components/settings/LoaderPreview';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { THEME_IDS, THEME_PRESETS, resolveThemeId, pickThemeKeys, selectTheme, restoreThemeDefaults, getThemeDeviations, getThemeFormDefaults, applyThemePalette } from '@/lib/visualThemes';
import { HERO_LAYOUTS, resolveHeroLayout } from '@/lib/heroLayout';
import {
  getCarouselSlides, createCarouselSlide, updateCarouselSlide,
  hardDeleteCarouselSlide, toggleCarouselSlideActive
} from '@/lib/carouselService';
import { useRealtimeCarouselSlides } from '@/hooks/useRealtimeSubscription';
import FooterPreview from '@/components/settings/FooterPreview';

// Colours drawn in each theme card (decorative; the description carries the meaning)
const SWATCH_KEYS = ['buttonBgColor', 'headerMenuActiveBgColor', 'pageBgColor', 'headingColor'];

// canChangeTheme: only a super admin may pick the default theme (the tab itself is open to admins)
const SettingsPageVisual = ({ localVisual, setLocalVisual, visualSettings, setVisualSettings, canChangeTheme = false }) => {
  const { t, language } = useLanguage();
  const confirm = useConfirm();
  const hasPaletteSuggestions = Object.keys(getThemeFormDefaults(visualSettings)).length > 0;
  const [livePreview, setLivePreview] = useState(!hasPaletteSuggestions);
  // Suggestions lock preview too, but only user-owned drafts block external settings refreshes.
  const [paletteDraft, setPaletteDraft] = useState(hasPaletteSuggestions);
  const intentionalPaletteDraft = useRef(false);
  const heroLayoutOnlyDraft = useRef(false);
  const [settingsReplay, setSettingsReplay] = useState(0);
  const isUserEditing = useRef(false); // Track if user is actively editing
  const originalSettings = useRef(null); // Store original settings for cancel functionality
  const [hasChanges, setHasChanges] = useState(false); // Track if there are unsaved changes
  const [presetUndo, setPresetUndo] = useState(null); // Form state before the brand preset, null when not applied
  const [bgDraft, setBgDraft] = useState(null); // loader background text while typing; null = follow the form value
  const [resetOpen, setResetOpen] = useState(false); // Confirmation dialog of "Restore theme"
  const [heroLayoutDraft, setHeroLayoutDraft] = useState(() => resolveHeroLayout(visualSettings));

  const [appearance, setAppearance] = useState({
    companyName: visualSettings.companyName || 'PapuEnvíos',
    siteTitle: visualSettings.siteTitle || 'PapuEnvios - Remesas y E-Commerce',
    logo: visualSettings.logo || '',
    favicon: visualSettings.favicon || '',
    primaryColor: visualSettings.primaryColor || '#2563eb',
    secondaryColor: visualSettings.secondaryColor || '#9333ea',
    useGradient: visualSettings.useGradient !== undefined ? visualSettings.useGradient : true,
    // Nav bar active item
    navBarActiveBgColor: visualSettings.navBarActiveBgColor || '#2563eb',
    navBarActiveTextColor: visualSettings.navBarActiveTextColor || '#ffffff',
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
    tabHoverColor: visualSettings.tabHoverColor || '#1f2937',
    tabHoverBgColor: visualSettings.tabHoverBgColor || '#f3f4f6',
    // Button colors
    buttonBgColor: visualSettings.buttonBgColor || '#2563eb',
    buttonTextColor: visualSettings.buttonTextColor || '#ffffff',
    buttonHoverBgColor: visualSettings.buttonHoverBgColor || '#1d4ed8',
    destructiveBgColor: visualSettings.destructiveBgColor || '#dc2626',
    destructiveTextColor: visualSettings.destructiveTextColor || '#ffffff',
    destructiveHoverBgColor: visualSettings.destructiveHoverBgColor || '#b91c1c',
    accentColor: visualSettings.accentColor || '#9333ea',
    pageBgColor: visualSettings.pageBgColor || '#f9fafb',
    cardBgColor: visualSettings.cardBgColor || '#ffffff',
    showCompanyName: visualSettings.showCompanyName !== undefined ? visualSettings.showCompanyName : true,
    showCompanyNameWithLogo: showNameWithLogo(visualSettings),
    loaderImage: visualSettings.loaderImage || '',
    loaderBgColor: visualSettings.loaderBgColor || '',
    logoMaxHeight: visualSettings.logoMaxHeight || 40,
    // Header interaction states
    headerMenuHoverTextColor: visualSettings.headerMenuHoverTextColor || '#1f2937',
    headerMenuActiveBgColor: visualSettings.headerMenuActiveBgColor || '#eff6ff',
    useHeaderGradient: visualSettings.useHeaderGradient || false,
    headerGradientColor: visualSettings.headerGradientColor || '',
    // Semantic status colors
    successColor: visualSettings.successColor || '#10b981',
    warningColor: visualSettings.warningColor || '#f59e0b',
    errorColor: visualSettings.errorColor || '#ef4444',
    infoColor: visualSettings.infoColor || '#0ea5e9',
    // Shadow system
    useButtonShadow: visualSettings.useButtonShadow || false,
    buttonShadowColor: visualSettings.buttonShadowColor || '#2563eb',
    useCardShadow: visualSettings.useCardShadow !== undefined ? visualSettings.useCardShadow : true,
    cardShadowColor: visualSettings.cardShadowColor || '#00000015',
    useTextShadow: visualSettings.useTextShadow || false,
    textShadowColor: visualSettings.textShadowColor || '#00000030',
    // Gradient enhancements
    gradientDirection: visualSettings.gradientDirection || '135',
    useButtonGradient: visualSettings.useButtonGradient !== undefined ? visualSettings.useButtonGradient : true,
    useTabGradient: visualSettings.useTabGradient || false,
    // Footer colors
    footerBgColor: visualSettings.footerBgColor || '#ffffff',
    footerTextColor: visualSettings.footerTextColor || '#374151',
    footerLinkColor: visualSettings.footerLinkColor || '#2563eb',
    footerLinkHoverColor: visualSettings.footerLinkHoverColor || '#9333ea',
    // Carousel
    carouselEnabled: visualSettings.carouselEnabled !== undefined ? visualSettings.carouselEnabled : true,
    carouselAutoplaySpeed: visualSettings.carouselAutoplaySpeed || 5000,
    carouselTransitionSpeed: visualSettings.carouselTransitionSpeed || 1000,
    // Brand refresh keys
    ...pickNewKeys(visualSettings),
    // Selectable default theme (activeTheme + classic snapshot)
    ...pickThemeKeys(visualSettings),
    ...getThemeFormDefaults(visualSettings)
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
  const [expandedSlide, setExpandedSlide] = useState(null);

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
    if (isUserEditing.current || intentionalPaletteDraft.current) return;

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
      tabHoverColor: visualSettings.tabHoverColor || '#1f2937',
      tabHoverBgColor: visualSettings.tabHoverBgColor || '#f3f4f6',
      buttonBgColor: visualSettings.buttonBgColor || '#2563eb',
      buttonTextColor: visualSettings.buttonTextColor || '#ffffff',
      buttonHoverBgColor: visualSettings.buttonHoverBgColor || '#1d4ed8',
      destructiveBgColor: visualSettings.destructiveBgColor || '#dc2626',
      destructiveTextColor: visualSettings.destructiveTextColor || '#ffffff',
      destructiveHoverBgColor: visualSettings.destructiveHoverBgColor || '#b91c1c',
      accentColor: visualSettings.accentColor || '#9333ea',
      pageBgColor: visualSettings.pageBgColor || '#f9fafb',
      cardBgColor: visualSettings.cardBgColor || '#ffffff',
      showCompanyName: visualSettings.showCompanyName !== undefined ? visualSettings.showCompanyName : true,
      showCompanyNameWithLogo: showNameWithLogo(visualSettings),
      loaderImage: visualSettings.loaderImage || '',
      loaderBgColor: visualSettings.loaderBgColor || '',
      logoMaxHeight: visualSettings.logoMaxHeight || 40,
      // Nav bar active item
      navBarActiveBgColor: visualSettings.navBarActiveBgColor || '#2563eb',
      navBarActiveTextColor: visualSettings.navBarActiveTextColor || '#ffffff',
      // Header interaction states
      headerMenuHoverTextColor: visualSettings.headerMenuHoverTextColor || '#1f2937',
      headerMenuActiveBgColor: visualSettings.headerMenuActiveBgColor || '#eff6ff',
      useHeaderGradient: visualSettings.useHeaderGradient || false,
      headerGradientColor: visualSettings.headerGradientColor || '',
      // Semantic status colors
      successColor: visualSettings.successColor || '#10b981',
      warningColor: visualSettings.warningColor || '#f59e0b',
      errorColor: visualSettings.errorColor || '#ef4444',
      infoColor: visualSettings.infoColor || '#0ea5e9',
      // Shadow system
      useButtonShadow: visualSettings.useButtonShadow || false,
      buttonShadowColor: visualSettings.buttonShadowColor || '#2563eb',
      useCardShadow: visualSettings.useCardShadow !== undefined ? visualSettings.useCardShadow : true,
      cardShadowColor: visualSettings.cardShadowColor || '#00000015',
      useTextShadow: visualSettings.useTextShadow || false,
      textShadowColor: visualSettings.textShadowColor || '#00000030',
      // Gradient enhancements
      gradientDirection: visualSettings.gradientDirection || '135',
      useButtonGradient: visualSettings.useButtonGradient !== undefined ? visualSettings.useButtonGradient : true,
      useTabGradient: visualSettings.useTabGradient || false,
      // Footer colors
      footerBgColor: visualSettings.footerBgColor || '#ffffff',
      footerTextColor: visualSettings.footerTextColor || '#374151',
      footerLinkColor: visualSettings.footerLinkColor || '#2563eb',
      footerLinkHoverColor: visualSettings.footerLinkHoverColor || '#9333ea',
      // Carousel
      carouselEnabled: visualSettings.carouselEnabled !== undefined ? visualSettings.carouselEnabled : true,
      carouselAutoplaySpeed: visualSettings.carouselAutoplaySpeed || 5000,
      carouselTransitionSpeed: visualSettings.carouselTransitionSpeed || 1000,
      ...pickNewKeys(visualSettings),
      ...pickThemeKeys(visualSettings),
      ...getThemeFormDefaults(visualSettings)
    };
    setAppearance(newAppearance);
    setLogoPreview(visualSettings.logo || '');
    setFaviconPreview(visualSettings.favicon || '');
    setHeroLayoutDraft(resolveHeroLayout(visualSettings));
    setHasChanges(false);
    setPaletteDraft(hasPaletteSuggestions);
    if (hasPaletteSuggestions) {
      setLivePreview(false);
    }
  }, [visualSettings, settingsReplay]);

  const selectedThemeId = resolveThemeId(appearance);
  const savedThemeId = resolveThemeId(visualSettings);
  const themePending = selectedThemeId !== savedThemeId; // chosen in the form, not saved yet
  const savedHeroLayout = resolveHeroLayout(visualSettings);
  const heroLayoutPending = heroLayoutDraft !== savedHeroLayout;
  const previewLocked = themePending || paletteDraft || heroLayoutPending;
  const themeDeviations = getThemeDeviations(appearance); // preset colours edited by hand

  // Update appearance with live preview
  const patchAppearance = useCallback((patch) => {
    isUserEditing.current = true;
    heroLayoutOnlyDraft.current = false;
    if (previewLocked) intentionalPaletteDraft.current = true;
    setHasChanges(true);
    const newAppearance = { ...appearance, ...patch };
    setAppearance(newAppearance);

    // Apply live preview to the entire system (never while a theme choice is unsaved: it would persist it)
    if (livePreview && !previewLocked) {
      setVisualSettings({ ...visualSettings, ...newAppearance });
    }

    // Reset editing flag after a delay
    setTimeout(() => { isUserEditing.current = false; }, 1000);
  }, [appearance, visualSettings, setVisualSettings, livePreview, previewLocked]);
  const updateAppearance = useCallback((key, value) => patchAppearance({ [key]: value }), [patchAppearance]);

  // Theme selector: fills the FORM only. Live preview goes off (and stays locked while the choice is
  // unsaved) because updateAppearance would otherwise persist the whole form on the next edit.
  const stagePalette = (nextAppearance) => {
    const priorHeroLayoutOnlyDraft = heroLayoutOnlyDraft.current;
    heroLayoutOnlyDraft.current = false;
    const priorIntentionalDraft = intentionalPaletteDraft.current;
    setPresetUndo(prev => prev ?? {
      appearance,
      livePreview,
      paletteDraft,
      intentionalPaletteDraft: priorIntentionalDraft,
      heroLayoutOnlyDraft: priorHeroLayoutOnlyDraft,
      visualSettings,
    });
    intentionalPaletteDraft.current = true;
    setAppearance(nextAppearance);
    setPaletteDraft(true);
    setLivePreview(false);
    setHasChanges(true);
    // Same guard as updateAppearance: an external visualSettings refresh must not wipe the choice.
    isUserEditing.current = true;
    setTimeout(() => { isUserEditing.current = false; }, 1000);
  };

  const handleSelectTheme = (themeId) => {
    if (!canChangeTheme || themeId === selectedThemeId) return;
    stagePalette(selectTheme(appearance, themeId));
  };

  const handleSelectHeroLayout = (layout) => {
    if (!canChangeTheme || !HERO_LAYOUTS.includes(layout) || layout === heroLayoutDraft) return;
    const returningToSavedLayout = layout === savedHeroLayout;
    const replayLatestSettings = returningToSavedLayout && heroLayoutOnlyDraft.current && !paletteDraft && !themePending;
    if (replayLatestSettings) {
      // A Hero-only draft no longer owns the form. Replay settings that may have
      // arrived while it was pending instead of leaving the sync effect blocked.
      heroLayoutOnlyDraft.current = false;
      intentionalPaletteDraft.current = false;
      isUserEditing.current = false;
      setSettingsReplay((revision) => revision + 1);
    } else if (!returningToSavedLayout && !intentionalPaletteDraft.current) {
      heroLayoutOnlyDraft.current = true;
    } else {
      heroLayoutOnlyDraft.current = false;
    }
    setHeroLayoutDraft(layout);
    setLivePreview(false);
    setHasChanges(true);
    if (!returningToSavedLayout || paletteDraft || themePending) intentionalPaletteDraft.current = true;
    if (!replayLatestSettings) {
      isUserEditing.current = true;
      setTimeout(() => { isUserEditing.current = false; }, 1000);
    }
  };

  const handleUndoBrandPreset = () => {
    if (!presetUndo) return;
    setAppearance(presetUndo.appearance);
    setLivePreview(presetUndo.livePreview);
    setPaletteDraft(presetUndo.paletteDraft);
    const restoreHeroLayoutDraft = Boolean(
      presetUndo.heroLayoutOnlyDraft && heroLayoutDraft !== savedHeroLayout
    );
    const restoreIntentionalDraft = Boolean(
      presetUndo.intentionalPaletteDraft && (!presetUndo.heroLayoutOnlyDraft || restoreHeroLayoutDraft)
    );
    intentionalPaletteDraft.current = restoreIntentionalDraft;
    heroLayoutOnlyDraft.current = restoreHeroLayoutDraft;
    // A refresh may already have arrived while this draft blocked syncing. Releasing an
    // unowned baseline must replay it even when visualSettings will not change again.
    if (!restoreIntentionalDraft && presetUndo.visualSettings !== visualSettings) {
      isUserEditing.current = false;
      setSettingsReplay(prev => prev + 1);
    }
    setPresetUndo(null);
    setHasChanges(true);
  };

  const contrastIssues = getContrastIssues(appearance);

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

      if (previewLocked) intentionalPaletteDraft.current = true;
      heroLayoutOnlyDraft.current = false;
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

  // Initial loading screen image: same validation and processing as the logo upload.
  const handleLoaderImageUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
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
      patchAppearance({ loaderImage: result.base64 });
      toast({ title: t('settings.visual.loader.imageUploaded') });
    } catch (error) {
      console.error('Error processing loader image:', error);
      toast({
        title: t('settings.visual.errorProcessingImage'),
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Only a strict hex colour (or empty = theme background) reaches the form; anything else just shows the error.
  const handleLoaderBgChange = (value) => {
    setBgDraft(value);
    if (value === '' || isHexColor(value)) patchAppearance({ loaderBgColor: value });
  };

  const handleResetLoader = () => {
    patchAppearance({ loaderImage: '', loaderBgColor: '' });
    setBgDraft(null);
    toast({ title: t('settings.visual.loader.resetDone') });
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

      if (previewLocked) intentionalPaletteDraft.current = true;
      heroLayoutOnlyDraft.current = false;
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
    if (heroLayoutPending) newSettings.heroLayout = heroLayoutDraft;
    await setVisualSettings(newSettings);
    // Update browser tab title
    document.title = appearance.siteTitle || appearance.companyName;
    // Update original settings reference after successful save
    originalSettings.current = { ...newSettings };
    setHasChanges(false);
    setPresetUndo(null);
    setPaletteDraft(false);
    intentionalPaletteDraft.current = false;
    heroLayoutOnlyDraft.current = false;
    toast({
      title: t('settings.saveSuccess'),
      description: t('settings.visual.changesSaved')
    });
  };

  // Restore only the form. Like Apply palette, persistence requires Save Personalization.
  const handleRestoreTheme = () => {
    if (!canChangeTheme) return;
    setResetOpen(false);
    stagePalette(restoreThemeDefaults(appearance));
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
      const newSlide = await createCarouselSlide({
        title_es: t('settings.visual.newSlideDefaultEs'),
        title_en: t('settings.visual.newSlideDefaultEn'),
        subtitle_es: '', subtitle_en: '',
        image_url: '', link_url: '', is_active: false
      });

      await loadCarouselSlides();

      // Auto-expand and scroll to the new slide
      if (newSlide?.id) {
        setExpandedSlide(newSlide.id);
        setTimeout(() => {
          document.getElementById(`slide-${newSlide.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }

      toast({
        title: t('settings.visual.slideCreated')
      });
    } catch (error) {
      console.error('Error creating slide:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleSlideChange = async (id, updates) => {
    try {
      setSavingSlide(id);
      setSavedSlide(null);

      const saved = await updateCarouselSlide(id, updates);
      if (saved?.error) throw saved.error;

      // A new image is stored as a Storage URL: keep that, not the base64 that was sent
      const applied = updates.image_url && saved?.image_url
        ? { ...updates, image_url: saved.image_url }
        : updates;

      setCarouselSlides(prev =>
        prev.map(slide => (slide.id === id ? { ...slide, ...applied } : slide))
      );

      setSavingSlide(null);
      setSavedSlide(id);
      setTimeout(() => setSavedSlide(null), 1500);
      return applied;
    } catch (error) {
      console.error('Error updating slide:', error);
      setSavingSlide(null);
      toast({
        title: t('settings.visual.errorUpdating'),
        description: isImageUploadError(error) ? t(getImageUploadMessageKey(error)) : error.message,
        variant: 'destructive'
      });
      return null;
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
    if (!(await confirm({
      title: t('common.confirmDialog.deleteTitle'),
      description: t('settings.visual.confirmDeleteSlide'),
      confirmLabel: t('common.confirmDialog.delete'),
      variant: 'destructive'
    }))) {
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
        title: t('common.error'),
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
        title: t('common.error'),
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

      const applied = await handleSlideChange(slideId, { image_url: result.base64 });
      if (!applied) return; // upload/save failed: nothing was stored, keep the previous image
      setSlidePreviews(prev => ({ ...prev, [slideId]: applied.image_url }));

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

  const handleToggleSlideActive = async (slideId, currentActive) => {
    try {
      await toggleCarouselSlideActive(slideId, !currentActive);
      setCarouselSlides(prev =>
        prev.map(s => s.id === slideId ? { ...s, is_active: !currentActive } : s)
      );
      toast({
        title: !currentActive ? t('settings.visual.slideActive') : t('settings.visual.slideInactive')
      });
    } catch (error) {
      console.error('Error toggling slide active:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // Realtime: reload slides when changed externally
  useRealtimeCarouselSlides({
    onUpdate: () => loadCarouselSlides()
  });

  return (
    <>
      {/* Appearance Customization */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-4 sm:p-8 rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-2xl font-semibold flex items-center">
            <Palette className="mr-3 text-theme-accent-2" />
            {t('settings.visual.appearance')}
          </h2>
          {/* Live Preview Toggle */}
          <label className="flex items-center gap-2 cursor-pointer bg-theme-accent-soft px-3 py-2 rounded-lg border border-theme-accent-line">
            <Eye className={`h-4 w-4 ${livePreview ? 'text-theme-link' : 'text-gray-400'}`} />
            <input
              type="checkbox"
              checked={livePreview}
              disabled={previewLocked}
              onChange={e => setLivePreview(e.target.checked)}
              className="rounded"
            />
            <span className={`text-sm font-medium ${livePreview ? 'text-theme-link-strong' : 'text-gray-500'}`}>
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

        {/* Default theme selector + contrast warning */}
        <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50/60">
          <p id="theme-selector-label" className="text-base font-semibold text-gray-900">{t('settings.visual.brand.theme.title')}</p>
          <p id="theme-selector-hint" className="text-sm text-gray-700 mt-1">{t('settings.visual.brand.theme.hint')}</p>
          <div
            role="radiogroup"
            aria-labelledby="theme-selector-label"
            aria-describedby="theme-selector-hint"
            className="grid sm:grid-cols-2 gap-3 mt-3"
          >
            {THEME_IDS.map((themeId) => {
              const selected = themeId === selectedThemeId;
              const nameId = `theme-${themeId}-name`;
              const descId = `theme-${themeId}-desc`;
              const inUseId = `theme-${themeId}-inuse`;
              const inUse = themeId === savedThemeId;
              return (
                <label
                  key={themeId}
                  className={`relative flex flex-col gap-2 rounded-xl border-2 bg-white p-4 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-gray-900 ${
                    selected ? 'border-gray-900' : 'border-gray-200'
                  } ${canChangeTheme ? 'cursor-pointer hover:border-gray-500' : 'cursor-not-allowed opacity-75'}`}
                >
                  <input
                    type="radio"
                    name="visual-default-theme"
                    value={themeId}
                    checked={selected}
                    disabled={!canChangeTheme}
                    onChange={() => handleSelectTheme(themeId)}
                    aria-labelledby={nameId}
                    aria-describedby={inUse ? `${descId} ${inUseId}` : descId}
                    className="sr-only"
                  />
                  <span className="flex items-center justify-between gap-2">
                    <span id={nameId} className="font-semibold text-gray-900">{t(`settings.visual.brand.theme.${themeId}.name`)}</span>
                    <span className="flex items-center gap-1 text-xs font-medium">
                      {selected && <Check className="h-4 w-4 text-gray-900" aria-hidden="true" />}
                      {inUse && (
                        <span id={inUseId} className="rounded-full bg-gray-900 px-2 py-0.5 text-white">{t('settings.visual.brand.theme.inUse')}</span>
                      )}
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    {SWATCH_KEYS.map((key) => (
                      <span
                        key={key}
                        data-testid="theme-swatch"
                        aria-hidden="true"
                        className="h-6 w-6 rounded-full border border-gray-300"
                        style={{ backgroundColor: THEME_PRESETS[themeId][key] }}
                      />
                    ))}
                  </span>
                  <span id={descId} className="text-sm text-gray-700">{t(`settings.visual.brand.theme.${themeId}.description`)}</span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gray-600 mt-3">{t('settings.visual.brand.theme.changes')}</p>
          {!canChangeTheme && <p className="text-xs text-amber-800 mt-1">{t('settings.visual.brand.theme.restricted')}</p>}
          {themeDeviations.length > 0 && (
            <p data-testid="theme-customized" role="status" className="text-sm text-amber-800 mt-2">
              {t('settings.visual.brand.theme.customized')}
            </p>
          )}
          {presetUndo && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p data-testid="brand-preset-applied" role="status" className="text-sm text-green-700">
                {t('settings.visual.brand.theme.pending')}
              </p>
              <Button type="button" variant="ghost" onClick={handleUndoBrandPreset} className="h-9 px-3">
                {t('settings.visual.brand.undoPreset')}
              </Button>
            </div>
          )}
          <div data-testid="brand-contrast-warning" role="status" className={contrastIssues.length ? 'mt-3 text-sm text-amber-800' : undefined}>
            {contrastIssues.length > 0 && (
              <>
                <p className="font-medium">{t('settings.visual.brand.contrastWarning')}</p>
                <ul className="list-disc pl-5 mt-1">
                  {contrastIssues.map(({ id, ratio }) => (
                    <li key={id}>{`${t(`settings.visual.brand.pair.${id}`)}: ${ratio.toFixed(2)}:1`}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Logo & Favicon Upload */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('settings.visual.logo')}</label>
            <div className="mb-3 p-4 border border-gray-200 rounded-lg bg-gray-50 min-h-[80px] flex items-center justify-center">
              {logoPreview ? (
                <div className="flex items-center gap-4">
                  <img src={logoPreview} alt="Logo preview" className="max-h-[120px] w-auto object-contain" />
                  <button
                    type="button"
                    onClick={() => {
                      setLogoPreview('');
                      updateAppearance('logo', '');
                      toast({ title: t('settings.visual.logoRemoved') });
                    }}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title={t('settings.visual.removeLogo')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  <Image className="h-8 w-8 mx-auto mb-1" />
                  <p className="text-xs">{t('settings.visual.noLogoUploaded')}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50" title={t('settings.visual.uploadLogo')}>
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{t('settings.visual.uploadLogo')}</span>
                <input type="file" accept="image/png,image/svg+xml,image/webp" onChange={handleLogoUpload} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">{t('settings.visual.logoHint')}</p>

            {/* Logo Size Slider */}
            {logoPreview && (
              <div className="mt-4">
                <label className="block text-sm font-medium mb-2">
                  {t('settings.visual.logoMaxHeight')}: {appearance.logoMaxHeight}{t('settings.visual.logoSizePx')}
                </label>
                <input
                  type="range"
                  min="24"
                  max="64"
                  step="2"
                  value={appearance.logoMaxHeight}
                  onChange={e => updateAppearance('logoMaxHeight', parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>24px</span>
                  <span>64px</span>
                </div>
              </div>
            )}
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
            <label className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={appearance.showCompanyNameWithLogo}
                disabled={!appearance.logo}
                onChange={e => updateAppearance('showCompanyNameWithLogo', e.target.checked)}
                aria-describedby="company-name-with-logo-hint"
                className="rounded"
              />
              <span className="text-sm font-medium">{t('settings.visual.showCompanyNameWithLogo')}</span>
            </label>
            <p id="company-name-with-logo-hint" className="text-xs text-gray-500 mt-1">{t('settings.visual.showCompanyNameWithLogoHint')}</p>
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

        {/* Header preview: same brand block and colour computation as the real Header (unsaved form state) */}
        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium mb-3 text-gray-700">
            <Eye className="h-4 w-4" />
            {t('settings.visual.headerPreview')}
          </label>
          <HeaderPreview settings={{ ...visualSettings, ...appearance }} />
        </div>

        {/* Initial loading screen: optional image and background; unset => theme tokens, site logo, wordmark */}
        <section aria-label={t('settings.visual.loader.title')} className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-800">{t('settings.visual.loader.title')}</h3>
            <Button type="button" variant="outline" size="sm" onClick={handleResetLoader}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('settings.visual.loader.reset')}
            </Button>
          </div>
          <p className="text-sm text-gray-600 mb-4">{t('settings.visual.loader.description')}</p>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <span className="block text-sm font-medium mb-2">{t('settings.visual.loader.image')}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                    <Upload className="h-4 w-4" />
                    <span>{t('settings.visual.loader.uploadImage')}</span>
                    <input type="file" accept="image/png,image/svg+xml,image/webp" data-testid="loader-image-input" onChange={handleLoaderImageUpload} className="hidden" />
                  </label>
                  {appearance.loaderImage && (
                    <button
                      type="button"
                      onClick={() => patchAppearance({ loaderImage: '' })}
                      className="flex items-center gap-1 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('settings.visual.loader.removeImage')}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">{t('settings.visual.loader.imageHint')}</p>
                {!appearance.loaderImage && (
                  <p className="text-xs text-gray-600 mt-1">
                    {t(appearance.logo ? 'settings.visual.loader.usingLogo' : 'settings.visual.loader.usingWordmark')}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="loader-bg-color" className="block text-sm font-medium mb-2">{t('settings.visual.loader.bgColor')}</label>
                <div className="flex items-center gap-2">
                  <input
                    id="loader-bg-color"
                    type="text"
                    inputMode="text"
                    maxLength={7}
                    placeholder={t('settings.visual.loader.usingThemeBg')}
                    value={bgDraft !== null ? bgDraft : appearance.loaderBgColor}
                    onChange={e => handleLoaderBgChange(e.target.value.trim())}
                    aria-invalid={bgDraft !== null && bgDraft !== '' && !isHexColor(bgDraft)}
                    className="input-style w-40"
                  />
                  <input
                    type="color"
                    aria-label={t('settings.visual.loader.bgColorPicker')}
                    value={isHexColor(appearance.loaderBgColor) ? toLongHex(appearance.loaderBgColor) : '#ffffff'}
                    onChange={e => handleLoaderBgChange(e.target.value)}
                    className="w-10 h-9 rounded cursor-pointer border border-gray-300"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('settings.visual.loader.bgColorHint')}</p>
                {bgDraft !== null && bgDraft !== '' && !isHexColor(bgDraft) && (
                  <p role="alert" className="text-xs text-red-600 mt-1">{t('settings.visual.loader.bgColorInvalid')}</p>
                )}
              </div>
            </div>
            <div>
              <span className="block text-sm font-medium mb-2">{t('settings.visual.loader.preview')}</span>
              <LoaderPreview settings={{ ...visualSettings, ...appearance }} />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 1: Brand & Global Colors                           */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-lg font-semibold text-gray-800">{t('settings.visual.brandIdentity')}</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => stagePalette(applyThemePalette(appearance))} className="h-auto whitespace-normal text-left">
              {t('settings.visual.brand.applyPalette')}
            </Button>
          </div>
          {paletteDraft && <p role="status" className="text-sm text-theme-link mb-3">{t('settings.visual.brand.paletteDraft')}</p>}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { key: 'primaryColor', label: t('settings.visual.primaryColor') },
              { key: 'secondaryColor', label: t('settings.visual.secondaryColor') },
              { key: 'accentColor', label: t('settings.visual.accentColor') },
              { key: 'pageBgColor', label: t('settings.visual.pageBackground') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`identity-${key}`} className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input id={`identity-${key}`} type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Global toggles */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useGradient} onChange={e => updateAppearance('useGradient', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useGradient')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.showCompanyName} onChange={e => updateAppearance('showCompanyName', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.showCompanyName')}</span>
            </label>
          </div>
          {/* Gradient direction */}
          <div>
            <label className="block text-xs font-medium mb-1.5 text-gray-600">
              {t('settings.visual.gradientAngle')}: {appearance.gradientDirection}°
            </label>
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="360" step="5" value={appearance.gradientDirection} onChange={e => updateAppearance('gradientDirection', e.target.value)} className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
              <div data-testid="brand-gradient-preview" aria-hidden="true" className="w-9 h-9 rounded-lg flex-shrink-0 border border-gray-200" style={{ background: `linear-gradient(${appearance.gradientDirection}deg, ${appearance.primaryColor}, ${appearance.secondaryColor})` }} />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 2: Header & Navigation                             */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.headerNavigation')}
          </h3>
          {/* Navigation Bar subsection */}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('settings.visual.navigationBar')}</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { key: 'headerBgColor', label: t('settings.visual.navBarBackground') },
              { key: 'headerTextColor', label: t('settings.visual.navBarText') },
              { key: 'navBarActiveBgColor', label: t('settings.visual.navBarActiveBg') },
              { key: 'navBarActiveTextColor', label: t('settings.visual.navBarActiveText') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Dropdown Menus subsection */}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">{t('settings.visual.dropdownMenus')}</p>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {[
              { key: 'headerMenuBgColor', label: t('settings.visual.dropdownBackground') },
              { key: 'headerMenuTextColor', label: t('settings.visual.dropdownText') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Hover & Active States subsection */}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">{t('settings.visual.hoverActiveStates')}</p>
          <p className="text-xs text-gray-400 mb-3 italic">{t('settings.visual.hoverActiveHint')}</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { key: 'headerMenuHoverBgColor', label: t('settings.visual.hoverBackground') },
              { key: 'headerMenuHoverTextColor', label: t('settings.visual.hoverText') },
              { key: 'headerMenuActiveBgColor', label: t('settings.visual.activeBackground') },
              { key: 'headerMenuActiveColor', label: t('settings.visual.activeText') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Effects */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useHeaderGradient} onChange={e => updateAppearance('useHeaderGradient', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.gradientOnActive')}</span>
            </label>
            {appearance.useHeaderGradient && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">{t('settings.visual.gradientEndColor')}</label>
                <input type="color" value={toLongHex(isHexColor(appearance.headerGradientColor) ? appearance.headerGradientColor : appearance.navBarActiveBgColor)} onChange={e => updateAppearance('headerGradientColor', e.target.value)} className="w-10 h-8 rounded cursor-pointer border border-gray-300" />
              </div>
            )}
          </div>
          {/* Header interactive preview: the real Header's brand block and colours for the unsaved form state */}
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t('settings.visual.headerPreview')}</p>
            <HeaderPreview settings={{ ...visualSettings, ...appearance }} />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 3: Headings & Text                                 */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.headingsText')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-gray-600">{t('settings.visual.headingColor')}</label>
              <input type="color" value={appearance.headingColor} onChange={e => updateAppearance('headingColor', e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useHeadingGradient} onChange={e => updateAppearance('useHeadingGradient', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useHeadingGradient')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useTextShadow} onChange={e => updateAppearance('useTextShadow', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useTextShadow')}</span>
            </label>
            {appearance.useTextShadow && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">{t('settings.visual.textShadowColor')}</label>
                <input type="color" value={appearance.textShadowColor.slice(0, 7)} onChange={e => updateAppearance('textShadowColor', e.target.value)} className="w-10 h-8 rounded cursor-pointer border border-gray-300" />
              </div>
            )}
          </div>
          {/* Heading preview */}
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t('settings.visual.headingPreview')}</p>
            <h4
              className="text-xl font-bold"
              style={{
                ...(appearance.useHeadingGradient || appearance.useGradient ? {
                  backgroundImage: `linear-gradient(${appearance.gradientDirection || 135}deg, ${appearance.primaryColor}, ${appearance.secondaryColor})`,
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'
                } : { color: appearance.headingColor }),
                textShadow: appearance.useTextShadow ? `0 2px 4px ${appearance.textShadowColor || '#00000030'}` : 'none'
              }}
            >
              {t('settings.visual.headingPreview')}
            </h4>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 4: Tabs                                            */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.tabColors')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {[
              { key: 'tabActiveColor', label: t('settings.visual.tabActiveText') },
              { key: 'tabActiveBgColor', label: t('settings.visual.tabActiveBg') },
              { key: 'tabInactiveColor', label: t('settings.visual.tabInactiveText') },
              { key: 'tabInactiveBgColor', label: t('settings.visual.tabInactiveBg') },
              { key: 'tabHoverColor', label: t('settings.visual.tabHoverText') },
              { key: 'tabHoverBgColor', label: t('settings.visual.tabHoverBg') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useTabGradient} onChange={e => updateAppearance('useTabGradient', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useTabGradient')}</span>
            </label>
          </div>
          {/* Tab interactive preview */}
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t('settings.visual.tabPreview')}</p>
            <div className="flex border-b" style={{ borderBottomColor: '#e5e7eb' }}>
              {[t('settings.visual.tabPreviewGeneral'), t('settings.visual.tabPreviewVisual'), t('settings.visual.tabPreviewFinancial')].map((label, i) => {
                const isActive = i === 1;
                return (
                  <span
                    key={label}
                    className="px-4 py-2 text-sm font-medium cursor-default transition-colors rounded-t-lg"
                    style={isActive
                      ? (appearance.useTabGradient
                          ? { background: `linear-gradient(${appearance.gradientDirection || 135}deg, ${appearance.tabActiveColor}, ${appearance.secondaryColor})`, color: '#ffffff', borderBottom: '2px solid transparent' }
                          : { borderBottom: `2px solid ${appearance.tabActiveColor}`, color: appearance.tabActiveColor, backgroundColor: appearance.tabActiveBgColor })
                      : { color: appearance.tabInactiveColor, backgroundColor: appearance.tabInactiveBgColor }
                    }
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = appearance.tabHoverColor; e.currentTarget.style.backgroundColor = appearance.tabHoverBgColor; }}}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = appearance.tabInactiveColor; e.currentTarget.style.backgroundColor = appearance.tabInactiveBgColor; }}}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 5: Buttons                                         */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.buttons')}
          </h3>
          {/* Primary button colors */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {[
              { key: 'buttonBgColor', label: t('settings.visual.buttonColor') },
              { key: 'buttonTextColor', label: t('settings.visual.buttonTextColor') },
              { key: 'buttonHoverBgColor', label: t('settings.visual.buttonHoverColor') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Button gradient + shadow */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useButtonGradient} onChange={e => updateAppearance('useButtonGradient', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useButtonGradient')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useButtonShadow} onChange={e => updateAppearance('useButtonShadow', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useButtonShadow')}</span>
            </label>
            {appearance.useButtonShadow && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">{t('settings.visual.buttonShadowColor')}</label>
                <input type="color" value={appearance.buttonShadowColor.slice(0, 7)} onChange={e => updateAppearance('buttonShadowColor', e.target.value)} className="w-10 h-8 rounded cursor-pointer border border-gray-300" />
              </div>
            )}
          </div>
          {/* Destructive button colors */}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">{t('settings.visual.dangerButtons')}</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {[
              { key: 'destructiveBgColor', label: t('settings.visual.destructiveColor') },
              { key: 'destructiveTextColor', label: t('settings.visual.destructiveTextCol') },
              { key: 'destructiveHoverBgColor', label: t('settings.visual.destructiveHover') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Button interactive preview */}
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t('settings.visual.buttonPreview')}</p>
            <div className="flex flex-wrap gap-3">
              <div
                className="px-5 py-2.5 rounded-lg font-semibold text-sm cursor-default transition-all"
                style={{
                  background: (appearance.useButtonGradient ?? appearance.useGradient)
                    ? `linear-gradient(${appearance.gradientDirection || 135}deg, ${appearance.primaryColor}, ${appearance.secondaryColor})`
                    : appearance.buttonBgColor,
                  color: appearance.buttonTextColor,
                  boxShadow: appearance.useButtonShadow ? `0 4px 14px 0 ${appearance.buttonShadowColor || appearance.primaryColor}40` : 'none'
                }}
                onMouseEnter={e => { if (!(appearance.useButtonGradient ?? appearance.useGradient)) e.currentTarget.style.background = appearance.buttonHoverBgColor; }}
                onMouseLeave={e => { if (!(appearance.useButtonGradient ?? appearance.useGradient)) e.currentTarget.style.background = appearance.buttonBgColor; }}
              >
                {t('settings.visual.primaryButton')}
              </div>
              <div
                className="px-5 py-2.5 rounded-lg font-semibold text-sm cursor-default transition-all"
                style={{ backgroundColor: appearance.destructiveBgColor, color: appearance.destructiveTextColor }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = appearance.destructiveHoverBgColor; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = appearance.destructiveBgColor; }}
              >
                {t('settings.visual.deleteButton')}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 6: Cards & Backgrounds                             */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.cardsBackgrounds')}
          </h3>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-gray-600">{t('settings.visual.cardBackground')}</label>
              <input type="color" value={appearance.cardBgColor} onChange={e => updateAppearance('cardBgColor', e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={appearance.useCardShadow} onChange={e => updateAppearance('useCardShadow', e.target.checked)} className="rounded" />
              <span className="text-sm font-medium">{t('settings.visual.useCardShadow')}</span>
            </label>
            {appearance.useCardShadow && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">{t('settings.visual.cardShadowColor')}</label>
                <input type="color" value={appearance.cardShadowColor.slice(0, 7)} onChange={e => updateAppearance('cardShadowColor', e.target.value)} className="w-10 h-8 rounded cursor-pointer border border-gray-300" />
              </div>
            )}
          </div>
          {/* Card preview */}
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t('settings.visual.cardPreview')}</p>
            <div
              className="p-4 rounded-lg border border-gray-100 max-w-xs"
              style={{
                backgroundColor: appearance.cardBgColor,
                boxShadow: appearance.useCardShadow
                  ? `0 4px 6px -1px ${appearance.cardShadowColor || '#00000015'}, 0 2px 4px -2px ${appearance.cardShadowColor || '#00000010'}`
                  : 'none'
              }}
            >
              <span className="font-semibold text-sm text-gray-700">{t('settings.visual.cardPreview')}</span>
              <p className="text-xs text-gray-500 mt-1">Lorem ipsum dolor sit amet consectetur.</p>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 7: Status Colors                                   */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.statusIndicators')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { key: 'successColor', label: t('settings.visual.successColor') },
              { key: 'warningColor', label: t('settings.visual.warningColor') },
              { key: 'errorColor', label: t('settings.visual.errorColor') },
              { key: 'infoColor', label: t('settings.visual.infoColor') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Status preview strip */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-gray-500 mr-1 self-center">{t('settings.visual.statusPreview')}:</span>
            {[
              { label: 'Success', color: appearance.successColor },
              { label: 'Warning', color: appearance.warningColor },
              { label: 'Error', color: appearance.errorColor },
              { label: 'Info', color: appearance.infoColor }
            ].map(({ label, color }) => (
              <span key={label} className="px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: `${color}20`, color }}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 8: Footer                                          */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">
            {t('settings.visual.footerColors')}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { key: 'footerBgColor', label: t('settings.visual.footerBgColor') },
              { key: 'footerTextColor', label: t('settings.visual.footerTextColor') },
              { key: 'footerLinkColor', label: t('settings.visual.footerLinkColor') },
              { key: 'footerLinkHoverColor', label: t('settings.visual.footerLinkHoverColor') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
          {/* Footer preview */}
          <div className="p-3 bg-white rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t('settings.visual.footerPreview')}</p>
            <FooterPreview settings={appearance} />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 9: Brand & accents (cart badge, carousel dot, ...)  */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="mb-8 p-4 bg-gray-50/50 rounded-xl border border-gray-100">
          <h3 className="text-lg font-semibold mb-1 text-gray-800">
            {t('settings.visual.brand.sectionTitle')}
          </h3>
          <p className="text-xs text-gray-500 mb-4">{t('settings.visual.brand.sectionHint')}</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { key: 'cartBadgeBgColor', label: t('settings.visual.brand.cartBadgeBg') },
              { key: 'cartBadgeTextColor', label: t('settings.visual.brand.cartBadgeText') },
              { key: 'carouselDotActiveColor', label: t('settings.visual.brand.carouselDotActive') },
              { key: 'borderColor', label: t('settings.visual.brand.border') },
              { key: 'mutedTextColor', label: t('settings.visual.brand.mutedText') },
              { key: 'softAccentColor', label: t('settings.visual.brand.softAccent') },
              { key: 'focusRingColor', label: t('settings.visual.brand.focusRing') }
            ].map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`visual-${key}`} className="block text-xs font-medium mb-1.5 text-gray-600">{label}</label>
                <input id={`visual-${key}`} type="color" value={appearance[key]} onChange={e => updateAppearance(key, e.target.value)} className="w-full h-9 rounded-lg cursor-pointer border border-gray-300" />
              </div>
            ))}
          </div>
        </div>

        {/* Hero layout remains a form draft until the shared Save action is used. */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 id="hero-layout-label" className="text-base font-semibold text-foreground">
            {t('settings.visual.heroLayout.title')}
          </h3>
          <p id="hero-layout-hint" className="mt-1 text-sm text-muted-foreground">
            {t('settings.visual.heroLayout.hint')}
          </p>
          <div
            role="radiogroup"
            aria-labelledby="hero-layout-label"
            aria-describedby="hero-layout-hint"
            className="mt-3 grid gap-3 sm:grid-cols-2"
          >
            {HERO_LAYOUTS.map((layout) => {
              const selected = heroLayoutDraft === layout;
              const inUse = savedHeroLayout === layout;
              const nameId = `hero-layout-${layout}-name`;
              const descriptionId = `hero-layout-${layout}-description`;
              const inUseId = `hero-layout-${layout}-in-use`;
              return (
                <label
                  key={layout}
                  className={`rounded-xl border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-theme-focus ${
                    selected ? 'border-theme-accent bg-theme-accent-soft' : 'border-border bg-card'
                  } ${canChangeTheme ? 'cursor-pointer hover:border-theme-accent' : 'cursor-not-allowed opacity-75'}`}
                >
                  <input
                    type="radio"
                    name="hero-layout"
                    value={layout}
                    checked={selected}
                    disabled={!canChangeTheme}
                    onChange={() => handleSelectHeroLayout(layout)}
                    aria-labelledby={nameId}
                    aria-describedby={inUse ? `${descriptionId} ${inUseId}` : descriptionId}
                    data-testid={`hero-layout-option-${layout}`}
                    className="sr-only accent-theme-focus"
                  />
                  <span className="flex items-center justify-between gap-2">
                    <span id={nameId} className="font-semibold text-foreground">
                      {t(`settings.visual.heroLayout.${layout}.name`)}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium">
                      {selected && <Check className="h-4 w-4 text-theme-accent" aria-hidden="true" />}
                      {inUse && (
                        <span id={inUseId} className="rounded-full bg-theme-accent px-2 py-0.5 text-theme-on-accent">
                          {t('settings.visual.heroLayout.inUse')}
                        </span>
                      )}
                    </span>
                  </span>
                  <div
                    data-testid={`hero-layout-preview-${layout}`}
                    aria-hidden="true"
                    className="relative mt-3 h-24 overflow-hidden rounded-lg border border-border"
                    style={{ backgroundColor: layout === 'cover' ? appearance.pageBgColor : 'rgb(var(--t-page-via))' }}
                  >
                    {layout === 'cover' ? (
                      <>
                        <div
                          className="absolute inset-0 opacity-50"
                          style={{ background: `linear-gradient(120deg, ${appearance.primaryColor}, ${appearance.secondaryColor})` }}
                        />
                        <div className="absolute inset-x-2 top-2 h-1 rounded" style={{ backgroundColor: appearance.headingColor }} />
                        <div className="absolute bottom-2 left-2 h-2 w-1/3 rounded" style={{ backgroundColor: appearance.headingColor }} />
                        <div className="absolute bottom-2 right-2 h-3 w-12 rounded" style={{ backgroundColor: appearance.buttonBgColor }} />
                      </>
                    ) : (
                      <div className="flex h-full flex-col justify-center gap-1.5 px-2">
                        <span className="mx-auto h-1 w-10 rounded" style={{ backgroundColor: appearance.headingColor }} />
                        <div className="mx-auto w-3/4 rounded border border-border bg-card p-1">
                          <div className="aspect-[3.8/1] rounded opacity-60" style={{ background: `linear-gradient(120deg, ${appearance.primaryColor}, ${appearance.secondaryColor})` }} />
                          <span className="mx-auto mt-1 block h-1 w-1/2 rounded" style={{ backgroundColor: appearance.mutedTextColor || '#9ca3af' }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <span id={descriptionId} className="mt-2 block text-sm text-muted-foreground">
                    {t(`settings.visual.heroLayout.${layout}.description`)}
                  </span>
                </label>
              );
            })}
          </div>
          {!canChangeTheme && (
            <p className="mt-3 text-xs text-amber-800">{t('settings.visual.heroLayout.restricted')}</p>
          )}
          {heroLayoutPending && (
            <p data-testid="hero-layout-pending" role="status" className="mt-3 text-sm text-amber-800">
              {t('settings.visual.heroLayout.pending')}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {canChangeTheme && (
            <AlertDialog.Root open={resetOpen} onOpenChange={setResetOpen}>
              <AlertDialog.Trigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-3"
                  aria-label={t('settings.visual.restoreTheme')}
                >
                  <RefreshCw className="h-4 w-4 sm:mr-2" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('settings.visual.restoreTheme')}</span>
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
                <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 space-y-3">
                  <AlertDialog.Title className="text-lg font-semibold text-gray-900">{t('settings.visual.brand.reset.title')}</AlertDialog.Title>
                  <AlertDialog.Description className="text-sm text-gray-800">{t('settings.visual.brand.reset.description')}</AlertDialog.Description>
                  <div className="flex flex-wrap justify-end gap-2">
                    <AlertDialog.Cancel className="h-9 rounded-md border border-gray-400 bg-white px-3 text-sm text-gray-900 hover:bg-gray-50">
                      {t('settings.visual.brand.reset.cancel')}
                    </AlertDialog.Cancel>
                    <button
                      type="button"
                      onClick={handleRestoreTheme}
                      className="h-9 rounded-md bg-red-700 px-3 text-sm text-white hover:bg-red-800"
                    >
                      {t('settings.visual.brand.reset.confirm')}
                    </button>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          )}
          <Button onClick={handleAppearanceSave} style={getPrimaryButtonStyle(visualSettings)} className="h-9 px-3">
            <Save className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('settings.visual.saveCustomization')}</span>
          </Button>
        </div>
      </motion.div>

      {/* Carousel Slides Section */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-effect p-4 sm:p-8 rounded-2xl mt-8">
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

        {/* Carousel Configuration */}
        <div className="mb-6 p-3 sm:p-4 bg-gray-50 rounded-xl space-y-3 sm:space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{t('settings.visual.carouselSettings')}</h3>

          {/* Global enable toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={appearance.carouselEnabled}
              onChange={e => updateAppearance('carouselEnabled', e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-theme-link focus:ring-theme-focus"
            />
            <span className="text-sm font-medium">{t('settings.visual.carouselEnabled')}</span>
          </label>

          {/* Slide duration slider */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                {t('settings.visual.carouselAutoplaySpeed')}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={2000}
                  max={15000}
                  step={500}
                  value={appearance.carouselAutoplaySpeed}
                  onChange={e => updateAppearance('carouselAutoplaySpeed', parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-sm font-semibold text-gray-700 min-w-[3rem] text-right">
                  {(appearance.carouselAutoplaySpeed / 1000).toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Transition speed slider */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                {t('settings.visual.carouselTransitionSpeed')}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={300}
                  max={3000}
                  step={100}
                  value={appearance.carouselTransitionSpeed}
                  onChange={e => updateAppearance('carouselTransitionSpeed', parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-sm font-semibold text-gray-700 min-w-[3rem] text-right">
                  {(appearance.carouselTransitionSpeed / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Slides List */}
        {loadingSlides ? (
          <div className="text-center py-8 text-gray-500">
            {t('settings.visual.loadingSlides')}
          </div>
        ) : carouselSlides.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {t('settings.visual.noSlides')}
          </div>
        ) : (
          <div className="space-y-3">
            {carouselSlides.map((slide, idx) => {
              const isExpanded = expandedSlide === slide.id;
              const slideTitle = (language === 'es' ? slide.title_es : slide.title_en) || slide.title_es || slide.title_en || '—';

              return (
                <div
                  key={slide.id}
                  id={`slide-${slide.id}`}
                  className={`border rounded-xl overflow-hidden transition-all ${
                    slide.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-60'
                  }`}
                >
                  {/* Summary Row — always visible */}
                  <div
                    className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedSlide(isExpanded ? null : slide.id)}
                  >
                    {/* Thumbnail */}
                    <div className="w-10 h-6 sm:w-16 sm:h-9 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                      {(slidePreviews[slide.id] || slide.image_url) ? (
                        <img
                          src={slidePreviews[slide.id] || slide.image_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image className="h-4 w-4 text-gray-300" />
                        </div>
                      )}
                    </div>

                    {/* Title + Order */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-400">#{slide.display_order ?? idx}</span>
                        <span className="text-sm font-medium truncate">{slideTitle}</span>
                      </div>
                    </div>

                    {/* Save indicators */}
                    {savingSlide === slide.id && (
                      <RefreshCw className="h-4 w-4 animate-spin text-theme-focus flex-shrink-0" />
                    )}
                    {savedSlide === slide.id && savingSlide !== slide.id && (
                      <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    )}

                    {/* Active toggle */}
                    <label
                      className="flex items-center gap-1.5 cursor-pointer flex-shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={slide.is_active}
                        onChange={() => handleToggleSlideActive(slide.id, slide.is_active)}
                        className="w-4 h-4 rounded border-gray-300 text-theme-link focus:ring-theme-focus"
                      />
                      <span className={`hidden sm:inline text-xs font-medium ${slide.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                        {slide.is_active ? t('settings.visual.slideActive') : t('settings.visual.slideInactive')}
                      </span>
                    </label>

                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-gray-400 hover:text-red-500 flex-shrink-0"
                      onClick={e => { e.stopPropagation(); handleRemoveSlide(slide.id); }}
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>

                    {/* Expand indicator */}
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    }
                  </div>

                  {/* Expanded Edit Form */}
                  {isExpanded && (
                    <div className="p-3 sm:p-4 border-t bg-white space-y-3 sm:space-y-4">
                      {/* Order + Link URL */}
                      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.visual.order')}</label>
                          <input
                            type="number"
                            value={slide.display_order ?? 0}
                            onChange={e => handleSlideOrderChange(slide.id, e.target.value)}
                            className="input-style w-full"
                            min="0"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.visual.linkUrl')}</label>
                          <input
                            type="url"
                            value={slide.link_url || ''}
                            onChange={e => handleSlideChange(slide.id, { link_url: e.target.value })}
                            placeholder="https://..."
                            className="input-style w-full"
                          />
                        </div>
                      </div>

                      {/* Image preview */}
                      {(slide.image_url || slidePreviews[slide.id]) && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1">{t('settings.visual.preview')}</p>
                          <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border-2 border-gray-300 bg-gray-100">
                            <img
                              src={slidePreviews[slide.id] || slide.image_url}
                              alt={t('settings.visual.preview')}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        </div>
                      )}

                      {/* Image URL + file upload */}
                      <div>
                        <label className="block text-sm font-medium mb-1">{t('settings.visual.image')}</label>
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
                          className="w-full text-sm text-gray-500 file:mr-4 file:py-1 file:px-3 sm:file:py-2 sm:file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-theme-accent-soft file:text-theme-link-strong hover:file:bg-theme-accent-soft-2"
                        />
                      </div>

                      {/* Title ES/EN */}
                      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.visual.mainText')} (ES)</label>
                          <input
                            type="text"
                            value={slide.title_es || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'title_es', e.target.value)}
                            placeholder={t('settings.visual.placeholderTitleEs')}
                            className="input-style w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.visual.mainText')} (EN)</label>
                          <input
                            type="text"
                            value={slide.title_en || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'title_en', e.target.value)}
                            placeholder={t('settings.visual.placeholderTitleEn')}
                            className="input-style w-full"
                          />
                        </div>
                      </div>

                      {/* Subtitle ES/EN */}
                      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.visual.secondaryText')} (ES)</label>
                          <input
                            type="text"
                            value={slide.subtitle_es || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'subtitle_es', e.target.value)}
                            placeholder={t('settings.visual.placeholderSubtitleEs')}
                            className="input-style w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.visual.secondaryText')} (EN)</label>
                          <input
                            type="text"
                            value={slide.subtitle_en || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'subtitle_en', e.target.value)}
                            placeholder={t('settings.visual.placeholderSubtitleEn')}
                            className="input-style w-full"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </>
  );
};

export default SettingsPageVisual;
