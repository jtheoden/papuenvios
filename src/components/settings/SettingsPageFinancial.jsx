import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DollarSign, Save, Plus, Edit, Trash2, AlertTriangle, ArrowRightLeft, Info, Power, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import {
  getCurrencies, getAllCurrencies, createCurrency, updateCurrency, deleteCurrency,
  fetchOfficialRates, getAllExchangeRates, saveExchangeRate, deleteExchangeRate, deleteExchangeRatePair, updateExchangeRatePair
} from '@/lib/currencyService';
import { supabase } from '@/lib/supabase';

/**
 * Confirmation Modal Component with framer-motion animations
 */
const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText, cancelText, variant = 'default' }) => {
  if (!isOpen) return null;

  const variantStyles = {
    default: {
      icon: <Power className="w-8 h-8 text-blue-500" />,
      confirmBg: 'bg-blue-600 hover:bg-blue-700',
    },
    danger: {
      icon: <AlertTriangle className="w-8 h-8 text-red-500" />,
      confirmBg: 'bg-red-600 hover:bg-red-700',
    },
    success: {
      icon: <Power className="w-8 h-8 text-green-500" />,
      confirmBg: 'bg-green-600 hover:bg-green-700',
    }
  };

  const style = variantStyles[variant] || variantStyles.default;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>

            {/* Icon */}
            <div className="flex justify-center mb-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.1, damping: 15 }}
                className="p-3 rounded-full bg-gray-100"
              >
                {style.icon}
              </motion.div>
            </div>

            {/* Title */}
            <h3 className="text-xl font-bold text-center text-gray-900 mb-2">
              {title}
            </h3>

            {/* Message */}
            <p className="text-gray-600 text-center mb-6">
              {message}
            </p>

            {/* Buttons */}
            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                {cancelText}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={`flex-1 py-2.5 px-4 rounded-lg text-white font-medium transition-colors ${style.confirmBg}`}
              >
                {confirmText}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Financial Settings component
 * Manages profit margins, shipping, currencies, and exchange rates
 */
const SettingsPageFinancial = ({ localFinancial, setLocalFinancial }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  // Currency states
  const [currencies, setCurrencies] = useState([]);
  const [editingCurrency, setEditingCurrency] = useState(null);
  const [currencyForm, setCurrencyForm] = useState({
    code: '', name_es: '', name_en: '', symbol: '', is_base: false
  });
  const [officialRates, setOfficialRates] = useState(null);
  const [loadingRates, setLoadingRates] = useState(false);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    currency: null,
    newStatus: false
  });

  // Filter active currencies for exchange rate selectors
  const activeCurrencies = useMemo(() => {
    return currencies.filter(c => c.is_active);
  }, [currencies]);

  // Exchange rates states
  const [exchangeRates, setExchangeRates] = useState([]);
  const [loadingRates2, setLoadingRates2] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [editingRatePair, setEditingRatePair] = useState(null); // { fromCurrencyId, toCurrencyId, rate, effectiveDate }
  const [newRate, setNewRate] = useState({
    fromCurrencyId: '', toCurrencyId: '', rate: '',
    effectiveDate: new Date().toISOString().split('T')[0]
  });

  // Check if exchange rate pair already exists (including inverse)
  const duplicateRateInfo = useMemo(() => {
    if (!newRate.fromCurrencyId || !newRate.toCurrencyId) return null;

    const existingRate = exchangeRates.find(rate =>
      (rate.from_currency_id === newRate.fromCurrencyId && rate.to_currency_id === newRate.toCurrencyId) ||
      (rate.from_currency_id === newRate.toCurrencyId && rate.to_currency_id === newRate.fromCurrencyId)
    );

    if (existingRate) {
      const fromCurrency = currencies.find(c => c.id === existingRate.from_currency_id);
      const toCurrency = currencies.find(c => c.id === existingRate.to_currency_id);
      return {
        exists: true,
        rate: existingRate,
        fromCode: fromCurrency?.code,
        toCode: toCurrency?.code
      };
    }

    return null;
  }, [newRate.fromCurrencyId, newRate.toCurrencyId, exchangeRates, currencies]);

  // Get currency codes for preview
  const fromCurrency = useMemo(() => currencies.find(c => c.id === newRate.fromCurrencyId), [currencies, newRate.fromCurrencyId]);
  const toCurrency = useMemo(() => currencies.find(c => c.id === newRate.toCurrencyId), [currencies, newRate.toCurrencyId]);
  const inverseRate = useMemo(() => newRate.rate ? (1 / parseFloat(newRate.rate)) : null, [newRate.rate]);

  // Group exchange rates into pairs for display
  const groupedExchangeRates = useMemo(() => {
    const pairs = [];
    const processedPairs = new Set();

    exchangeRates.forEach(rate => {
      // Create a unique key for the pair (sorted to ensure same key for both directions)
      const pairKey = [rate.from_currency_id, rate.to_currency_id].sort().join('-');

      if (processedPairs.has(pairKey)) return;
      processedPairs.add(pairKey);

      // Find the inverse rate if it exists
      const inverseRate = exchangeRates.find(r =>
        r.from_currency_id === rate.to_currency_id &&
        r.to_currency_id === rate.from_currency_id
      );

      pairs.push({
        id: rate.id,
        pairKey,
        directRate: rate,
        inverseRate: inverseRate || null,
        fromCurrency: rate.from_currency,
        toCurrency: rate.to_currency,
        effectiveDate: rate.effective_date
      });
    });

    return pairs;
  }, [exchangeRates]);

  useEffect(() => {
    loadCurrencies();
    loadOfficialRates();
    loadExchangeRates();
  }, []);

  // ===== FINANCIAL HANDLERS =====
  const handleFinancialSave = () => {
    toast({ title: t('settings.saveSuccess') });
  };

  // ===== OFFICIAL RATES HANDLERS =====
  const loadOfficialRates = async () => {
    setLoadingRates(true);
    try {
      const rates = await fetchOfficialRates();
      setOfficialRates(rates || []);
    } catch (error) {
      console.error('Error loading official rates:', error);
      setOfficialRates([]);
    } finally {
      setLoadingRates(false);
    }
  };

  // ===== CURRENCIES HANDLERS =====
  const loadCurrencies = async () => {
    try {
      // Load ALL currencies including inactive ones
      const currencies = await getAllCurrencies();
      setCurrencies(currencies || []);
    } catch (error) {
      console.error('Error loading currencies:', error);
      toast({
        title: t('common.error'),
        description: t('settings.financial.errorLoadingCurrencies'),
        variant: 'destructive'
      });
    }
  };

  const handleCurrencySubmit = async () => {
    if (!currencyForm.code || !currencyForm.name_es || !currencyForm.name_en || !currencyForm.symbol) {
      toast({
        title: t('common.error'),
        description: t('settings.financial.fillAllFields'),
        variant: 'destructive'
      });
      return;
    }

    try {
      if (currencyForm.is_base) {
        await supabase.from('currencies')
          .update({ is_base: false })
          .eq('is_base', true)
          .neq('id', editingCurrency?.id || '00000000-0000-0000-0000-000000000000');
      }

      if (editingCurrency) {
        const { error } = await updateCurrency(editingCurrency.id, currencyForm);
        if (error) throw error;
        toast({
          title: t('settings.financial.currencyUpdated'),
          description: t('settings.financial.currencyUpdatedSuccess')
        });
      } else {
        const { error } = await createCurrency(currencyForm);
        if (error) throw error;
        toast({
          title: t('settings.financial.currencyCreated'),
          description: t('settings.financial.currencyCreatedSuccess')
        });
      }

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

  const handleEditCurrency = (currency) => {
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
    if (!confirm(t('settings.financial.confirmDeleteCurrency'))) {
      return;
    }

    try {
      await supabase.from('exchange_rates')
        .update({ is_active: false })
        .or(`from_currency_id.eq.${currencyId},to_currency_id.eq.${currencyId}`);

      const { error } = await deleteCurrency(currencyId);
      if (error) throw error;

      toast({
        title: t('settings.financial.currencyDeleted')
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

  // Open confirmation modal for toggle
  const handleToggleCurrencyClick = (currency) => {
    setConfirmModal({
      isOpen: true,
      currency,
      newStatus: !currency.is_active
    });
  };

  // Execute the actual toggle after confirmation
  const handleToggleCurrencyConfirm = async () => {
    const { currency, newStatus } = confirmModal;
    if (!currency) return;

    try {
      await updateCurrency(currency.id, { is_active: newStatus });
      toast({
        title: newStatus
          ? t('settings.financial.currencyActivated')
          : t('settings.financial.currencyDeactivated'),
        description: `${currency.code} - ${language === 'es' ? currency.name_es : currency.name_en}`
      });
      await loadCurrencies();
    } catch (error) {
      console.error('Error toggling currency status:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // Close the confirmation modal
  const handleCloseConfirmModal = () => {
    setConfirmModal({ isOpen: false, currency: null, newStatus: false });
  };

  // ===== EXCHANGE RATES HANDLERS =====
  const loadExchangeRates = async () => {
    setLoadingRates2(true);
    try {
      const rates = await getAllExchangeRates();
      setExchangeRates(rates || []);
    } catch (error) {
      console.error('Error loading exchange rates:', error);
      setExchangeRates([]);
    } finally {
      setLoadingRates2(false);
    }
  };

  const handleSaveRate = async () => {
    if (!newRate.fromCurrencyId || !newRate.toCurrencyId || !newRate.rate) {
      toast({
        title: t('settings.financial.incompleteData'),
        description: t('settings.financial.fillAllFields'),
        variant: 'destructive'
      });
      return;
    }

    if (newRate.fromCurrencyId === newRate.toCurrencyId) {
      toast({
        title: t('common.error'),
        description: t('settings.financial.currenciesMustBeDifferent'),
        variant: 'destructive'
      });
      return;
    }

    // Check for duplicate exchange rate pair
    if (duplicateRateInfo) {
      toast({
        title: t('common.error'),
        description: language === 'es'
          ? `Ya existe una tasa de cambio para ${duplicateRateInfo.fromCode}/${duplicateRateInfo.toCode}. Elimínala primero si deseas crear una nueva.`
          : `An exchange rate already exists for ${duplicateRateInfo.fromCode}/${duplicateRateInfo.toCode}. Delete it first if you want to create a new one.`,
        variant: 'destructive'
      });
      return;
    }

    try {
      const result = await saveExchangeRate(newRate);
      if (result.error) throw result.error;

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
        fromCurrencyId: '', toCurrencyId: '', rate: '',
        effectiveDate: new Date().toISOString().split('T')[0]
      });

      toast({
        title: t('settings.financial.ratesSaved')
      });
    } catch (error) {
      console.error('Error saving rate:', error);
      toast({
        title: t('settings.financial.saveError'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteRate = async (rateId) => {
    if (!confirm(t('settings.financial.confirmDeleteRate'))) {
      return;
    }

    try {
      const result = await deleteExchangeRate(rateId);
      if (result.error) throw result.error;

      await loadExchangeRates();
      toast({
        title: t('settings.financial.rateDeleted')
      });
    } catch (error) {
      console.error('Error deleting rate:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // Delete exchange rate pair (both direct and inverse)
  const handleDeleteRatePair = async (fromCurrencyId, toCurrencyId) => {
    const confirmMessage = language === 'es'
      ? '¿Eliminar este par de tasas de cambio? Se eliminarán ambas direcciones (directa e inversa).'
      : 'Delete this exchange rate pair? Both directions (direct and inverse) will be removed.';

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const result = await deleteExchangeRatePair(fromCurrencyId, toCurrencyId);
      if (result.error) throw result.error;

      await loadExchangeRates();
      toast({
        title: language === 'es' ? 'Par de tasas eliminado' : 'Rate pair deleted',
        description: language === 'es'
          ? `Se eliminaron ${result.deletedCount} tasas de cambio`
          : `${result.deletedCount} exchange rates removed`
      });
    } catch (error) {
      console.error('Error deleting rate pair:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // Start editing a rate pair
  const handleEditRatePair = (pair) => {
    setEditingRatePair({
      fromCurrencyId: pair.directRate.from_currency_id,
      toCurrencyId: pair.directRate.to_currency_id,
      rate: pair.directRate.rate,
      effectiveDate: pair.effectiveDate || new Date().toISOString().split('T')[0],
      fromCurrency: pair.fromCurrency,
      toCurrency: pair.toCurrency
    });
    setShowAddRate(false);
  };

  // Update exchange rate pair (both direct and inverse)
  const handleUpdateRatePair = async () => {
    if (!editingRatePair || !editingRatePair.rate) {
      toast({
        title: t('common.error'),
        description: t('settings.financial.fillAllFields'),
        variant: 'destructive'
      });
      return;
    }

    try {
      const result = await updateExchangeRatePair(
        editingRatePair.fromCurrencyId,
        editingRatePair.toCurrencyId,
        editingRatePair.rate,
        editingRatePair.effectiveDate
      );
      if (result.error) throw result.error;

      await loadExchangeRates();
      setEditingRatePair(null);
      toast({
        title: language === 'es' ? 'Par de tasas actualizado' : 'Rate pair updated',
        description: language === 'es'
          ? 'Se actualizaron ambas tasas (directa e inversa)'
          : 'Both rates updated (direct and inverse)'
      });
    } catch (error) {
      console.error('Error updating rate pair:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  // Cancel editing rate pair
  const handleCancelEditRatePair = () => {
    setEditingRatePair(null);
  };

  return (
    <>
      {/* Financial Settings Section */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
        <h2 className="text-2xl font-semibold mb-6 flex items-center">
          <DollarSign className="mr-3 text-blue-600" />
          {t('settings.financial.title')}
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-8">
          <div>
            <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.usdToLocal')}</label>
            <input
              type="number"
              value={localFinancial.usdToLocal}
              onChange={e => setLocalFinancial({ ...localFinancial, usdToLocal: parseFloat(e.target.value) })}
              placeholder="0.00"
              className="input-style w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.productProfit')}</label>
            <input
              type="number"
              value={localFinancial.productProfit}
              onChange={e => setLocalFinancial({ ...localFinancial, productProfit: parseFloat(e.target.value) })}
              placeholder="%"
              className="input-style w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.comboProfit')}</label>
            <input
              type="number"
              value={localFinancial.comboProfit}
              onChange={e => setLocalFinancial({ ...localFinancial, comboProfit: parseFloat(e.target.value) })}
              placeholder="%"
              className="input-style w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 truncate">{t('settings.financial.remittanceProfit')}</label>
            <input
              type="number"
              value={localFinancial.remittanceProfit}
              onChange={e => setLocalFinancial({ ...localFinancial, remittanceProfit: parseFloat(e.target.value) })}
              placeholder="%"
              className="input-style w-full"
            />
          </div>
        </div>

        {/* Shipping Configuration */}
        <div className="border-t pt-6 mb-6">
          <h3 className="text-xl font-semibold mb-4">
            {t('settings.financial.shippingConfig')}
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">
                {t('settings.financial.shippingType')}
              </label>
              <select
                value={localFinancial.shippingType || 'undetermined'}
                onChange={e => setLocalFinancial({ ...localFinancial, shippingType: e.target.value })}
                className="input-style w-full"
              >
                <option value="free">{t('settings.financial.shippingFree')}</option>
                <option value="fixed">{t('settings.financial.shippingFixed')}</option>
                <option value="undetermined">{t('settings.financial.shippingUndetermined')}</option>
                <option value="calculated">{t('settings.financial.shippingCalculated')}</option>
              </select>
            </div>

            {localFinancial.shippingType === 'fixed' && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.financial.fixedShippingCost')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={localFinancial.shippingFixedAmount || 0}
                  onChange={e => setLocalFinancial({ ...localFinancial, shippingFixedAmount: parseFloat(e.target.value) })}
                  placeholder="0.00"
                  className="input-style w-full"
                />
              </div>
            )}

            {(localFinancial.shippingType === 'calculated' || localFinancial.shippingType === 'undetermined') && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.financial.freeShippingThreshold')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={localFinancial.shippingFreeThreshold || 100}
                  onChange={e => setLocalFinancial({ ...localFinancial, shippingFreeThreshold: parseFloat(e.target.value) })}
                  placeholder="100.00"
                  className="input-style w-full"
                />
              </div>
            )}
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-gray-700">
            {localFinancial.shippingType === 'free' && t('settings.financial.shippingInfoFree')}
            {localFinancial.shippingType === 'fixed' && t('settings.financial.shippingInfoFixed')}
            {localFinancial.shippingType === 'undetermined' && t('settings.financial.shippingInfoUndetermined')}
            {localFinancial.shippingType === 'calculated' && t('settings.financial.shippingInfoCalculated')}
          </div>
        </div>

        {/* Currencies Section */}
        <div className="border-t pt-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
            <h3 className="text-xl font-semibold">{t('settings.financial.currencies')}</h3>
            <Button
              onClick={loadOfficialRates}
              disabled={loadingRates}
              variant="outline"
              size="sm"
              className="h-8 px-2 sm:px-3"
              title={t('settings.financial.loadOfficialRates')}
            >
              <DollarSign className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{loadingRates ? t('common.loading') : t('settings.financial.loadOfficialRates')}</span>
            </Button>
          </div>

          {officialRates && (
            <div className="bg-green-50 p-4 rounded-lg mb-4">
              <h4 className="font-semibold text-green-800 mb-2">
                {t('settings.financial.officialRatesReference')}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
                {Object.entries(officialRates).map(([code, rate]) => (
                  <div key={code} className="bg-white p-2 rounded flex justify-between">
                    <span className="font-bold">{code}:</span>
                    <span className="font-mono">{Number(rate).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 mb-6">
            {currencies.map(currency => (
              <div
                key={currency.id}
                className={`flex flex-wrap sm:flex-nowrap items-center gap-2 p-3 rounded-lg transition-colors ${
                  currency.is_active
                    ? 'bg-gray-50 hover:bg-gray-100'
                    : 'bg-gray-100 opacity-60 border border-dashed border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={`font-bold w-12 sm:w-16 shrink-0 ${!currency.is_active ? 'text-gray-400' : ''}`}>
                    {currency.code}
                  </span>
                  <span className={`truncate flex-1 text-sm sm:text-base ${!currency.is_active ? 'text-gray-400' : ''}`}>
                    {language === 'es' ? currency.name_es : currency.name_en}
                  </span>
                  <span className={`w-8 sm:w-12 text-center shrink-0 ${!currency.is_active ? 'text-gray-400' : ''}`}>
                    {currency.symbol}
                  </span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                  {/* Inactive badge */}
                  {!currency.is_active && (
                    <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded font-semibold whitespace-nowrap">
                      {language === 'es' ? 'Inactiva' : 'Inactive'}
                    </span>
                  )}
                  {/* Base currency badge */}
                  {currency.is_base && (
                    <span className="text-xs text-white px-2 py-1 rounded font-semibold whitespace-nowrap" style={{
                      background: visualSettings.useGradient
                        ? `linear-gradient(to right, ${visualSettings.primaryColor}, ${visualSettings.secondaryColor})`
                        : visualSettings.primaryColor
                    }}>
                      {t('settings.financial.base')}
                    </span>
                  )}
                  <div className="flex gap-1 shrink-0">
                    {/* Toggle active/inactive button */}
                    <Button
                      variant={currency.is_active ? 'outline' : 'default'}
                      size="icon"
                      className={`h-8 w-8 ${!currency.is_active ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                      onClick={() => handleToggleCurrencyClick(currency)}
                      title={currency.is_active
                        ? (language === 'es' ? 'Desactivar moneda' : 'Deactivate currency')
                        : (language === 'es' ? 'Activar moneda' : 'Activate currency')
                      }
                    >
                      <Power className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
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

          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="text-lg font-semibold mb-3">
              {editingCurrency ? t('settings.financial.editCurrency') : t('settings.financial.newCurrency')}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t('settings.financial.code')}</label>
                <input
                  value={currencyForm.code}
                  onChange={e => setCurrencyForm({ ...currencyForm, code: e.target.value.toUpperCase() })}
                  placeholder="USD"
                  className="input-style w-full"
                  maxLength={3}
                  disabled={editingCurrency !== null}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('settings.financial.nameES')}</label>
                <input
                  value={currencyForm.name_es}
                  onChange={e => setCurrencyForm({ ...currencyForm, name_es: e.target.value })}
                  placeholder="Dólar"
                  className="input-style w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('settings.financial.nameEN')}</label>
                <input
                  value={currencyForm.name_en}
                  onChange={e => setCurrencyForm({ ...currencyForm, name_en: e.target.value })}
                  placeholder="Dollar"
                  className="input-style w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('settings.financial.symbol')}</label>
                <input
                  value={currencyForm.symbol}
                  onChange={e => setCurrencyForm({ ...currencyForm, symbol: e.target.value })}
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
                  onChange={e => setCurrencyForm({ ...currencyForm, is_base: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm font-medium">
                  {t('settings.financial.baseCurrency')}
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCurrencySubmit} className="flex-1 h-9" style={getPrimaryButtonStyle(visualSettings)}>
                {editingCurrency
                  ? <><Save className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">{t('settings.financial.updateCurrency')}</span></>
                  : <><Plus className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">{t('settings.financial.addCurrency')}</span></>
                }
              </Button>
              {editingCurrency && (
                <Button variant="outline" onClick={handleCancelEdit} className="h-9 px-3">
                  <span className="hidden sm:inline">{t('common.cancel')}</span>
                  <span className="sm:hidden">✕</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-right">
          <Button onClick={handleFinancialSave} style={getPrimaryButtonStyle(visualSettings)} className="h-9 px-3">
            <Save className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('common.saveSettings')}</span>
          </Button>
        </div>
      </motion.div>

      {/* Exchange Rates Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass-effect p-6 rounded-2xl mt-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h3 className="text-xl sm:text-2xl font-bold" style={getHeadingStyle(visualSettings)}>
            {t('settings.financial.exchangeRates')}
          </h3>
          <Button
            onClick={() => setShowAddRate(!showAddRate)}
            style={getPrimaryButtonStyle(visualSettings)}
            className="h-8 px-2 sm:px-3"
            title={t('settings.financial.newRate')}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('settings.financial.newRate')}</span>
          </Button>
        </div>

        {showAddRate && (
          <div className="bg-blue-50 p-4 rounded-lg mb-6">
            <h4 className="text-lg font-semibold mb-3">
              {t('settings.financial.addNewExchangeRate')}
            </h4>

            {/* Info box explaining how exchange rates work */}
            <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 mb-4 flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                {language === 'es' ? (
                  <>
                    <strong>Ejemplo:</strong> Si 1 USD = 430 CUP, ingresa 430 como tasa.
                    El sistema creará automáticamente la tasa inversa (1 CUP = 0.0023 USD).
                    <br />
                    <span className="text-blue-600 mt-1 block">Solo se permite una tasa por par de monedas.</span>
                  </>
                ) : (
                  <>
                    <strong>Example:</strong> If 1 USD = 430 CUP, enter 430 as the rate.
                    The system will automatically create the inverse rate (1 CUP = 0.0023 USD).
                    <br />
                    <span className="text-blue-600 mt-1 block">Only one rate per currency pair is allowed.</span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('settings.financial.fromCurrency')}
                </label>
                <select
                  value={newRate.fromCurrencyId}
                  onChange={e => setNewRate({ ...newRate, fromCurrencyId: e.target.value })}
                  className="input-style w-full"
                >
                  <option value="">{t('settings.financial.select')}</option>
                  {activeCurrencies.filter(c => c.id !== newRate.toCurrencyId).map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {language === 'es' ? c.name_es : c.name_en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('settings.financial.toCurrency')}
                </label>
                <select
                  value={newRate.toCurrencyId}
                  onChange={e => setNewRate({ ...newRate, toCurrencyId: e.target.value })}
                  className="input-style w-full"
                >
                  <option value="">{t('settings.financial.select')}</option>
                  {activeCurrencies.filter(c => c.id !== newRate.fromCurrencyId).map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {language === 'es' ? c.name_es : c.name_en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('settings.financial.rate')}
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={newRate.rate}
                  onChange={e => setNewRate({ ...newRate, rate: e.target.value })}
                  placeholder="1.0000"
                  className="input-style w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('settings.financial.effectiveDate')}
                </label>
                <input
                  type="date"
                  value={newRate.effectiveDate}
                  onChange={e => setNewRate({ ...newRate, effectiveDate: e.target.value })}
                  className="input-style w-full"
                />
              </div>
            </div>

            {/* Visual preview of the rate and its inverse */}
            {fromCurrency && toCurrency && newRate.rate && (
              <div className="bg-white border border-blue-200 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  <ArrowRightLeft className="h-4 w-4 text-blue-600" />
                  {language === 'es' ? 'Vista previa de conversión:' : 'Conversion preview:'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-green-50 border border-green-200 rounded p-2">
                    <span className="font-mono text-green-800">
                      1 {fromCurrency.code} = {parseFloat(newRate.rate).toFixed(4)} {toCurrency.code}
                    </span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded p-2">
                    <span className="font-mono text-blue-800">
                      1 {toCurrency.code} = {inverseRate?.toFixed(6)} {fromCurrency.code}
                    </span>
                    <span className="text-xs text-blue-600 ml-2">({language === 'es' ? 'inversa automática' : 'auto inverse'})</span>
                  </div>
                </div>
              </div>
            )}

            {/* Warning for duplicate rate */}
            {duplicateRateInfo && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800">
                  <strong>{language === 'es' ? 'Tasa existente:' : 'Existing rate:'}</strong>{' '}
                  {language === 'es'
                    ? `Ya existe una tasa para ${duplicateRateInfo.fromCode}/${duplicateRateInfo.toCode} (${Number(duplicateRateInfo.rate.rate).toFixed(4)}). Elimínala primero si deseas crear una nueva.`
                    : `A rate for ${duplicateRateInfo.fromCode}/${duplicateRateInfo.toCode} already exists (${Number(duplicateRateInfo.rate.rate).toFixed(4)}). Delete it first to create a new one.`
                  }
                </div>
              </div>
            )}

            <Button
              onClick={handleSaveRate}
              style={duplicateRateInfo ? undefined : getPrimaryButtonStyle(visualSettings)}
              className="h-9 px-3"
              disabled={!!duplicateRateInfo}
              variant={duplicateRateInfo ? 'secondary' : 'default'}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('settings.financial.saveRates')}</span>
            </Button>
          </div>
        )}

        {/* Edit Exchange Rate Pair Form */}
        {editingRatePair && (
          <div className="bg-amber-50 p-4 rounded-lg mb-6 border border-amber-200">
            <h4 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Edit className="h-5 w-5 text-amber-600" />
              {language === 'es' ? 'Editar Par de Tasas' : 'Edit Rate Pair'}
              <span className="text-sm font-normal text-gray-600">
                ({editingRatePair.fromCurrency?.code} ↔ {editingRatePair.toCurrency?.code})
              </span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {language === 'es' ? 'Nueva Tasa' : 'New Rate'} (1 {editingRatePair.fromCurrency?.code} = ? {editingRatePair.toCurrency?.code})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={editingRatePair.rate}
                  onChange={e => setEditingRatePair({ ...editingRatePair, rate: e.target.value })}
                  placeholder="1.0000"
                  className="input-style w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('settings.financial.effectiveDate')}
                </label>
                <input
                  type="date"
                  value={editingRatePair.effectiveDate}
                  onChange={e => setEditingRatePair({ ...editingRatePair, effectiveDate: e.target.value })}
                  className="input-style w-full"
                />
              </div>
            </div>

            {/* Preview of changes */}
            {editingRatePair.rate && (
              <div className="bg-white border border-amber-200 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                  {language === 'es' ? 'Vista previa de cambios:' : 'Preview of changes:'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-green-50 border border-green-200 rounded p-2">
                    <span className="font-mono text-green-800">
                      1 {editingRatePair.fromCurrency?.code} = {parseFloat(editingRatePair.rate).toFixed(4)} {editingRatePair.toCurrency?.code}
                    </span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded p-2">
                    <span className="font-mono text-blue-800">
                      1 {editingRatePair.toCurrency?.code} = {(1 / parseFloat(editingRatePair.rate)).toFixed(6)} {editingRatePair.fromCurrency?.code}
                    </span>
                    <span className="text-xs text-blue-600 ml-2">({language === 'es' ? 'inversa automática' : 'auto inverse'})</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleUpdateRatePair}
                style={getPrimaryButtonStyle(visualSettings)}
                className="h-9 px-3"
              >
                <Save className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{language === 'es' ? 'Guardar Cambios' : 'Save Changes'}</span>
              </Button>
              <Button
                onClick={handleCancelEditRatePair}
                variant="outline"
                className="h-9 px-3"
              >
                <span>{language === 'es' ? 'Cancelar' : 'Cancel'}</span>
              </Button>
            </div>
          </div>
        )}

        {loadingRates2 ? (
          <p className="text-center py-8 text-gray-500">{t('common.loading')}</p>
        ) : groupedExchangeRates.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <ArrowRightLeft className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>{language === 'es' ? 'No hay tasas de cambio configuradas' : 'No exchange rates configured'}</p>
            <p className="text-sm mt-2">
              {language === 'es'
                ? 'Haz clic en "Nueva tasa" para agregar un par de tasas de cambio'
                : 'Click "New rate" to add an exchange rate pair'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedExchangeRates.map(pair => (
              <div key={pair.pairKey} className="border rounded-lg p-4 bg-white hover:bg-gray-50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-lg">{pair.fromCurrency?.code}</span>
                      <ArrowRightLeft className="h-4 w-4 text-gray-400" />
                      <span className="font-bold text-lg">{pair.toCurrency?.code}</span>
                    </div>

                    {/* Direct rate */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="bg-green-50 border border-green-200 rounded p-2">
                        <span className="text-xs text-green-600 block mb-1">
                          {language === 'es' ? 'Tasa directa' : 'Direct rate'}
                        </span>
                        <span className="font-mono text-green-800">
                          1 {pair.fromCurrency?.code} = {Number(pair.directRate.rate).toFixed(4)} {pair.toCurrency?.code}
                        </span>
                      </div>

                      {/* Inverse rate */}
                      {pair.inverseRate ? (
                        <div className="bg-blue-50 border border-blue-200 rounded p-2">
                          <span className="text-xs text-blue-600 block mb-1">
                            {language === 'es' ? 'Tasa inversa' : 'Inverse rate'}
                          </span>
                          <span className="font-mono text-blue-800">
                            1 {pair.toCurrency?.code} = {Number(pair.inverseRate.rate).toFixed(6)} {pair.fromCurrency?.code}
                          </span>
                        </div>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded p-2">
                          <span className="text-xs text-amber-600 block mb-1">
                            {language === 'es' ? 'Tasa inversa' : 'Inverse rate'}
                          </span>
                          <span className="text-amber-700 text-sm">
                            {language === 'es' ? 'No configurada' : 'Not configured'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-gray-500">
                      {language === 'es' ? 'Vigente desde: ' : 'Effective: '}
                      {new Date(pair.effectiveDate).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditRatePair(pair)}
                      title={language === 'es' ? 'Editar par de tasas' : 'Edit rate pair'}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">
                        {language === 'es' ? 'Editar' : 'Edit'}
                      </span>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteRatePair(pair.directRate.from_currency_id, pair.directRate.to_currency_id)}
                      title={language === 'es' ? 'Eliminar par de tasas' : 'Delete rate pair'}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">
                        {language === 'es' ? 'Eliminar' : 'Delete'}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Currency Toggle Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={handleCloseConfirmModal}
        onConfirm={handleToggleCurrencyConfirm}
        title={
          confirmModal.newStatus
            ? t('settings.financial.activateCurrency')
            : t('settings.financial.deactivateCurrency')
        }
        message={
          confirmModal.newStatus
            ? t('settings.financial.activateCurrencyMessage').replace('{code}', confirmModal.currency?.code || '')
            : t('settings.financial.deactivateCurrencyMessage').replace('{code}', confirmModal.currency?.code || '')
        }
        confirmText={
          confirmModal.newStatus
            ? t('settings.financial.activate')
            : t('settings.financial.deactivate')
        }
        cancelText={t('common.cancel')}
        variant={confirmModal.newStatus ? 'success' : 'danger'}
      />
    </>
  );
};

export default SettingsPageFinancial;
