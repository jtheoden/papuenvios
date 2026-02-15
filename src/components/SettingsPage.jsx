import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Bell, Save, Palette, Truck, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
// Currency functions now handled by SettingsPageFinancial component
import { saveNotificationSettings } from '@/lib/notificationSettingsService';
import { supabase } from '@/lib/supabase';
// Extracted Settings Components
import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';
import SettingsPageShipping from '@/components/settings/SettingsPageShipping';
import SettingsPageVisual from '@/components/settings/SettingsPageVisual';
import SettingsPageContent from '@/components/settings/SettingsPageContent';
import SettingsZelleTab from '@/components/settings/SettingsZelleTab';

const SettingsPage = () => {
  const { t, language } = useLanguage();
  const {
    financialSettings, setFinancialSettings,
    notificationSettings, setNotificationSettings,
    refreshNotificationSettings,
    visualSettings, setVisualSettings,
    zelleAccounts, setZelleAccounts
  } = useBusiness();
  const { user, isAdmin } = useAuth();

  // Tab management
  const [activeTab, setActiveTab] = useState('financiero');

  const [localFinancial, setLocalFinancial] = useState(financialSettings);
  const [localNotifications, setLocalNotifications] = useState(notificationSettings);
  const [localVisual, setLocalVisual] = useState(visualSettings);

  // Currency and exchange rate state/functions now handled by SettingsPageFinancial component

  useEffect(() => {
    setLocalNotifications(notificationSettings);
  }, [notificationSettings]);

  // Load official exchange rates
  const loadOfficialRates = async () => {
    setLoadingRates(true);
    try {
      const rates = await fetchOfficialRates();
      setOfficialRates(rates || []);
    } catch (error) {
      console.error('[loadOfficialRates] ERROR:', error);
      console.error('[loadOfficialRates] Error details:', { message: error?.message, code: error?.code });
      setOfficialRates([]);
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
      const currencies = await getCurrencies();
      setCurrencies(currencies || []);
    } catch (error) {
      console.error('[loadCurrencies] ERROR:', error);
      console.error('[loadCurrencies] Error details:', { message: error?.message, code: error?.code });
      setCurrencies([]);
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
    try {
      setFinancialSettings(localFinancial);
      toast({ title: t('settings.saveSuccess') });
    } catch (error) {
      console.error('[handleFinancialSave] ERROR:', error);
      console.error('[handleFinancialSave] Error details:', { message: error?.message, code: error?.code });
      throw error;
    }
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
      console.error('[handleCurrencySubmit] ERROR:', error);
      console.error('[handleCurrencySubmit] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleEditCurrency = async (currency) => {
    try {
      setEditingCurrency(currency);
      setCurrencyForm({
        code: currency.code,
        name_es: currency.name_es,
        name_en: currency.name_en,
        symbol: currency.symbol,
        is_base: currency.is_base || false
      });
    } catch (error) {
      console.error('[handleEditCurrency] ERROR:', error);
      console.error('[handleEditCurrency] Error details:', { message: error?.message, code: error?.code });
      throw error;
    }
  };

  const handleRemoveCurrency = async (currencyId) => {

    const confirmMessage = language === 'es'
      ? '¿Está seguro de que desea eliminar esta moneda? Esto también eliminará sus tasas de cambio.'
      : 'Are you sure you want to delete this currency? This will also remove its exchange rates.';

    if (!confirm(confirmMessage)) {
      return;
    }

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
      console.error('[handleRemoveCurrency] ERROR:', error);
      console.error('[handleRemoveCurrency] Error details:', { message: error?.message, code: error?.code });
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

  const handleNotificationSave = async () => {
    try {
      await saveNotificationSettings(localNotifications);
      // IMPORTANT: Refresh from DB to ensure all components get the fresh values
      // This ensures the cached values in context are updated immediately
      await refreshNotificationSettings();
      toast({ title: t('settings.saveSuccess') });
    } catch (err) {
      console.error('[handleNotificationSave] ERROR:', err);
      console.error('[handleNotificationSave] Error details:', { message: err?.message, code: err?.code });
      toast({
        title: t('common.error'),
        description: 'Failed to save notification settings'
      });
    }
  };

  // Exchange Rates functions
  const loadExchangeRates = async () => {
    setLoadingRates2(true);
    try {
      const rates = await getAllExchangeRates();
      setExchangeRates(rates || []);
    } catch (error) {
      console.error('[loadExchangeRates] ERROR:', error);
      console.error('[loadExchangeRates] Error details:', { message: error?.message, code: error?.code });
      setExchangeRates([]);
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
      console.error('[handleSaveRate] ERROR:', error);
      console.error('[handleSaveRate] Error details:', { message: error?.message, code: error?.code });
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
      console.error('[handleDeleteRate] ERROR:', error);
      console.error('[handleDeleteRate] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleVisualSave = async () => {
    try {
      setVisualSettings(localVisual);
      toast({ title: t('settings.saveSuccess') });
    } catch (error) {
      console.error('[handleVisualSave] ERROR:', error);
      console.error('[handleVisualSave] Error details:', { message: error?.message, code: error?.code });
      throw error;
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
      id: 'visual',
      label: language === 'es' ? 'Visual' : 'Visual',
      icon: Palette,
      color: '#9333ea'
    },
    {
      id: 'zelle',
      label: 'Zelle',
      icon: CreditCard,
      color: '#3b82f6'
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

        {/* Tabs Navigation - Uses visualSettings for consistent theming */}
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-8 border-b pb-2">
          <div className="flex gap-1 sm:gap-2 min-w-max sm:min-w-0 sm:flex-wrap">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const activeColor = visualSettings.tabActiveColor || visualSettings.primaryColor || tab.color;
              const activeBgColor = visualSettings.tabActiveBgColor || '#ffffff';
              const inactiveColor = visualSettings.tabInactiveColor || '#6b7280';
              const inactiveBgColor = visualSettings.tabInactiveBgColor || '#f9fafb';
              const hoverColor = visualSettings.tabHoverColor || '#1f2937';
              const hoverBgColor = visualSettings.tabHoverBgColor || '#f3f4f6';
              const dir = visualSettings.gradientDirection || 135;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-2 sm:py-3 rounded-t-lg font-medium transition-all text-sm sm:text-base whitespace-nowrap ${
                    isActive ? 'shadow-md border-b-2' : ''
                  }`}
                  style={isActive
                    ? (visualSettings.useTabGradient
                        ? {
                            background: `linear-gradient(${dir}deg, ${activeColor}, ${visualSettings.secondaryColor || '#9333ea'})`,
                            color: '#ffffff',
                            borderBottom: '2px solid transparent'
                          }
                        : {
                            backgroundColor: activeBgColor,
                            borderBottomColor: activeColor,
                            color: activeColor
                          })
                    : {
                        backgroundColor: inactiveBgColor,
                        color: inactiveColor
                      }
                  }
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = hoverBgColor;
                      e.currentTarget.style.color = hoverColor;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = inactiveBgColor;
                      e.currentTarget.style.color = inactiveColor;
                    }
                  }}
                >
                  <tab.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span className="hidden xs:inline sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-12">
          {/* FINANCIERO TAB - Uses extracted component */}
          {activeTab === 'financiero' && (
            <SettingsPageFinancial
              localFinancial={localFinancial}
              setLocalFinancial={setLocalFinancial}
            />
          )}

          {/* VISUAL TAB */}
          {activeTab === 'visual' && (
            <SettingsPageVisual
              localVisual={localVisual}
              setLocalVisual={setLocalVisual}
              visualSettings={visualSettings}
              setVisualSettings={setVisualSettings}
            />
          )}

          {/* ENVÍOS TAB */}
          {activeTab === 'envios' && (
            <SettingsPageShipping />
          )}

          {/* ZELLE TAB */}
          {activeTab === 'zelle' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <SettingsZelleTab />
              </motion.div>
            </>
          )}

          {/* CONTENIDO TAB */}
          {activeTab === 'contenido' && (
            <SettingsPageContent
              localNotifications={localNotifications}
              setLocalNotifications={setLocalNotifications}
              visualSettings={visualSettings}
              setVisualSettings={setVisualSettings}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
