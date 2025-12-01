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
        description: language === 'es' ? 'Error al cargar monedas' : 'Error loading currencies',
        variant: 'destructive'
      });
    }
  };

  const handleCurrencySubmit = async () => {
    if (!currencyForm.code || !currencyForm.name_es || !currencyForm.name_en || !currencyForm.symbol) {
      toast({
        title: 'Error',
        description: language === 'es' ? 'Por favor complete todos los campos' : 'Please fill all fields',
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
          title: language === 'es' ? 'Moneda actualizada' : 'Currency Updated',
          description: language === 'es' ? 'La moneda se actualizó exitosamente' : 'Currency was updated successfully'
        });
      } else {
        const { error } = await createCurrency(currencyForm);
        if (error) throw error;
        toast({
          title: language === 'es' ? 'Moneda creada' : 'Currency Created',
          description: language === 'es' ? 'La moneda se creó exitosamente' : 'Currency was created successfully'
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
    if (!confirm(language === 'es'
      ? '¿Está seguro de que desea eliminar esta moneda?'
      : 'Are you sure you want to delete this currency?')) {
      return;
    }

    try {
      await supabase.from('exchange_rates')
        .update({ is_active: false })
        .or(`from_currency_id.eq.${currencyId},to_currency_id.eq.${currencyId}`);

      const { error } = await deleteCurrency(currencyId);
      if (error) throw error;

      toast({
        title: language === 'es' ? 'Moneda eliminada' : 'Currency Deleted'
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
        title: language === 'es' ? 'Datos incompletos' : 'Incomplete data',
        description: language === 'es' ? 'Por favor complete todos los campos' : 'Please fill all fields',
        variant: 'destructive'
      });
      return;
    }

    if (newRate.fromCurrencyId === newRate.toCurrencyId) {
      toast({
        title: 'Error',
        description: language === 'es' ? 'Las monedas deben ser diferentes' : 'Currencies must be different',
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
        title: language === 'es' ? '✅ Tasas guardadas' : '✅ Rates saved'
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
            {language === 'es' ? 'Configuración de Envío' : 'Shipping Configuration'}
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Tipo de Envío' : 'Shipping Type'}
              </label>
              <select
                value={localFinancial.shippingType || 'undetermined'}
                onChange={e => setLocalFinancial({ ...localFinancial, shippingType: e.target.value })}
                className="input-style w-full"
              >
                <option value="free">{language === 'es' ? 'Gratis' : 'Free'}</option>
                <option value="fixed">{language === 'es' ? 'Tarifa Fija' : 'Fixed Rate'}</option>
                <option value="undetermined">{language === 'es' ? 'Por Determinar (según ubicación)' : 'To Be Determined (based on location)'}</option>
                <option value="calculated">{language === 'es' ? 'Calculado (con umbral gratis)' : 'Calculated (with free threshold)'}</option>
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
                  onChange={e => setLocalFinancial({ ...localFinancial, shippingFixedAmount: parseFloat(e.target.value) })}
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
                  onChange={e => setLocalFinancial({ ...localFinancial, shippingFreeThreshold: parseFloat(e.target.value) })}
                  placeholder="100.00"
                  className="input-style w-full"
                />
              </div>
            )}
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-gray-700">
            {localFinancial.shippingType === 'free' && (language === 'es' ? '✓ Envío gratis: No se cobrará envío en ningún pedido' : '✓ Free shipping: No shipping charge on any order')}
            {localFinancial.shippingType === 'fixed' && (language === 'es' ? '✓ Tarifa fija: Se cobrará el mismo monto de envío en todos los pedidos' : '✓ Fixed rate: Same shipping amount will be charged on all orders')}
            {localFinancial.shippingType === 'undetermined' && (language === 'es' ? '⚠ Por determinar: El costo de envío se mostrará como "Por determinar" y se calculará según la ubicación del destinatario' : '⚠ To be determined: Shipping cost will show as "To be determined" and will be calculated based on recipient location')}
            {localFinancial.shippingType === 'calculated' && (language === 'es' ? '⚠ Calculado: Envío gratis si el pedido supera el umbral, de lo contrario se determinará según ubicación' : '⚠ Calculated: Free shipping if order exceeds threshold, otherwise determined by location')}
          </div>
        </div>

        {/* Currencies Section */}
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
              {loadingRates ? (language === 'es' ? 'Cargando...' : 'Loading...') : (language === 'es' ? 'Cargar Tasas Oficiales' : 'Load Official Rates')}
            </Button>
          </div>

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

          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="text-lg font-semibold mb-3">
              {editingCurrency ? (language === 'es' ? 'Editar Moneda' : 'Edit Currency') : (language === 'es' ? 'Nueva Moneda' : 'New Currency')}
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
                  {language === 'es' ? 'Moneda Base' : 'Base Currency'}
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
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-right">
          <Button onClick={handleFinancialSave} style={getPrimaryButtonStyle(visualSettings)}>
            <Save className="mr-2 h-4 w-4" />
            {t('settings.financial.save')}
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

        {showAddRate && (
          <div className="bg-blue-50 p-4 rounded-lg mb-6">
            <h4 className="text-lg font-semibold mb-3">
              {language === 'es' ? 'Agregar Nueva Tasa de Cambio' : 'Add New Exchange Rate'}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {language === 'es' ? 'De Moneda' : 'From Currency'}
                </label>
                <select
                  value={newRate.fromCurrencyId}
                  onChange={e => setNewRate({ ...newRate, fromCurrencyId: e.target.value })}
                  className="input-style w-full"
                >
                  <option value="">{language === 'es' ? 'Seleccionar' : 'Select'}</option>
                  {currencies.map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {language === 'es' ? c.name_es : c.name_en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {language === 'es' ? 'A Moneda' : 'To Currency'}
                </label>
                <select
                  value={newRate.toCurrencyId}
                  onChange={e => setNewRate({ ...newRate, toCurrencyId: e.target.value })}
                  className="input-style w-full"
                >
                  <option value="">{language === 'es' ? 'Seleccionar' : 'Select'}</option>
                  {currencies.map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {language === 'es' ? c.name_es : c.name_en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {language === 'es' ? 'Tasa' : 'Rate'}
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
                  {language === 'es' ? 'Efectiva Desde' : 'Effective Date'}
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
              {language === 'es' ? 'Guardar Tasas' : 'Save Rates'}
            </Button>
          </div>
        )}

        {loadingRates2 ? (
          <p className="text-center py-8 text-gray-500">{language === 'es' ? 'Cargando...' : 'Loading...'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-left">{language === 'es' ? 'De' : 'From'}</th>
                  <th className="p-2 text-left">{language === 'es' ? 'A' : 'To'}</th>
                  <th className="p-2 text-left">{language === 'es' ? 'Tasa' : 'Rate'}</th>
                  <th className="p-2 text-left">{language === 'es' ? 'Efectiva Desde' : 'Effective'}</th>
                  <th className="p-2 text-right">{language === 'es' ? 'Acciones' : 'Actions'}</th>
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
