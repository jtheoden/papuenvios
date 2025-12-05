import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Palette, Upload, Plus, Trash2, Check, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import {
  getCarouselSlides, createCarouselSlide, updateCarouselSlide,
  hardDeleteCarouselSlide
} from '@/lib/carouselService';

const SettingsPageVisual = ({ localVisual, setLocalVisual, visualSettings, setVisualSettings }) => {
  const { t, language } = useLanguage();

  const [appearance, setAppearance] = useState({
    companyName: visualSettings.companyName || 'PapuEnvíos',
    logo: visualSettings.logo || '',
    primaryColor: visualSettings.primaryColor || '#2563eb',
    secondaryColor: visualSettings.secondaryColor || '#9333ea',
    useGradient: visualSettings.useGradient !== undefined ? visualSettings.useGradient : true,
    headerBgColor: visualSettings.headerBgColor || '#ffffff',
    headerTextColor: visualSettings.headerTextColor || '#1f2937',
    headingColor: visualSettings.headingColor || '#1f2937',
    useHeadingGradient: visualSettings.useHeadingGradient !== undefined ? visualSettings.useHeadingGradient : true,
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

  // ===== APPEARANCE HANDLERS =====
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateAndProcessImage(file, 'logo');
      if (!result.success) {
        toast({
          title: language === 'es' ? 'Error de validación' : 'Validation error',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      setLogoPreview(result.base64);
      setAppearance(prev => ({ ...prev, logo: result.base64 }));

      toast({
        title: language === 'es' ? 'Logo cargado' : 'Logo uploaded',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions}`,
      });
    } catch (error) {
      console.error('Error processing logo:', error);
      toast({
        title: language === 'es' ? 'Error al procesar imagen' : 'Error processing image',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleAppearanceSave = () => {
    setVisualSettings({
      ...visualSettings,
      ...appearance
    });
    document.title = appearance.companyName;
    toast({ title: t('settings.saveSuccess') });
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
        title: language === 'es' ? 'Diapositiva creada' : 'Slide created'
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
    if (!confirm(language === 'es' ? '¿Eliminar esta diapositiva?' : 'Delete this slide?')) {
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
        title: language === 'es' ? 'Diapositiva eliminada' : 'Slide deleted'
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
        <h2 className="text-2xl font-semibold mb-6 flex items-center">
          <Palette className="mr-3 text-purple-600" />
          {t('settings.visual.appearance')}
        </h2>

        {/* Logo Upload */}
        <div className="mb-8">
          <label className="block text-sm font-medium mb-2">{t('settings.visual.logo')}</label>
          {logoPreview && (
            <div className="mb-4">
              <img src={logoPreview} alt="Logo preview" className="h-16 w-auto" />
            </div>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              <Upload className="h-4 w-4" />
              {language === 'es' ? 'Subir Logo' : 'Upload Logo'}
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
            </label>
          </div>
        </div>

        {/* Company Name */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">{t('settings.visual.companyName')}</label>
          <input
            type="text"
            value={appearance.companyName}
            onChange={e => setAppearance({ ...appearance, companyName: e.target.value })}
            className="input-style w-full md:w-1/2"
          />
        </div>

        {/* Colors Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {[
            { key: 'primaryColor', label: t('settings.visual.primaryColor') },
            { key: 'secondaryColor', label: t('settings.visual.secondaryColor') },
            { key: 'accentColor', label: t('settings.visual.accentColor') },
            { key: 'buttonBgColor', label: t('settings.visual.buttonColor') },
            { key: 'destructiveBgColor', label: t('settings.visual.destructiveColor') },
            { key: 'pageBgColor', label: t('settings.visual.pageBackground') },
            { key: 'cardBgColor', label: t('settings.visual.cardBackground') },
            { key: 'headerBgColor', label: t('settings.visual.headerBgColor') },
            { key: 'headingColor', label: t('settings.visual.headingColor') }
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-2">{label}</label>
              <input
                type="color"
                value={appearance[key]}
                onChange={e => setAppearance({ ...appearance, [key]: e.target.value })}
                className="w-full h-10 rounded-lg cursor-pointer border border-gray-300"
              />
            </div>
          ))}
        </div>

        {/* Toggles */}
        <div className="space-y-3 mb-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={appearance.useGradient}
              onChange={e => setAppearance({ ...appearance, useGradient: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm font-medium">{t('settings.visual.useGradient')}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={appearance.useHeadingGradient}
              onChange={e => setAppearance({ ...appearance, useHeadingGradient: e.target.checked })}
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
            {language === 'es' ? 'Botón Principal' : 'Primary Button'}
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
            {language === 'es' ? 'Botón Eliminar' : 'Delete Button'}
          </div>
          <div className="flex gap-4 flex-wrap items-center">
            <div
              className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: `${appearance.accentColor}20`,
                color: appearance.accentColor
              }}
            >
              {language === 'es' ? 'Badge' : 'Badge'}
            </div>
          </div>
        </div>

        <div className="text-right">
          <Button onClick={handleAppearanceSave} style={getPrimaryButtonStyle(visualSettings)}>
            <Save className="mr-2 h-4 w-4" />
            {language === 'es' ? 'Guardar Personalización' : 'Save Customization'}
          </Button>
        </div>
      </motion.div>

      {/* Carousel Slides Section */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-effect p-8 rounded-2xl mt-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">{t('settings.visual.slides')}</h2>
          <Button onClick={handleAddSlide} style={getPrimaryButtonStyle(visualSettings)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('settings.visual.addSlide')}
          </Button>
        </div>

        {loadingSlides ? (
          <div className="text-center py-8 text-gray-500">
            {language === 'es' ? 'Cargando diapositivas...' : 'Loading slides...'}
          </div>
        ) : carouselSlides.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {language === 'es' ? 'No hay diapositivas. Agrega una para comenzar.' : 'No slides. Add one to get started.'}
          </div>
        ) : (
          <div className="space-y-4">
            {carouselSlides.map(slide => (
              <div key={slide.id} className="p-4 border rounded-lg space-y-3">
                {savingSlide === slide.id && (
                  <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-2 rounded">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>{language === 'es' ? 'Guardando...' : 'Saving...'}</span>
                  </div>
                )}
                {savedSlide === slide.id && savingSlide !== slide.id && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 p-2 rounded">
                    <Check className="h-4 w-4" />
                    <span>{language === 'es' ? 'Guardado ✓' : 'Saved ✓'}</span>
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
                      {language === 'es' ? 'Vista Previa:' : 'Preview:'}
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
                    onClick={() => handleRemoveSlide(slide.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {language === 'es' ? 'Eliminar' : 'Delete'}
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
