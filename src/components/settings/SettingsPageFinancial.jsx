import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Save, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { getPrimaryButtonStyle, getHeadingStyle } from '@/lib/styleUtils';
import { toast } from '@/components/ui/use-toast';
import {
  getCurrencies, createCurrency, updateCurrency, deleteCurrency,
  fetchOfficialRates, getAllExchangeRates, saveExchangeRate, deleteExchangeRate
} from '@/lib/currencyService';
import { supabase } from '@/lib/supabase';

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

  // Exchange rates states
  const [exchangeRates, setExchangeRates] = useState([]);
  const [loadingRates2, setLoadingRates2] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [newRate, setNewRate] = useState({
    fromCurrencyId: '', toCurrencyId: '', rate: '',
    effectiveDate: new Date().toISOString().split('T')[0]
  });

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
      const currencies = await getCurrencies();
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

  return (
    <>
      {/* Financial Settings Section */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-effect p-8 rounded-2xl">
        <h2 className="text-2xl font-semibold mb-6 flex items-center">
          <DollarSign className="mr-3 text-blue-600" />
          {t('settings.financial.title')}
        </h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <input
            type="number"
            value={localFinancial.usdToLocal}
            onChange={e => setLocalFinancial({ ...localFinancial, usdToLocal: parseFloat(e.target.value) })}
            placeholder={t('settings.financial.usdToLocal')}
            className="input-style"
          />
          <input
            type="number"
            value={localFinancial.productProfit}
            onChange={e => setLocalFinancial({ ...localFinancial, productProfit: parseFloat(e.target.value) })}
            placeholder={t('settings.financial.productProfit')}
            className="input-style"
          />
          <input
            type="number"
            value={localFinancial.comboProfit}
            onChange={e => setLocalFinancial({ ...localFinancial, comboProfit: parseFloat(e.target.value) })}
            placeholder={t('settings.financial.comboProfit')}
            className="input-style"
          />
          <input
            type="number"
            value={localFinancial.remittanceProfit}
            onChange={e => setLocalFinancial({ ...localFinancial, remittanceProfit: parseFloat(e.target.value) })}
            placeholder={t('settings.financial.remittanceProfit')}
            className="input-style"
          />
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
              <div key={currency.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <span className="font-bold w-16">{currency.code}</span>
                <span className="flex-1">{language === 'es' ? currency.name_es : currency.name_en}</span>
                <span className="w-12 text-center">{currency.symbol}</span>
                {currency.is_base && (
                  <span className="text-xs text-white px-2 py-1 rounded font-semibold" style={{
                    background: visualSettings.useGradient
                      ? `linear-gradient(to right, ${visualSettings.primaryColor}, ${visualSettings.secondaryColor})`
                      : visualSettings.primaryColor
                  }}>
                    {t('settings.financial.base')}
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
              <Button onClick={handleCurrencySubmit} className="flex-1" style={getPrimaryButtonStyle(visualSettings)}>
                {editingCurrency
                  ? <><Save className="h-4 w-4 mr-2" />{t('settings.financial.updateCurrency')}</>
                  : <><Plus className="h-4 w-4 mr-2" />{t('settings.financial.addCurrency')}</>
                }
              </Button>
              {editingCurrency && (
                <Button variant="outline" onClick={handleCancelEdit}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-right">
          <Button onClick={handleFinancialSave} style={getPrimaryButtonStyle(visualSettings)}>
            <Save className="mr-2 h-4 w-4" />
            {t('common.saveSettings')}
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
                  {currencies.map(c => (
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
                  {currencies.map(c => (
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
            <Button onClick={handleSaveRate} style={getPrimaryButtonStyle(visualSettings)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('settings.financial.saveRates')}
            </Button>
          </div>
        )}

        {loadingRates2 ? (
          <p className="text-center py-8 text-gray-500">{t('common.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">{t('settings.financial.from')}</th>
                  <th className="p-2 text-left">{t('settings.financial.to')}</th>
                  <th className="p-2 text-left">{t('settings.financial.rate')}</th>
                  <th className="p-2 text-left">{t('settings.financial.effective')}</th>
                  <th className="p-2 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {exchangeRates.map(rate => (
                  <tr key={rate.id} className="hover:bg-gray-50">
                    <td className="p-2">{rate.from_currency?.code}</td>
                    <td className="p-2">{rate.to_currency?.code}</td>
                    <td className="p-2 font-mono">{Number(rate.rate).toFixed(4)}</td>
                    <td className="p-2">{new Date(rate.effective_date).toLocaleDateString()}</td>
                    <td className="p-2 text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteRate(rate.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </>
  );
};

export default SettingsPageFinancial;
