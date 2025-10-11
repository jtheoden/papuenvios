import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Image as ImageIcon, Bell, Save, Plus, Trash2, Upload, Link, Edit, RefreshCw, Check, Palette, ShoppingBag, MapPin, Truck, Banknote, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { getCurrencies, createCurrency, updateCurrency, deleteCurrency, fetchOfficialRates, getAllExchangeRates, saveExchangeRate, deleteExchangeRate } from '@/lib/currencyService';
import { getCarouselSlides, createCarouselSlide, updateCarouselSlide, hardDeleteCarouselSlide, reorderSlides } from '@/lib/carouselService';
import { getAllShippingZones, updateShippingZone, createShippingZone } from '@/lib/shippingService';
import { getProvinceNames } from '@/lib/cubanLocations';
import { getRemittanceConfigs, saveRemittanceConfig } from '@/lib/remittanceService';
import { supabase } from '@/lib/supabase';

const SettingsPage = () => {
  const { t, language } = useLanguage();
  const {
    financialSettings, setFinancialSettings,
    notificationSettings, setNotificationSettings,
    visualSettings, setVisualSettings,
    zelleAccounts, setZelleAccounts
  } = useBusiness();
  const { user, isAdmin } = useAuth();

  // Tab management
  const [activeTab, setActiveTab] = useState('financiero');

  const [localFinancial, setLocalFinancial] = useState(financialSettings);
  const [localNotifications, setLocalNotifications] = useState(notificationSettings);
  const [localVisual, setLocalVisual] = useState(visualSettings);

  // Appearance customization state
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

  // Currencies state
  const [currencies, setCurrencies] = useState([]);
  const [editingCurrency, setEditingCurrency] = useState(null);
  const [officialRates, setOfficialRates] = useState(null);
  const [loadingRates, setLoadingRates] = useState(false);
  const [currencyForm, setCurrencyForm] = useState({
    code: '',
    name_es: '',
    name_en: '',
    symbol: '',
    is_base: false
  });

  const [slidePreviews, setSlidePreviews] = useState({});
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [savingSlide, setSavingSlide] = useState(null); // ID of slide being saved
  const [savedSlide, setSavedSlide] = useState(null); // ID of slide just saved
  const [slideDebounceTimers, setSlideDebounceTimers] = useState({}); // Debounce timers for text inputs

  // Shipping zones state
  const [shippingZones, setShippingZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [savingZone, setSavingZone] = useState(null);

  // Remittance configurations state
  const [remittanceConfigs, setRemittanceConfigs] = useState([]);
  const [loadingRemittances, setLoadingRemittances] = useState(false);
  const [savingRemittance, setSavingRemittance] = useState(null);

  // Exchange rates state
  const [exchangeRates, setExchangeRates] = useState([]);
  const [loadingRates2, setLoadingRates2] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [newRate, setNewRate] = useState({
    fromCurrencyId: '',
    toCurrencyId: '',
    rate: '',
    effectiveDate: new Date().toISOString().split('T')[0]
  });

  // Load currencies and official rates on mount
  useEffect(() => {
    loadCurrencies();
    loadOfficialRates();
    loadCarouselSlides();
    loadShippingZones();
    loadRemittanceConfigs();
    loadExchangeRates();
  }, []);

  // Load official exchange rates
  const loadOfficialRates = async () => {
    setLoadingRates(true);
    try {
      const { data, error } = await fetchOfficialRates();
      if (error) throw error;
      setOfficialRates(data);
    } catch (error) {
      console.error('Error loading official rates:', error);
    } finally {
      setLoadingRates(false);
    }
  };

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center py-8 px-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-effect p-8 rounded-2xl max-w-md w-full text-center">
          <h2 className="text-2xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>{t('dashboard.privateAccess')}</h2>
          <p className="text-gray-600">{t('dashboard.adminOnly')}</p>
        </motion.div>
      </div>
    );
  }

  // Load currencies from database
  const loadCurrencies = async () => {
    try {
      const { data, error } = await getCurrencies();
      if (error) throw error;
      setCurrencies(data || []);
    } catch (error) {
      console.error('Error loading currencies:', error);
      toast({
        title: 'Error',
        description: language === 'es'
          ? 'Error al cargar monedas'
          : 'Error loading currencies',
        variant: 'destructive'
      });
    }
  };

  const handleFinancialSave = () => {
    setFinancialSettings(localFinancial);
    toast({ title: t('settings.saveSuccess') });
  };

  // Handle currency form submission (create or update)
  const handleCurrencySubmit = async () => {
    if (!currencyForm.code || !currencyForm.name_es || !currencyForm.name_en || !currencyForm.symbol) {
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: language === 'es'
          ? 'Por favor complete todos los campos'
          : 'Please fill all fields',
        variant: 'destructive'
      });
      return;
    }

    try {
      const { supabase } = await import('@/lib/supabase');

      // If setting as base currency, unset any previous base currency
      if (currencyForm.is_base) {
        await supabase.from('currencies')
          .update({ is_base: false })
          .eq('is_base', true)
          .neq('id', editingCurrency?.id || '00000000-0000-0000-0000-000000000000');
      }

      let savedCurrency;
      if (editingCurrency) {
        // Update existing currency
        const { data, error } = await updateCurrency(editingCurrency.id, currencyForm);
        if (error) throw error;
        savedCurrency = data;

        toast({
          title: language === 'es' ? 'Moneda actualizada' : 'Currency Updated',
          description: language === 'es'
            ? 'La moneda se actualizó exitosamente'
            : 'Currency was updated successfully'
        });
      } else {
        // Create new currency
        const { data, error } = await createCurrency(currencyForm);
        if (error) throw error;
        savedCurrency = data;

        toast({
          title: language === 'es' ? 'Moneda creada' : 'Currency Created',
          description: language === 'es'
            ? 'La moneda se creó exitosamente'
            : 'Currency was created successfully'
        });
      }

      // Reset form and reload
      setCurrencyForm({ code: '', name_es: '', name_en: '', symbol: '', is_base: false });
      setEditingCurrency(null);
      await loadCurrencies();
    } catch (error) {
      console.error('Error saving currency:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleEditCurrency = async (currency) => {
    setEditingCurrency(currency);
    setCurrencyForm({
      code: currency.code,
      name_es: currency.name_es,
      name_en: currency.name_en,
      symbol: currency.symbol,
      is_base: currency.is_base || false
    });
  };

  const handleRemoveCurrency = async (currencyId) => {
    const confirmMessage = language === 'es'
      ? '¿Está seguro de que desea eliminar esta moneda? Esto también eliminará sus tasas de cambio.'
      : 'Are you sure you want to delete this currency? This will also remove its exchange rates.';

    if (!confirm(confirmMessage)) return;

    try {
      // First, deactivate all exchange rates for this currency
      await supabase.from('exchange_rates')
        .update({ is_active: false })
        .or(`from_currency_id.eq.${currencyId},to_currency_id.eq.${currencyId}`);

      // Then delete the currency (soft delete)
      const { error } = await deleteCurrency(currencyId);
      if (error) throw error;

      toast({
        title: language === 'es' ? 'Moneda eliminada' : 'Currency Deleted',
        description: language === 'es'
          ? 'La moneda y sus tasas de cambio se eliminaron exitosamente'
          : 'Currency and its exchange rates were deleted successfully'
      });

      await loadCurrencies();
    } catch (error) {
      console.error('Error deleting currency:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingCurrency(null);
    setCurrencyForm({ code: '', name_es: '', name_en: '', symbol: '', is_base: false });
  };

  const handleNotificationSave = () => {
    setNotificationSettings(localNotifications);
    toast({ title: t('settings.saveSuccess') });
  };

  // Shipping zones functions
  const loadShippingZones = async () => {
    setLoadingZones(true);
    try {
      const result = await getAllShippingZones();
      if (result.success) {
        // Ensure all Cuban provinces are represented
        const provinceNames = getProvinceNames();
        const existingProvinces = result.zones.map(z => z.province_name);
        const missingProvinces = provinceNames.filter(p => !existingProvinces.includes(p));

        // Add missing provinces with 0 cost
        const allZones = [
          ...result.zones,
          ...missingProvinces.map(name => ({
            id: `temp-${name}`,
            province_name: name,
            shipping_cost: 0,
            is_active: false,
            free_shipping: false,
            is_new: true
          }))
        ];

        setShippingZones(allZones.sort((a, b) => a.province_name.localeCompare(b.province_name)));
      }
    } catch (error) {
      console.error('Error loading shipping zones:', error);
      toast({
        title: language === 'es' ? 'Error al cargar zonas' : 'Error loading zones',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoadingZones(false);
    }
  };

  const handleShippingZoneUpdate = async (zoneId, updates) => {
    setSavingZone(zoneId);
    try {
      const zone = shippingZones.find(z => z.id === zoneId);

      if (zone.is_new) {
        // Create new zone
        const result = await createShippingZone({
          provinceName: zone.province_name,
          shippingCost: updates.shipping_cost ?? zone.shipping_cost,
          isActive: updates.is_active ?? zone.is_active ?? true,
          freeShipping: updates.free_shipping ?? zone.free_shipping ?? false
        });

        if (result.success) {
          // Reload zones to get the real ID
          await loadShippingZones();
          toast({
            title: language === 'es' ? '✅ Zona creada' : '✅ Zone created'
          });
        }
      } else {
        // Update existing zone
        const result = await updateShippingZone(zoneId, {
          shippingCost: updates.shipping_cost,
          isActive: updates.is_active,
          freeShipping: updates.free_shipping
        });

        if (result.success) {
          setShippingZones(prev =>
            prev.map(z => z.id === zoneId ? { ...z, ...updates } : z)
          );
          toast({
            title: language === 'es' ? '✅ Zona actualizada' : '✅ Zone updated'
          });
        }
      }
    } catch (error) {
      console.error('Error updating shipping zone:', error);
      toast({
        title: language === 'es' ? 'Error al guardar' : 'Save error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSavingZone(null);
    }
  };

  // Remittance configuration functions
  const loadRemittanceConfigs = async () => {
    setLoadingRemittances(true);
    try {
      const result = await getRemittanceConfigs();
      if (result.success) {
        setRemittanceConfigs(result.configs);
      }
    } catch (error) {
      console.error('Error loading remittance configs:', error);
      toast({
        title: language === 'es' ? 'Error al cargar configuración' : 'Error loading config',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoadingRemittances(false);
    }
  };

  const handleRemittanceConfigUpdate = async (configId, updates) => {
    setSavingRemittance(configId);
    try {
      const config = remittanceConfigs.find(c => c.id === configId);
      const updatedConfig = { ...config, ...updates };

      const result = await saveRemittanceConfig(updatedConfig);

      if (result.success) {
        await loadRemittanceConfigs();
        toast({
          title: language === 'es' ? '✅ Configuración guardada' : '✅ Configuration saved'
        });
      }
    } catch (error) {
      console.error('Error updating remittance config:', error);
      toast({
        title: language === 'es' ? 'Error al guardar' : 'Save error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSavingRemittance(null);
    }
  };

  const togglePaymentMethod = async (configId, methodId) => {
    const config = remittanceConfigs.find(c => c.id === configId);
    const updatedMethods = config.paymentMethods.map(m =>
      m.id === methodId ? { ...m, enabled: !m.enabled } : m
    );

    await handleRemittanceConfigUpdate(configId, {
      paymentMethods: updatedMethods
    });
  };

  // Exchange Rates functions
  const loadExchangeRates = async () => {
    setLoadingRates2(true);
    try {
      const { data, error } = await getAllExchangeRates();
      if (!error && data) {
        setExchangeRates(data);
      }
    } catch (error) {
      console.error('Error loading exchange rates:', error);
    } finally {
      setLoadingRates2(false);
    }
  };

  const handleSaveRate = async () => {
    if (!newRate.fromCurrencyId || !newRate.toCurrencyId || !newRate.rate) {
      toast({
        title: language === 'es' ? 'Datos incompletos' : 'Incomplete data',
        description: language === 'es'
          ? 'Por favor complete todos los campos'
          : 'Please fill all fields',
        variant: 'destructive'
      });
      return;
    }

    if (newRate.fromCurrencyId === newRate.toCurrencyId) {
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: language === 'es'
          ? 'Las monedas deben ser diferentes'
          : 'Currencies must be different',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Save direct rate (from -> to)
      const result = await saveExchangeRate(newRate);
      if (result.error) throw result.error;

      // Save inverse rate (to -> from)
      const inverseRate = {
        fromCurrencyId: newRate.toCurrencyId,
        toCurrencyId: newRate.fromCurrencyId,
        rate: (1 / parseFloat(newRate.rate)).toString(),
        effectiveDate: newRate.effectiveDate
      };
      const inverseResult = await saveExchangeRate(inverseRate);
      if (inverseResult.error) throw inverseResult.error;

      await loadExchangeRates();
      setShowAddRate(false);
      setNewRate({
        fromCurrencyId: '',
        toCurrencyId: '',
        rate: '',
        effectiveDate: new Date().toISOString().split('T')[0]
      });

      toast({
        title: language === 'es' ? '✅ Tasas guardadas' : '✅ Rates saved',
        description: language === 'es'
          ? 'La tasa de cambio y su inversa se guardaron correctamente'
          : 'Exchange rate and its inverse saved successfully'
      });
    } catch (error) {
      console.error('Error saving rate:', error);
      toast({
        title: language === 'es' ? 'Error al guardar' : 'Save error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteRate = async (rateId) => {
    if (!confirm(language === 'es' ? '¿Eliminar esta tasa?' : 'Delete this rate?')) {
      return;
    }

    try {
      const result = await deleteExchangeRate(rateId);
      if (result.error) throw result.error;

      await loadExchangeRates();
      toast({
        title: language === 'es' ? '✅ Tasa eliminada' : '✅ Rate deleted'
      });
    } catch (error) {
      console.error('Error deleting rate:', error);
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleVisualSave = async () => {
    setVisualSettings(localVisual);
    toast({ title: t('settings.saveSuccess') });
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Validate and process logo image
      const result = await validateAndProcessImage(file, 'logo');

      if (!result.success) {
        toast({
          title: language === 'es' ? 'Error de validación' : 'Validation error',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      // Update logo preview and appearance state
      setLogoPreview(result.base64);
      setAppearance(prev => ({ ...prev, logo: result.base64 }));

      toast({
        title: language === 'es' ? 'Logo cargado' : 'Logo uploaded',
        description: language === 'es'
          ? `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions}`
          : `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions}`,
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

    // Update document title
    document.title = appearance.companyName;

    toast({
      title: t('settings.saveSuccess'),
      description: language === 'es'
        ? 'Personalización guardada. Recarga la página para ver todos los cambios.'
        : 'Customization saved. Reload the page to see all changes.'
    });
  };

  // Load carousel slides from database
  const loadCarouselSlides = async () => {
    setLoadingSlides(true);
    try {
      const { data, error } = await getCarouselSlides();
      if (error) throw error;
      setCarouselSlides(data || []);
    } catch (error) {
      console.error('Error loading carousel slides:', error);
      toast({
        title: 'Error al cargar diapositivas',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoadingSlides(false);
    }
  };

  // Create new slide
  const handleAddSlide = async () => {
    try {
      const { data, error } = await createCarouselSlide({
        title_es: '',
        title_en: '',
        subtitle_es: '',
        subtitle_en: '',
        image_url: '',
        link_url: '',
        is_active: false
      });

      if (error) throw error;

      await loadCarouselSlides();
      toast({
        title: language === 'es' ? 'Diapositiva creada' : 'Slide created',
        description: language === 'es' ? 'Nueva diapositiva agregada exitosamente' : 'New slide added successfully'
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

  // Update slide field (immediate for non-text fields)
  const handleSlideChange = async (id, updates) => {
    try {
      setSavingSlide(id);
      setSavedSlide(null);

      const { error } = await updateCarouselSlide(id, updates);
      if (error) throw error;

      // Update local state optimistically
      setCarouselSlides(prev =>
        prev.map(slide => (slide.id === id ? { ...slide, ...updates } : slide))
      );

      // Show saved indicator
      setSavingSlide(null);
      setSavedSlide(id);
      setTimeout(() => setSavedSlide(null), 1500);
    } catch (error) {
      console.error('Error updating slide:', error);
      setSavingSlide(null);
      toast({
        title: 'Error al actualizar',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // Debounced update for text fields to prevent cursor jumping
  const handleSlideTextChange = (id, field, value) => {
    // Update local state immediately for responsive UI
    setCarouselSlides(prev =>
      prev.map(slide => (slide.id === id ? { ...slide, [field]: value } : slide))
    );

    // Clear existing timer for this slide
    if (slideDebounceTimers[id]) {
      clearTimeout(slideDebounceTimers[id]);
    }

    // Set new timer to save after user stops typing
    const timer = setTimeout(() => {
      handleSlideChange(id, { [field]: value });
    }, 800);

    setSlideDebounceTimers(prev => ({ ...prev, [id]: timer }));
  };

  // Delete slide
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
        title: language === 'es' ? 'Diapositiva eliminada' : 'Slide deleted',
        description: language === 'es' ? 'La diapositiva fue eliminada exitosamente' : 'Slide was deleted successfully'
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

  // Update slide order
  const handleSlideOrderChange = async (id, newOrder) => {
    try {
      setSavingSlide(id);
      setSavedSlide(null);

      const { error } = await updateCarouselSlide(id, { display_order: parseInt(newOrder) });
      if (error) throw error;

      // Update local state optimistically
      setCarouselSlides(prev =>
        prev.map(slide => (slide.id === id ? { ...slide, display_order: parseInt(newOrder) } : slide))
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      );

      // Show saved indicator
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
      // Validate and process image
      const result = await validateAndProcessImage(file, 'carousel');

      if (!result.success) {
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      // Update slide image in database
      await handleSlideChange(slideId, { image_url: result.base64 });
      setSlidePreviews(prev => ({ ...prev, [slideId]: result.base64 }));

      toast({
        title: 'Imagen optimizada',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions} (${result.metadata.compression} compresión)`,
      });
    } catch (error) {
      console.error('Error processing slide image:', error);
      toast({
        title: 'Error al procesar imagen',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const tabs = [
    {
      id: 'financiero',
      label: language === 'es' ? 'Financiero' : 'Financial',
      icon: DollarSign,
      color: '#2563eb'
    },
    {
      id: 'envios',
      label: language === 'es' ? 'Envíos' : 'Shipping',
      icon: Truck,
      color: '#f59e0b'
    },
    {
      id: 'remesas',
      label: language === 'es' ? 'Remesas' : 'Remittances',
      icon: Banknote,
      color: '#06b6d4'
    },
    {
      id: 'visual',
      label: language === 'es' ? 'Visual' : 'Visual',
      icon: Palette,
      color: '#9333ea'
    },
    {
      id: 'contenido',
      label: language === 'es' ? 'Contenido' : 'Content',
      icon: Bell,
      color: '#10b981'
    }
  ];

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-7xl">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>{t('settings.title')}</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">{t('settings.subtitle')}</p>
        </motion.div>

        {/* Tabs Navigation */}
        <div className="flex gap-2 mb-8 border-b pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-t-lg font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white shadow-md border-b-2'
                  : 'bg-gray-50 hover:bg-gray-100 text-gray-600'
              }`}
              style={activeTab === tab.id ? {
                borderBottomColor: tab.color,
                color: tab.color
              } : {}}
            >
              <tab.icon className="h-5 w-5" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-12">
          {/* FINANCIERO TAB */}
          {activeTab === 'financiero' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center"><DollarSign className="mr-3 text-blue-600" />{t('settings.financial.title')}</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <input type="number" value={localFinancial.usdToLocal} onChange={e => setLocalFinancial({...localFinancial, usdToLocal: parseFloat(e.target.value)})} placeholder={t('settings.financial.usdToLocal')} className="input-style" />
              <input type="number" value={localFinancial.productProfit} onChange={e => setLocalFinancial({...localFinancial, productProfit: parseFloat(e.target.value)})} placeholder={t('settings.financial.productProfit')} className="input-style" />
              <input type="number" value={localFinancial.comboProfit} onChange={e => setLocalFinancial({...localFinancial, comboProfit: parseFloat(e.target.value)})} placeholder={t('settings.financial.comboProfit')} className="input-style" />
              <input type="number" value={localFinancial.remittanceProfit} onChange={e => setLocalFinancial({...localFinancial, remittanceProfit: parseFloat(e.target.value)})} placeholder={t('settings.financial.remittanceProfit')} className="input-style" />
            </div>

            {/* Shipping Configuration */}
            <div className="border-t pt-6 mb-6">
              <h3 className="text-xl font-semibold mb-4">
                {language === 'es' ? 'Configuración de Envío' : 'Shipping Configuration'}
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {language === 'es' ? 'Tipo de Envío' : 'Shipping Type'}
                  </label>
                  <select
                    value={localFinancial.shippingType || 'undetermined'}
                    onChange={e => setLocalFinancial({...localFinancial, shippingType: e.target.value})}
                    className="input-style w-full"
                  >
                    <option value="free">
                      {language === 'es' ? 'Gratis' : 'Free'}
                    </option>
                    <option value="fixed">
                      {language === 'es' ? 'Tarifa Fija' : 'Fixed Rate'}
                    </option>
                    <option value="undetermined">
                      {language === 'es' ? 'Por Determinar (según ubicación)' : 'To Be Determined (based on location)'}
                    </option>
                    <option value="calculated">
                      {language === 'es' ? 'Calculado (con umbral gratis)' : 'Calculated (with free threshold)'}
                    </option>
                  </select>
                </div>

                {localFinancial.shippingType === 'fixed' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {language === 'es' ? 'Costo Fijo de Envío ($)' : 'Fixed Shipping Cost ($)'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={localFinancial.shippingFixedAmount || 0}
                      onChange={e => setLocalFinancial({...localFinancial, shippingFixedAmount: parseFloat(e.target.value)})}
                      placeholder="0.00"
                      className="input-style w-full"
                    />
                  </div>
                )}

                {(localFinancial.shippingType === 'calculated' || localFinancial.shippingType === 'undetermined') && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {language === 'es' ? 'Umbral para Envío Gratis ($)' : 'Free Shipping Threshold ($)'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={localFinancial.shippingFreeThreshold || 100}
                      onChange={e => setLocalFinancial({...localFinancial, shippingFreeThreshold: parseFloat(e.target.value)})}
                      placeholder="100.00"
                      className="input-style w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {language === 'es'
                        ? 'Pedidos superiores a este monto tendrán envío gratis'
                        : 'Orders above this amount will have free shipping'}
                    </p>
                  </div>
                )}
              </div>

              {/* Shipping Type Explanation */}
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-gray-700">
                  {localFinancial.shippingType === 'free' && (
                    language === 'es'
                      ? '✓ Envío gratis: No se cobrará envío en ningún pedido'
                      : '✓ Free shipping: No shipping charge on any order'
                  )}
                  {localFinancial.shippingType === 'fixed' && (
                    language === 'es'
                      ? '✓ Tarifa fija: Se cobrará el mismo monto de envío en todos los pedidos'
                      : '✓ Fixed rate: Same shipping amount will be charged on all orders'
                  )}
                  {localFinancial.shippingType === 'undetermined' && (
                    language === 'es'
                      ? '⚠ Por determinar: El costo de envío se mostrará como "Por determinar" y se calculará según la ubicación del destinatario'
                      : '⚠ To be determined: Shipping cost will show as "To be determined" and will be calculated based on recipient location'
                  )}
                  {localFinancial.shippingType === 'calculated' && (
                    language === 'es'
                      ? '⚠ Calculado: Envío gratis si el pedido supera el umbral, de lo contrario se determinará según ubicación'
                      : '⚠ Calculated: Free shipping if order exceeds threshold, otherwise determined by location'
                  )}
                </p>
              </div>
            </div>

            <div className="border-t pt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">{t('settings.financial.currencies')}</h3>
                <Button
                  onClick={loadOfficialRates}
                  disabled={loadingRates}
                  variant="outline"
                  size="sm"
                >
                  <DollarSign className="w-4 h-4 mr-2" />
                  {loadingRates
                    ? (language === 'es' ? 'Cargando...' : 'Loading...')
                    : (language === 'es' ? 'Cargar Tasas Oficiales' : 'Load Official Rates')
                  }
                </Button>
              </div>

              {/* Official Rates Display */}
              {officialRates && (
                <div className="bg-green-50 p-4 rounded-lg mb-4">
                  <h4 className="font-semibold text-green-800 mb-2">
                    {language === 'es' ? 'Tasas Oficiales (Referencia)' : 'Official Rates (Reference)'}
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
                    {Object.entries(officialRates).map(([code, rate]) => (
                      <div key={code} className="bg-white p-2 rounded flex justify-between">
                        <span className="font-bold">{code}:</span>
                        <span className="font-mono">{Number(rate).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    {language === 'es'
                      ? 'Tasas de referencia. Configure las tasas de cambio en la sección de Exchange Rates.'
                      : 'Reference rates. Configure exchange rates in the Exchange Rates section.'}
                  </p>
                </div>
              )}

              {/* Currency List */}
              <div className="space-y-2 mb-6">
                {currencies.map(currency => (
                  <div key={currency.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <span className="font-bold w-16">{currency.code}</span>
                    <span className="flex-1">{language === 'es' ? currency.name_es : currency.name_en}</span>
                    <span className="w-12 text-center">{currency.symbol}</span>
                    {currency.is_base && (
                      <span
                        className="text-xs text-white px-2 py-1 rounded font-semibold"
                        style={{
                          background: visualSettings.useGradient
                            ? `linear-gradient(to right, ${visualSettings.primaryColor}, ${visualSettings.secondaryColor})`
                            : visualSettings.primaryColor
                        }}
                      >
                        {language === 'es' ? 'Base' : 'Base'}
                      </span>
                    )}
                    <div className="flex gap-1">
                      <Button variant="outline" size="icon" onClick={() => handleEditCurrency(currency)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="destructive" size="icon" onClick={() => handleRemoveCurrency(currency.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Currency Form */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="text-lg font-semibold mb-3">
                  {editingCurrency
                    ? (language === 'es' ? 'Editar Moneda' : 'Edit Currency')
                    : (language === 'es' ? 'Nueva Moneda' : 'New Currency')
                  }
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.financial.code')}
                    </label>
                    <input
                      value={currencyForm.code}
                      onChange={e => setCurrencyForm({...currencyForm, code: e.target.value.toUpperCase()})}
                      placeholder="USD"
                      className="input-style w-full"
                      maxLength={3}
                      disabled={editingCurrency !== null}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.financial.nameES')}
                    </label>
                    <input
                      value={currencyForm.name_es}
                      onChange={e => setCurrencyForm({...currencyForm, name_es: e.target.value})}
                      placeholder="Dólar"
                      className="input-style w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.financial.nameEN')}
                    </label>
                    <input
                      value={currencyForm.name_en}
                      onChange={e => setCurrencyForm({...currencyForm, name_en: e.target.value})}
                      placeholder="Dollar"
                      className="input-style w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.financial.symbol')}
                    </label>
                    <input
                      value={currencyForm.symbol}
                      onChange={e => setCurrencyForm({...currencyForm, symbol: e.target.value})}
                      placeholder="$"
                      className="input-style w-full"
                      maxLength={3}
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={currencyForm.is_base}
                      onChange={e => setCurrencyForm({...currencyForm, is_base: e.target.checked})}
                      className="rounded"
                    />
                    <span className="text-sm font-medium">
                      {language === 'es' ? 'Moneda Base' : 'Base Currency'}
                    </span>
                  </label>
                  <p className="text-xs text-gray-600 mt-1">
                    {language === 'es'
                      ? 'La moneda base se usa como referencia. Configure las tasas de cambio en la sección "Tasas de Cambio".'
                      : 'The base currency is used as reference. Configure exchange rates in the "Exchange Rates" section.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCurrencySubmit} className="flex-1" style={getPrimaryButtonStyle(visualSettings)}>
                    {editingCurrency ? (
                      <><Save className="h-4 w-4 mr-2"/>{t('settings.financial.updateCurrency')}</>
                    ) : (
                      <><Plus className="h-4 w-4 mr-2"/>{t('settings.financial.addCurrency')}</>
                    )}
                  </Button>
                  {editingCurrency && (
                    <Button variant="outline" onClick={handleCancelEdit}>
                      {language === 'es' ? 'Cancelar' : 'Cancel'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-6 text-right"><Button onClick={handleFinancialSave} style={getPrimaryButtonStyle(visualSettings)}><Save className="mr-2 h-4 w-4" />{t('settings.financial.save')}</Button></div>
          </motion.div>

          {/* Exchange Rates Management */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="glass-effect p-6 rounded-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold" style={getHeadingStyle(visualSettings)}>
                {language === 'es' ? 'Tasas de Cambio' : 'Exchange Rates'}
              </h3>
              <Button
                onClick={() => setShowAddRate(!showAddRate)}
                style={getPrimaryButtonStyle(visualSettings)}
              >
                <Plus className="h-4 w-4 mr-2" />
                {language === 'es' ? 'Nueva Tasa' : 'New Rate'}
              </Button>
            </div>

            <p className="text-gray-600 mb-6">
              {language === 'es'
                ? 'Configure las tasas de cambio entre diferentes monedas. Las tasas se usan para convertir precios y totales.'
                : 'Configure exchange rates between different currencies. Rates are used to convert prices and totals.'}
            </p>

            {/* Add Rate Form */}
            {showAddRate && (
              <div className="bg-blue-50 p-4 rounded-lg mb-6">
                <h4 className="text-lg font-semibold mb-3">
                  {language === 'es' ? 'Nueva Tasa de Cambio' : 'New Exchange Rate'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {language === 'es' ? 'Desde Moneda' : 'From Currency'}
                    </label>
                    <select
                      value={newRate.fromCurrencyId}
                      onChange={e => setNewRate({...newRate, fromCurrencyId: e.target.value})}
                      className="input-style w-full"
                    >
                      <option value="">{language === 'es' ? 'Seleccionar...' : 'Select...'}</option>
                      {currencies.map(curr => (
                        <option key={curr.id} value={curr.id}>
                          {curr.code} - {language === 'es' ? curr.name_es : curr.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {language === 'es' ? 'Hacia Moneda' : 'To Currency'}
                    </label>
                    <select
                      value={newRate.toCurrencyId}
                      onChange={e => setNewRate({...newRate, toCurrencyId: e.target.value})}
                      className="input-style w-full"
                    >
                      <option value="">{language === 'es' ? 'Seleccionar...' : 'Select...'}</option>
                      {currencies.map(curr => (
                        <option key={curr.id} value={curr.id}>
                          {curr.code} - {language === 'es' ? curr.name_es : curr.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium">
                        {language === 'es' ? 'Tasa' : 'Rate'}
                      </label>
                      {officialRates && newRate.toCurrencyId && (() => {
                        const toCurrency = currencies.find(c => c.id === newRate.toCurrencyId);
                        const fromCurrency = currencies.find(c => c.id === newRate.fromCurrencyId);
                        if (toCurrency && fromCurrency && officialRates[toCurrency.code]) {
                          return (
                            <span className="text-xs text-blue-600">
                              {language === 'es' ? 'Ref: ' : 'Ref: '}
                              {officialRates[toCurrency.code].toFixed(6)}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <input
                      type="number"
                      step="0.000001"
                      value={newRate.rate}
                      onChange={e => setNewRate({...newRate, rate: e.target.value})}
                      placeholder="1.0"
                      className="input-style w-full"
                    />
                    {officialRates && newRate.toCurrencyId && (() => {
                      const toCurrency = currencies.find(c => c.id === newRate.toCurrencyId);
                      if (toCurrency && officialRates[toCurrency.code]) {
                        return (
                          <button
                            type="button"
                            onClick={() => setNewRate({...newRate, rate: officialRates[toCurrency.code].toString()})}
                            className="text-xs text-blue-600 hover:text-blue-800 underline mt-1"
                          >
                            {language === 'es' ? 'Usar tasa oficial' : 'Use official rate'}
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {language === 'es' ? 'Fecha Efectiva' : 'Effective Date'}
                    </label>
                    <input
                      type="date"
                      value={newRate.effectiveDate}
                      onChange={e => setNewRate({...newRate, effectiveDate: e.target.value})}
                      className="input-style w-full"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveRate} className="flex-1" style={getPrimaryButtonStyle(visualSettings)}>
                    <Save className="h-4 w-4 mr-2" />
                    {language === 'es' ? 'Guardar Tasa' : 'Save Rate'}
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setShowAddRate(false);
                    setNewRate({
                      fromCurrencyId: '',
                      toCurrencyId: '',
                      rate: '',
                      effectiveDate: new Date().toISOString().split('T')[0]
                    });
                  }}>
                    {language === 'es' ? 'Cancelar' : 'Cancel'}
                  </Button>
                </div>
              </div>
            )}

            {/* Exchange Rates List */}
            {loadingRates2 ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : exchangeRates.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {language === 'es'
                  ? 'No hay tasas de cambio configuradas. Cree una nueva tasa usando el botón de arriba.'
                  : 'No exchange rates configured. Create a new rate using the button above.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">{language === 'es' ? 'Desde' : 'From'}</th>
                      <th className="text-left py-2 px-3">{language === 'es' ? 'Hacia' : 'To'}</th>
                      <th className="text-right py-2 px-3">{language === 'es' ? 'Tasa' : 'Rate'}</th>
                      <th className="text-left py-2 px-3">{language === 'es' ? 'Fecha' : 'Date'}</th>
                      <th className="text-center py-2 px-3">{language === 'es' ? 'Acciones' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exchangeRates.map(rate => (
                      <tr key={rate.id} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="py-2 px-3">
                          <span className="font-bold">{rate.from_currency.code}</span>
                          <span className="text-xs text-gray-600 ml-1">
                            {language === 'es' ? rate.from_currency.name_es : rate.from_currency.name_en}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className="font-bold">{rate.to_currency.code}</span>
                          <span className="text-xs text-gray-600 ml-1">
                            {language === 'es' ? rate.to_currency.name_es : rate.to_currency.name_en}
                          </span>
                        </td>
                        <td className="text-right py-2 px-3 font-mono">{Number(rate.rate).toFixed(6)}</td>
                        <td className="py-2 px-3 text-sm text-gray-600">
                          {new Date(rate.effective_date).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex justify-center">
                            <Button
                              variant="destructive"
                              size="icon"
                              onClick={() => handleDeleteRate(rate.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
            </>
          )}

          {/* VISUAL TAB */}
          {activeTab === 'visual' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center"><Palette className="mr-3 text-purple-600" />{t('settings.visual.title')}</h2>

            {/* Appearance Customization Section */}
            <div className="mb-8 pb-8 border-b">
              <h3 className="text-xl font-semibold mb-6 flex items-center">
                <Palette className="mr-3 text-indigo-600" />
                {language === 'es' ? 'Personalización de Apariencia' : 'Appearance Customization'}
              </h3>

              <div className="space-y-6">
                {/* Company Logo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    {language === 'es' ? 'Logo de la Empresa' : 'Company Logo'}
                  </label>

                  {/* Logo Preview */}
                  {logoPreview && (
                    <div className="mb-4 flex justify-center">
                      <div className="relative w-40 h-40 rounded-lg overflow-hidden border-2 border-gray-300 bg-white p-2 flex items-center justify-center">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    </div>
                  )}

                  {/* File Upload */}
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/webp"
                    onChange={handleLogoUpload}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    {language === 'es'
                      ? 'Recomendado: PNG o SVG con fondo transparente, 200x200px, máx 2MB'
                      : 'Recommended: PNG or SVG with transparent background, 200x200px, max 2MB'}
                  </p>
                </div>

                {/* Company Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Nombre de la Empresa' : 'Company Name'}
                  </label>
                  <input
                    type="text"
                    value={appearance.companyName}
                    onChange={e => setAppearance(prev => ({ ...prev, companyName: e.target.value }))}
                    placeholder="PapuEnvíos"
                    className="w-full input-style"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {language === 'es'
                      ? 'Se mostrará en el encabezado y en el título de la página'
                      : 'Will be displayed in the header and page title'}
                  </p>
                </div>

                {/* Brand Colors */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {language === 'es' ? 'Color Primario' : 'Primary Color'}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={appearance.primaryColor}
                        onChange={e => setAppearance(prev => ({ ...prev, primaryColor: e.target.value }))}
                        className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={appearance.primaryColor}
                        onChange={e => setAppearance(prev => ({ ...prev, primaryColor: e.target.value }))}
                        placeholder="#2563eb"
                        className="flex-1 input-style font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {language === 'es' ? 'Color Secundario' : 'Secondary Color'}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={appearance.secondaryColor}
                        onChange={e => setAppearance(prev => ({ ...prev, secondaryColor: e.target.value }))}
                        className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={appearance.secondaryColor}
                        onChange={e => setAppearance(prev => ({ ...prev, secondaryColor: e.target.value }))}
                        placeholder="#9333ea"
                        className="flex-1 input-style font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Gradient Toggle */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={appearance.useGradient}
                      onChange={e => setAppearance(prev => ({ ...prev, useGradient: e.target.checked }))}
                      className="rounded w-4 h-4"
                    />
                    <span className="text-sm font-medium">
                      {language === 'es' ? 'Usar gradiente en elementos de marca' : 'Use gradient in brand elements'}
                    </span>
                  </label>
                </div>

                {/* Header Colors */}
                <div className="border-t pt-6 mt-6">
                  <h4 className="text-lg font-semibold mb-4">
                    {language === 'es' ? 'Colores del Encabezado' : 'Header Colors'}
                  </h4>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Color de Fondo' : 'Background Color'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.headerBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, headerBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.headerBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, headerBgColor: e.target.value }))}
                          placeholder="#ffffff"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Color de Texto' : 'Text Color'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.headerTextColor}
                          onChange={e => setAppearance(prev => ({ ...prev, headerTextColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.headerTextColor}
                          onChange={e => setAppearance(prev => ({ ...prev, headerTextColor: e.target.value }))}
                          placeholder="#1f2937"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Heading/Title Colors */}
                <div className="border-t pt-6 mt-6">
                  <h4 className="text-lg font-semibold mb-2">
                    {language === 'es' ? 'Títulos y Encabezados' : 'Headings and Titles'}
                  </h4>
                  <p className="text-sm text-gray-600 mb-4">
                    {language === 'es'
                      ? 'Colores para títulos principales de páginas y secciones'
                      : 'Colors for main page and section titles'}
                  </p>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Color de Títulos' : 'Heading Color'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.headingColor}
                          onChange={e => setAppearance(prev => ({ ...prev, headingColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.headingColor}
                          onChange={e => setAppearance(prev => ({ ...prev, headingColor: e.target.value }))}
                          placeholder="#1f2937"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {language === 'es'
                          ? 'Color sólido cuando el gradiente está desactivado'
                          : 'Solid color when gradient is disabled'}
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={appearance.useHeadingGradient}
                          onChange={e => setAppearance(prev => ({ ...prev, useHeadingGradient: e.target.checked }))}
                          className="rounded w-4 h-4"
                        />
                        <span className="text-sm font-medium">
                          {language === 'es'
                            ? 'Usar gradiente de marca en títulos'
                            : 'Use brand gradient in headings'}
                        </span>
                      </label>
                      <p className="text-xs text-gray-500 mt-2">
                        {language === 'es'
                          ? 'Aplica el gradiente de colores primario y secundario a los títulos principales'
                          : 'Applies the primary and secondary color gradient to main headings'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Button Colors */}
                <div className="border-t pt-6 mt-6">
                  <h4 className="text-lg font-semibold mb-4">
                    {language === 'es' ? 'Colores de Botones' : 'Button Colors'}
                  </h4>
                  <div className="grid md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Fondo del Botón' : 'Button Background'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.buttonBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, buttonBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.buttonBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, buttonBgColor: e.target.value }))}
                          placeholder="#2563eb"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Texto del Botón' : 'Button Text'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.buttonTextColor}
                          onChange={e => setAppearance(prev => ({ ...prev, buttonTextColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.buttonTextColor}
                          onChange={e => setAppearance(prev => ({ ...prev, buttonTextColor: e.target.value }))}
                          placeholder="#ffffff"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Hover del Botón' : 'Button Hover'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.buttonHoverBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, buttonHoverBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.buttonHoverBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, buttonHoverBgColor: e.target.value }))}
                          placeholder="#1d4ed8"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Destructive Button Colors */}
                <div className="border-t pt-6 mt-6">
                  <h4 className="text-lg font-semibold mb-2">
                    {language === 'es' ? 'Botones Destructivos (Eliminar)' : 'Destructive Buttons (Delete)'}
                  </h4>
                  <p className="text-sm text-gray-600 mb-4">
                    {language === 'es'
                      ? 'Colores para acciones peligrosas como eliminar elementos'
                      : 'Colors for dangerous actions like deleting items'}
                  </p>
                  <div className="grid md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Fondo' : 'Background'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.destructiveBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, destructiveBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.destructiveBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, destructiveBgColor: e.target.value }))}
                          placeholder="#dc2626"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Texto' : 'Text'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.destructiveTextColor}
                          onChange={e => setAppearance(prev => ({ ...prev, destructiveTextColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.destructiveTextColor}
                          onChange={e => setAppearance(prev => ({ ...prev, destructiveTextColor: e.target.value }))}
                          placeholder="#ffffff"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Hover' : 'Hover'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.destructiveHoverBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, destructiveHoverBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.destructiveHoverBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, destructiveHoverBgColor: e.target.value }))}
                          placeholder="#b91c1c"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Colors */}
                <div className="border-t pt-6 mt-6">
                  <h4 className="text-lg font-semibold mb-4">
                    {language === 'es' ? 'Colores Adicionales' : 'Additional Colors'}
                  </h4>
                  <div className="grid md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Color de Acento' : 'Accent Color'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.accentColor}
                          onChange={e => setAppearance(prev => ({ ...prev, accentColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.accentColor}
                          onChange={e => setAppearance(prev => ({ ...prev, accentColor: e.target.value }))}
                          placeholder="#9333ea"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {language === 'es' ? 'Para badges, enlaces y elementos destacados' : 'For badges, links and highlighted elements'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Fondo de Página' : 'Page Background'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.pageBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, pageBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.pageBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, pageBgColor: e.target.value }))}
                          placeholder="#f9fafb"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Fondo de Tarjetas' : 'Card Background'}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={appearance.cardBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, cardBgColor: e.target.value }))}
                          className="h-12 w-20 rounded border border-gray-300 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={appearance.cardBgColor}
                          onChange={e => setAppearance(prev => ({ ...prev, cardBgColor: e.target.value }))}
                          placeholder="#ffffff"
                          className="flex-1 input-style font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Color Preview */}
                <div className="mt-4 p-4 border rounded-lg bg-gray-50">
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    {language === 'es' ? 'Vista Previa:' : 'Preview:'}
                  </p>

                  {/* Header Preview */}
                  <div
                    className="mb-4 p-4 rounded-lg shadow-md"
                    style={{
                      backgroundColor: appearance.headerBgColor
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {logoPreview ? (
                          <div className="w-8 h-8 flex items-center justify-center">
                            <img
                              src={logoPreview}
                              alt="Logo preview"
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                        ) : (
                          <div
                            className="w-6 h-6 rounded flex items-center justify-center"
                            style={{
                              background: appearance.useGradient
                                ? `linear-gradient(to right, ${appearance.primaryColor}, ${appearance.secondaryColor})`
                                : appearance.primaryColor
                            }}
                          >
                            <ShoppingBag className="w-4 h-4 text-white" />
                          </div>
                        )}
                        <span
                          className="text-lg font-bold"
                          style={{
                            backgroundImage: appearance.useGradient
                              ? `linear-gradient(to right, ${appearance.primaryColor}, ${appearance.secondaryColor})`
                              : `linear-gradient(to right, ${appearance.primaryColor}, ${appearance.primaryColor})`,
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text'
                          }}
                        >
                          {appearance.companyName || 'PapuEnvíos'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm"
                          style={{ color: appearance.headerTextColor }}
                        >
                          {language === 'es' ? 'Menú' : 'Menu'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Buttons Preview */}
                  <div className="space-y-3">
                    <div className="flex gap-4 flex-wrap">
                      <div
                        className="px-6 py-3 rounded-lg font-semibold transition-colors"
                        style={{
                          backgroundColor: appearance.buttonBgColor,
                          color: appearance.buttonTextColor
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = appearance.buttonHoverBgColor}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = appearance.buttonBgColor}
                      >
                        {language === 'es' ? 'Botón Estándar' : 'Standard Button'}
                      </div>
                      <div
                        className="px-6 py-3 rounded-lg font-semibold text-white"
                        style={{
                          background: appearance.useGradient
                            ? `linear-gradient(to right, ${appearance.primaryColor}, ${appearance.secondaryColor})`
                            : appearance.primaryColor
                        }}
                      >
                        {language === 'es' ? 'Botón con Gradiente' : 'Gradient Button'}
                      </div>
                      <div
                        className="px-6 py-3 rounded-lg font-semibold transition-colors"
                        style={{
                          backgroundColor: appearance.destructiveBgColor,
                          color: appearance.destructiveTextColor
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = appearance.destructiveHoverBgColor}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = appearance.destructiveBgColor}
                      >
                        {language === 'es' ? 'Botón Eliminar' : 'Delete Button'}
                      </div>
                    </div>
                    <div className="flex gap-4 flex-wrap items-center">
                      <div
                        className="px-3 py-1 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: `${appearance.accentColor}20`,
                          color: appearance.accentColor
                        }}
                      >
                        {language === 'es' ? 'Badge de Acento' : 'Accent Badge'}
                      </div>
                      <span
                        className="font-semibold bg-clip-text text-transparent"
                        style={{
                          backgroundImage: appearance.useGradient
                            ? `linear-gradient(to right, ${appearance.primaryColor}, ${appearance.secondaryColor})`
                            : `linear-gradient(to right, ${appearance.primaryColor}, ${appearance.primaryColor})`
                        }}
                      >
                        {language === 'es' ? 'Texto con Gradiente' : 'Gradient Text'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="text-right">
                  <Button onClick={handleAppearanceSave} style={getPrimaryButtonStyle(visualSettings)}>
                    <Save className="mr-2 h-4 w-4" />
                    {language === 'es' ? 'Guardar Personalización' : 'Save Customization'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Carousel Slides Section */}
            <div className="border-t pt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">{t('settings.visual.slides')}</h3>
                <Button onClick={handleAddSlide} style={getPrimaryButtonStyle(visualSettings)}><Plus className="mr-2 h-4 w-4" />{t('settings.visual.addSlide')}</Button>
              </div>
              <div className="space-y-4">
                {loadingSlides ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500">{language === 'es' ? 'Cargando diapositivas...' : 'Loading slides...'}</p>
                  </div>
                ) : carouselSlides.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500">{language === 'es' ? 'No hay diapositivas. Agrega una para comenzar.' : 'No slides. Add one to get started.'}</p>
                  </div>
                ) : (
                  carouselSlides.map(slide => (
                    <div key={slide.id} className="p-4 border rounded-lg space-y-3">
                      {/* Saving Indicator */}
                      {savingSlide === slide.id && (
                        <div className="flex items-center gap-2 text-sm text-blue-600 mb-2 bg-blue-50 p-2 rounded">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span className="font-medium">
                            {language === 'es' ? 'Guardando...' : 'Saving...'}
                          </span>
                        </div>
                      )}

                      {/* Saved Indicator */}
                      {savedSlide === slide.id && savingSlide !== slide.id && (
                        <div className="flex items-center gap-2 text-sm text-green-600 mb-2 bg-green-50 p-2 rounded">
                          <Check className="h-4 w-4" />
                          <span className="font-medium">
                            {language === 'es' ? 'Guardado ✓' : 'Saved ✓'}
                          </span>
                        </div>
                      )}

                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Order */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.visual.order')}
                          </label>
                          <input
                            type="number"
                            value={slide.display_order ?? 0}
                            onChange={e => handleSlideOrderChange(slide.id, e.target.value)}
                            className="w-full input-style"
                            min="0"
                          />
                        </div>

                        {/* Link URL */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.visual.linkUrl')}
                          </label>
                          <input
                            type="url"
                            value={slide.link_url || ''}
                            onChange={e => handleSlideChange(slide.id, { link_url: e.target.value })}
                            placeholder="https://..."
                            className="w-full input-style"
                          />
                        </div>
                      </div>

                      {/* Image Preview */}
                      {(slide.image_url || slidePreviews[slide.id]) && (
                        <div className="mb-3">
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

                      {/* Image Upload or URL */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('settings.visual.image')}
                        </label>
                        <input
                          type="url"
                          value={slide.image_url || ''}
                          onChange={e => handleSlideChange(slide.id, { image_url: e.target.value })}
                          placeholder="https://... or upload below"
                          className="w-full input-style mb-2"
                        />
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => handleSlideImageUpload(slide.id, e)}
                          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                          {language === 'es'
                            ? 'Recomendado: 1920x1080px (16:9), máx 5MB'
                            : 'Recommended: 1920x1080px (16:9), max 5MB'}
                        </p>
                      </div>

                      {/* Text fields - Title */}
                      <div className="grid md:grid-cols-2 gap-4 mt-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.visual.mainText')} (ES)
                          </label>
                          <input
                            type="text"
                            value={slide.title_es || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'title_es', e.target.value)}
                            placeholder="Título principal en español"
                            className="w-full input-style"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.visual.mainText')} (EN)
                          </label>
                          <input
                            type="text"
                            value={slide.title_en || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'title_en', e.target.value)}
                            placeholder="Main title in English"
                            className="w-full input-style"
                          />
                        </div>
                      </div>

                      {/* Text fields - Subtitle */}
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.visual.secondaryText')} (ES)
                          </label>
                          <input
                            type="text"
                            value={slide.subtitle_es || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'subtitle_es', e.target.value)}
                            placeholder="Subtítulo en español"
                            className="w-full input-style"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.visual.secondaryText')} (EN)
                          </label>
                          <input
                            type="text"
                            value={slide.subtitle_en || ''}
                            onChange={e => handleSlideTextChange(slide.id, 'subtitle_en', e.target.value)}
                            placeholder="Subtitle in English"
                            className="w-full input-style"
                          />
                        </div>
                      </div>

                      {/* Active checkbox and Delete button */}
                      <div className="flex justify-between items-center mt-4 pt-4 border-t">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`slide-active-${slide.id}`}
                            checked={slide.is_active ?? true}
                            onChange={e => handleSlideChange(slide.id, { is_active: e.target.checked })}
                          />
                          <label htmlFor={`slide-active-${slide.id}`} className="text-sm font-medium">
                            {t('settings.visual.active')}
                          </label>
                        </div>
                        <Button variant="destructive" size="sm" onClick={() => handleRemoveSlide(slide.id)}>
                          <Trash2 className="h-4 w-4 mr-2" />
                          {language === 'es' ? 'Eliminar' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>

          </>
          )}

          {/* ENVÍOS TAB */}
          {activeTab === 'envios' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center">
                  <Truck className="mr-3" style={{ color: visualSettings.primaryColor || '#2563eb' }} />
                  {language === 'es' ? 'Zonas de Envío' : 'Shipping Zones'}
                </h2>

            <p className="text-sm text-gray-600 mb-6">
              {language === 'es'
                ? 'Configura el costo de envío por provincia. Las provincias con costo $0 no aparecerán en el selector de envío.'
                : 'Configure shipping cost by province. Provinces with $0 cost will not appear in the shipping selector.'}
            </p>

            {loadingZones ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin" style={{ color: visualSettings.primaryColor }} />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {shippingZones.map(zone => (
                  <div
                    key={zone.id}
                    className="p-4 border rounded-lg"
                    style={{
                      borderColor: zone.is_active ? (visualSettings.primaryColor || '#2563eb') : '#e5e7eb',
                      backgroundColor: zone.is_active ? `${visualSettings.primaryColor || '#2563eb'}08` : 'transparent'
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" style={{ color: visualSettings.primaryColor }} />
                        <span className="font-medium">{zone.province_name}</span>
                      </div>
                      {savingZone === zone.id && (
                        <RefreshCw className="h-4 w-4 animate-spin" style={{ color: visualSettings.primaryColor }} />
                      )}
                    </div>

                    <div className="space-y-3">
                      {/* Free shipping checkbox */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={zone.free_shipping || false}
                          onChange={e => handleShippingZoneUpdate(zone.id, {
                            ...zone,
                            free_shipping: e.target.checked,
                            shipping_cost: e.target.checked ? 0 : zone.shipping_cost,
                            is_active: true
                          })}
                          className="rounded"
                        />
                        <span className="text-sm">
                          {language === 'es' ? 'Envío Gratis' : 'Free Shipping'}
                        </span>
                      </label>

                      {/* Shipping cost input */}
                      {!zone.free_shipping && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">
                            {language === 'es' ? 'Costo de envío ($)' : 'Shipping cost ($)'}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={zone.shipping_cost || 0}
                            onChange={e => {
                              const cost = parseFloat(e.target.value) || 0;
                              setShippingZones(prev =>
                                prev.map(z => z.id === zone.id ? { ...z, shipping_cost: cost } : z)
                              );
                            }}
                            onBlur={e => {
                              const cost = parseFloat(e.target.value) || 0;
                              if (cost !== zone.shipping_cost) {
                                handleShippingZoneUpdate(zone.id, {
                                  ...zone,
                                  shipping_cost: cost,
                                  is_active: cost > 0
                                });
                              }
                            }}
                            className="input-style w-full text-sm"
                            placeholder="0.00"
                          />
                        </div>
                      )}

                      {/* Status indicator */}
                      <div className="flex items-center gap-2 text-xs">
                        {zone.free_shipping ? (
                          <span className="px-2 py-1 rounded" style={{
                            backgroundColor: `${visualSettings.successColor || '#10b981'}20`,
                            color: visualSettings.successColor || '#10b981'
                          }}>
                            {language === 'es' ? '✓ Gratis' : '✓ Free'}
                          </span>
                        ) : zone.shipping_cost > 0 ? (
                          <span className="px-2 py-1 rounded" style={{
                            backgroundColor: `${visualSettings.primaryColor || '#2563eb'}20`,
                            color: visualSettings.primaryColor || '#2563eb'
                          }}>
                            {language === 'es' ? '✓ Activo' : '✓ Active'}
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-gray-100 text-gray-500">
                            {language === 'es' ? 'No disponible' : 'Not available'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
            </>
          )}

          {/* REMESAS TAB */}
          {activeTab === 'remesas' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center">
                  <Banknote className="mr-3" style={{ color: visualSettings.primaryColor || '#2563eb' }} />
              {language === 'es' ? 'Configuración de Remesas' : 'Remittance Configuration'}
            </h2>

            <p className="text-sm text-gray-600 mb-6">
              {language === 'es'
                ? 'Configure las monedas y métodos de pago disponibles para las remesas.'
                : 'Configure available currencies and payment methods for remittances.'}
            </p>

            {loadingRemittances ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="animate-spin h-6 w-6 text-gray-400" />
              </div>
            ) : (
              <div className="space-y-6">
                {remittanceConfigs.map(config => (
                  <div
                    key={config.id}
                    className="border rounded-lg p-6"
                    style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                  >
                    {/* Currency Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center"
                          style={{
                            background: visualSettings.useGradient
                              ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                              : visualSettings.primaryColor || '#2563eb'
                          }}
                        >
                          <span className="text-white font-bold text-sm">{config.currency}</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{config.name}</h3>
                          <p className="text-xs text-gray-500">
                            {config.currency === 'MN' && (language === 'es' ? 'Moneda Nacional' : 'National Currency')}
                            {config.currency === 'USD' && (language === 'es' ? 'Dólar Estadounidense' : 'US Dollar')}
                            {config.currency === 'MLC' && (language === 'es' ? 'Moneda Libremente Convertible' : 'Freely Convertible Currency')}
                          </p>
                        </div>
                      </div>

                      {savingRemittance === config.id && (
                        <RefreshCw className="animate-spin h-5 w-5 text-gray-400" />
                      )}
                    </div>

                    {/* Enable/Disable Currency */}
                    <label className="flex items-center gap-2 mb-4 p-3 bg-gray-50 rounded-lg cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.enabled !== false}
                        onChange={e => handleRemittanceConfigUpdate(config.id, {
                          enabled: e.target.checked
                        })}
                        className="rounded"
                      />
                      <span className="text-sm font-medium">
                        {language === 'es' ? 'Habilitar esta moneda' : 'Enable this currency'}
                      </span>
                    </label>

                    {/* Payment Methods */}
                    {config.enabled !== false && (
                      <div>
                        <label className="block text-sm font-semibold mb-3">
                          {language === 'es' ? 'Métodos de Pago Disponibles:' : 'Available Payment Methods:'}
                        </label>
                        <div className="space-y-2">
                          {config.paymentMethods?.map(method => (
                            <label
                              key={method.id}
                              className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                              style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={method.enabled !== false}
                                  onChange={() => togglePaymentMethod(config.id, method.id)}
                                  className="rounded"
                                />
                                <CreditCard className="h-4 w-4 text-gray-400" />
                                <span className="text-sm font-medium">{method.name}</span>
                              </div>
                              {method.enabled !== false ? (
                                <span
                                  className="text-xs px-2 py-1 rounded"
                                  style={{
                                    backgroundColor: `${visualSettings.successColor || '#10b981'}20`,
                                    color: visualSettings.successColor || '#10b981'
                                  }}
                                >
                                  {language === 'es' ? '✓ Activo' : '✓ Active'}
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">
                                  {language === 'es' ? 'Desactivado' : 'Disabled'}
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Status Summary */}
                    <div className="mt-4 pt-4 border-t" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <span>
                          {language === 'es' ? 'Métodos activos:' : 'Active methods:'}
                        </span>
                        <span className="font-semibold">
                          {config.paymentMethods?.filter(m => m.enabled !== false).length || 0} / {config.paymentMethods?.length || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
            </>
          )}

          {/* CONTENIDO TAB */}
          {activeTab === 'contenido' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center"><Bell className="mr-3 text-green-600" />{t('settings.notifications.title')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.notifications.whatsapp')}</label>
                <input type="tel" value={localNotifications.whatsapp} onChange={e => setLocalNotifications({...localNotifications, whatsapp: e.target.value})} placeholder="+1234567890" className="w-full input-style" />
                <p className="text-xs text-gray-500 mt-1">{language === 'es' ? 'Número de WhatsApp para soporte individual' : 'WhatsApp number for individual support'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{language === 'es' ? 'Grupo de WhatsApp' : 'WhatsApp Group'}</label>
                <input type="text" value={localNotifications.whatsappGroup} onChange={e => setLocalNotifications({...localNotifications, whatsappGroup: e.target.value})} placeholder="https://chat.whatsapp.com/xxxxx" className="w-full input-style" />
                <p className="text-xs text-gray-500 mt-1">{language === 'es' ? 'URL del grupo de WhatsApp para notificaciones de pedidos' : 'WhatsApp group URL for order notifications'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.notifications.adminEmail')}</label>
                <input type="email" value={localNotifications.adminEmail} onChange={e => setLocalNotifications({...localNotifications, adminEmail: e.target.value})} placeholder="admin@example.com" className="w-full input-style" />
                <p className="text-xs text-gray-500 mt-1">{language === 'es' ? 'Email para recibir notificaciones de nuevos pedidos' : 'Email to receive new order notifications'}</p>
              </div>
            </div>
            <div className="mt-6 text-right"><Button onClick={handleNotificationSave} style={getPrimaryButtonStyle(visualSettings)}><Save className="mr-2 h-4 w-4" />{t('settings.notifications.save')}</Button></div>
          </motion.div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;