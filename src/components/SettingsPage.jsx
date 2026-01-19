import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Bell, Save, Palette, Truck, CreditCard, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { getCurrencies, createCurrency, updateCurrency, deleteCurrency, fetchOfficialRates, getAllExchangeRates, saveExchangeRate, deleteExchangeRate } from '@/lib/currencyService';
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
    loadExchangeRates();
  }, []);

  useEffect(() => {
    setLocalNotifications(notificationSettings);
  }, [notificationSettings]);

  // Load official exchange rates
  const loadOfficialRates = async () => {
    console.log('[loadOfficialRates] START - Loading official exchange rates');
    setLoadingRates(true);
    try {
      console.log('[loadOfficialRates] Fetching rates from API...');
      const rates = await fetchOfficialRates();
      console.log('[loadOfficialRates] SUCCESS - Rates loaded:', { count: rates?.length || 0, rates });
      setOfficialRates(rates || []);
    } catch (error) {
      console.error('[loadOfficialRates] ERROR:', error);
      console.error('[loadOfficialRates] Error details:', { message: error?.message, code: error?.code });
      setOfficialRates([]);
    } finally {
      setLoadingRates(false);
      console.log('[loadOfficialRates] Loading state set to false');
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
    console.log('[loadCurrencies] START - Loading currencies from database');
    try {
      console.log('[loadCurrencies] Fetching currencies...');
      const currencies = await getCurrencies();
      console.log('[loadCurrencies] SUCCESS - Currencies loaded:', { count: currencies?.length || 0, currencies });
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
    console.log('[handleFinancialSave] START - Input:', localFinancial);
    try {
      setFinancialSettings(localFinancial);
      console.log('[handleFinancialSave] SUCCESS - Financial settings saved');
      toast({ title: t('settings.saveSuccess') });
    } catch (error) {
      console.error('[handleFinancialSave] ERROR:', error);
      console.error('[handleFinancialSave] Error details:', { message: error?.message, code: error?.code });
      throw error;
    }
  };

  // Handle currency form submission (create or update)
  const handleCurrencySubmit = async () => {
    console.log('[handleCurrencySubmit] START - Input:', { currencyForm, editingCurrency });

    if (!currencyForm.code || !currencyForm.name_es || !currencyForm.name_en || !currencyForm.symbol) {
      console.log('[handleCurrencySubmit] VALIDATION ERROR - Missing required fields');
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
        console.log('[handleCurrencySubmit] Unsetting previous base currency...');
        await supabase.from('currencies')
          .update({ is_base: false })
          .eq('is_base', true)
          .neq('id', editingCurrency?.id || '00000000-0000-0000-0000-000000000000');
      }

      let savedCurrency;
      if (editingCurrency) {
        // Update existing currency
        console.log('[handleCurrencySubmit] Updating existing currency:', editingCurrency.id);
        const { data, error } = await updateCurrency(editingCurrency.id, currencyForm);
        if (error) throw error;
        savedCurrency = data;
        console.log('[handleCurrencySubmit] Currency updated successfully:', savedCurrency);

        toast({
          title: language === 'es' ? 'Moneda actualizada' : 'Currency Updated',
          description: language === 'es'
            ? 'La moneda se actualizó exitosamente'
            : 'Currency was updated successfully'
        });
      } else {
        // Create new currency
        console.log('[handleCurrencySubmit] Creating new currency');
        const { data, error } = await createCurrency(currencyForm);
        if (error) throw error;
        savedCurrency = data;
        console.log('[handleCurrencySubmit] Currency created successfully:', savedCurrency);

        toast({
          title: language === 'es' ? 'Moneda creada' : 'Currency Created',
          description: language === 'es'
            ? 'La moneda se creó exitosamente'
            : 'Currency was created successfully'
        });
      }

      // Reset form and reload
      console.log('[handleCurrencySubmit] Resetting form and reloading currencies...');
      setCurrencyForm({ code: '', name_es: '', name_en: '', symbol: '', is_base: false });
      setEditingCurrency(null);
      await loadCurrencies();
      console.log('[handleCurrencySubmit] SUCCESS - Currency submission completed');
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
    console.log('[handleEditCurrency] START - Input:', currency);
    try {
      setEditingCurrency(currency);
      setCurrencyForm({
        code: currency.code,
        name_es: currency.name_es,
        name_en: currency.name_en,
        symbol: currency.symbol,
        is_base: currency.is_base || false
      });
      console.log('[handleEditCurrency] SUCCESS - Currency form populated for editing');
    } catch (error) {
      console.error('[handleEditCurrency] ERROR:', error);
      console.error('[handleEditCurrency] Error details:', { message: error?.message, code: error?.code });
      throw error;
    }
  };

  const handleRemoveCurrency = async (currencyId) => {
    console.log('[handleRemoveCurrency] START - Input:', { currencyId });

    const confirmMessage = language === 'es'
      ? '¿Está seguro de que desea eliminar esta moneda? Esto también eliminará sus tasas de cambio.'
      : 'Are you sure you want to delete this currency? This will also remove its exchange rates.';

    if (!confirm(confirmMessage)) {
      console.log('[handleRemoveCurrency] User cancelled deletion');
      return;
    }

    try {
      // First, deactivate all exchange rates for this currency
      console.log('[handleRemoveCurrency] Deactivating exchange rates for currency:', currencyId);
      await supabase.from('exchange_rates')
        .update({ is_active: false })
        .or(`from_currency_id.eq.${currencyId},to_currency_id.eq.${currencyId}`);

      // Then delete the currency (soft delete)
      console.log('[handleRemoveCurrency] Deleting currency:', currencyId);
      const { error } = await deleteCurrency(currencyId);
      if (error) throw error;

      console.log('[handleRemoveCurrency] SUCCESS - Currency deleted');
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
    console.log('[handleNotificationSave] START - Input:', localNotifications);
    try {
      console.log('[handleNotificationSave] Saving notification settings...');
      await saveNotificationSettings(localNotifications);
      // IMPORTANT: Refresh from DB to ensure all components get the fresh values
      // This ensures the cached values in context are updated immediately
      await refreshNotificationSettings();
      console.log('[handleNotificationSave] SUCCESS - Notification settings saved and context refreshed');
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
    console.log('[loadExchangeRates] START - Loading exchange rates');
    setLoadingRates2(true);
    try {
      console.log('[loadExchangeRates] Fetching rates from database...');
      const rates = await getAllExchangeRates();
      console.log('[loadExchangeRates] SUCCESS - Rates loaded:', { count: rates?.length || 0, rates });
      setExchangeRates(rates || []);
    } catch (error) {
      console.error('[loadExchangeRates] ERROR:', error);
      console.error('[loadExchangeRates] Error details:', { message: error?.message, code: error?.code });
      setExchangeRates([]);
    } finally {
      setLoadingRates2(false);
      console.log('[loadExchangeRates] Loading state set to false');
    }
  };

  const handleSaveRate = async () => {
    console.log('[handleSaveRate] START - Input:', newRate);

    if (!newRate.fromCurrencyId || !newRate.toCurrencyId || !newRate.rate) {
      console.log('[handleSaveRate] VALIDATION ERROR - Missing required fields');
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
      console.log('[handleSaveRate] VALIDATION ERROR - Same currencies selected');
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
      console.log('[handleSaveRate] Saving direct rate...');
      const result = await saveExchangeRate(newRate);
      if (result.error) throw result.error;
      console.log('[handleSaveRate] Direct rate saved:', result);

      // Save inverse rate (to -> from)
      const inverseRate = {
        fromCurrencyId: newRate.toCurrencyId,
        toCurrencyId: newRate.fromCurrencyId,
        rate: (1 / parseFloat(newRate.rate)).toString(),
        effectiveDate: newRate.effectiveDate
      };
      console.log('[handleSaveRate] Saving inverse rate:', inverseRate);
      const inverseResult = await saveExchangeRate(inverseRate);
      if (inverseResult.error) throw inverseResult.error;
      console.log('[handleSaveRate] Inverse rate saved:', inverseResult);

      await loadExchangeRates();
      setShowAddRate(false);
      setNewRate({
        fromCurrencyId: '',
        toCurrencyId: '',
        rate: '',
        effectiveDate: new Date().toISOString().split('T')[0]
      });

      console.log('[handleSaveRate] SUCCESS - Exchange rates saved');
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
    console.log('[handleDeleteRate] START - Input:', { rateId });

    if (!confirm(language === 'es' ? '¿Eliminar esta tasa?' : 'Delete this rate?')) {
      console.log('[handleDeleteRate] User cancelled deletion');
      return;
    }

    try {
      console.log('[handleDeleteRate] Deleting exchange rate:', rateId);
      const result = await deleteExchangeRate(rateId);
      if (result.error) throw result.error;
      console.log('[handleDeleteRate] Delete result:', result);

      await loadExchangeRates();
      console.log('[handleDeleteRate] SUCCESS - Exchange rate deleted');
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
    console.log('[handleVisualSave] START - Input:', localVisual);
    try {
      setVisualSettings(localVisual);
      console.log('[handleVisualSave] SUCCESS - Visual settings saved');
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

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-2 sm:py-3 rounded-t-lg font-medium transition-all text-sm sm:text-base whitespace-nowrap ${
                    isActive ? 'shadow-md border-b-2' : 'hover:opacity-80'
                  }`}
                  style={isActive ? {
                    backgroundColor: activeBgColor,
                    borderBottomColor: activeColor,
                    color: activeColor
                  } : {
                    backgroundColor: inactiveBgColor,
                    color: inactiveColor
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
          {/* FINANCIERO TAB */}
          {activeTab === 'financiero' && (
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center"><DollarSign className="mr-3 text-blue-600" />{t('settings.financial.title')}</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.usdToLocal')}</label>
                <input type="number" value={localFinancial.usdToLocal} onChange={e => setLocalFinancial({...localFinancial, usdToLocal: parseFloat(e.target.value)})} placeholder="0.00" className="input-style w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.productProfit')}</label>
                <input type="number" value={localFinancial.productProfit} onChange={e => setLocalFinancial({...localFinancial, productProfit: parseFloat(e.target.value)})} placeholder="%" className="input-style w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.comboProfit')}</label>
                <input type="number" value={localFinancial.comboProfit} onChange={e => setLocalFinancial({...localFinancial, comboProfit: parseFloat(e.target.value)})} placeholder="%" className="input-style w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.remittanceProfit')}</label>
                <input type="number" value={localFinancial.remittanceProfit} onChange={e => setLocalFinancial({...localFinancial, remittanceProfit: parseFloat(e.target.value)})} placeholder="%" className="input-style w-full" />
              </div>
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
              <div className="flex justify-between items-center gap-2 mb-4">
                <h3 className="text-lg sm:text-xl font-semibold">{t('settings.financial.currencies')}</h3>
                <Button
                  onClick={loadOfficialRates}
                  disabled={loadingRates}
                  variant="outline"
                  size="sm"
                >
                  <DollarSign className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">
                    {loadingRates
                      ? (language === 'es' ? 'Cargando...' : 'Loading...')
                      : (language === 'es' ? 'Cargar Tasas' : 'Load Rates')
                    }
                  </span>
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
                  <div key={currency.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-bold w-12 sm:w-16 shrink-0">{currency.code}</span>
                      <span className="truncate flex-1 text-sm sm:text-base">{language === 'es' ? currency.name_es : currency.name_en}</span>
                      <span className="w-8 sm:w-12 text-center shrink-0">{currency.symbol}</span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                      {currency.is_base && (
                        <span
                          className="text-xs text-white px-2 py-1 rounded font-semibold whitespace-nowrap"
                          style={{
                            background: visualSettings.useGradient
                              ? `linear-gradient(to right, ${visualSettings.primaryColor}, ${visualSettings.secondaryColor})`
                              : visualSettings.primaryColor
                          }}
                        >
                          {language === 'es' ? 'Base' : 'Base'}
                        </span>
                      )}
                      <div className="flex gap-1 shrink-0">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleEditCurrency(currency)}>
                          <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                        <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => handleRemoveCurrency(currency.id)}>
                          <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                      </div>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
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
                      <><Save className="h-4 w-4 sm:mr-2"/><span className="hidden sm:inline">{t('settings.financial.updateCurrency')}</span></>
                    ) : (
                      <><Plus className="h-4 w-4 sm:mr-2"/><span className="hidden sm:inline">{t('settings.financial.addCurrency')}</span></>
                    )}
                  </Button>
                  {editingCurrency && (
                    <Button variant="outline" onClick={handleCancelEdit}>
                      <span className="hidden sm:inline">{language === 'es' ? 'Cancelar' : 'Cancel'}</span>
                      <span className="sm:hidden">✕</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-6 text-right"><Button onClick={handleFinancialSave} style={getPrimaryButtonStyle(visualSettings)}><Save className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">{t('common.saveSettings')}</span></Button></div>
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
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{language === 'es' ? 'Nueva Tasa' : 'New Rate'}</span>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
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
            <>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
                <h2 className="text-2xl font-semibold mb-6 flex items-center"><Bell className="mr-3 text-green-600" />{t('settings.notifications.title')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {language === 'es' ? 'Destino de notificaciones' : 'Notification destination'}
                </label>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setLocalNotifications({ ...localNotifications, whatsappTarget: 'whatsapp' })}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      (localNotifications.whatsappTarget || 'whatsapp') === 'whatsapp'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {language === 'es' ? 'Cuenta' : 'Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocalNotifications({ ...localNotifications, whatsappTarget: 'whatsappGroup' })}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      localNotifications.whatsappTarget === 'whatsappGroup'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {language === 'es' ? 'Grupo' : 'Group'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {language === 'es'
                    ? 'Selecciona si las notificaciones salen por cuenta directa o por grupo.'
                    : 'Choose whether notifications go to a direct account or a group.'}
                </p>
              </div>
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
            </div>
            <div className="mt-6 text-right"><Button onClick={handleNotificationSave} style={getPrimaryButtonStyle(visualSettings)}><Save className="mr-2 h-4 w-4" />{t('common.saveSettings')}</Button></div>
          </motion.div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
