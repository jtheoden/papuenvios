import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit, Save, AlertCircle, AlertTriangle, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createCombo, updateCombo as updateComboDB } from '@/lib/comboService';
import { calculateComboPrices, checkComboStockIssues } from '@/lib/comboUtils';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';

/**
 * Vendor Combos Tab Component
 * Manages product combos with currency conversion and stock validation
 */
const VendorCombosTab = ({
  combos,
  products,
  currencies,
  visualSettings,
  financialSettings,
  exchangeRates,
  selectedCurrency,
  onSelectedCurrencyChange,
  onCombosRefresh
}) => {
  const { t, language } = useLanguage();

  const [comboForm, setComboForm] = useState(null);
  const [comboImagePreview, setComboImagePreview] = useState(null);

  const openNewComboForm = () => {
    setComboForm({
      id: null,
      name: '',
      profitMargin: '',
      shipping: { type: 'paid', value: 0 },
      products: [],
      productQuantities: {},
      image: ''
    });
    setComboImagePreview(null);
  };

  const openEditComboForm = (combo) => {
    const productQuantities = {};
    const productIds = [];

    if (combo.items && combo.items.length > 0) {
      combo.items.forEach(item => {
        productIds.push(item.product.id);
        productQuantities[item.product.id] = item.quantity || 1;
      });
    }

    setComboForm({
      ...combo,
      products: productIds,
      productQuantities: productQuantities
    });
    setComboImagePreview(combo.image_url || combo.image || null);
  };

  const handleComboImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateAndProcessImage(file, 'combo');

      if (!result.success) {
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      setComboImagePreview(result.base64);
      setComboForm(prev => ({ ...prev, image: result.base64 }));

      toast({
        title: 'Imagen optimizada',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions} (${result.metadata.compression} compresión)`,
      });
    } catch (error) {
      console.error('Error processing combo image:', error);
      toast({
        title: 'Error al procesar imagen',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleComboProductToggle = (productId) => {
    setComboForm(prev => {
      const isRemoving = prev.products.includes(productId);
      const products = isRemoving
        ? prev.products.filter(id => id !== productId)
        : [...prev.products, productId];

      const productQuantities = { ...prev.productQuantities };

      if (isRemoving) {
        delete productQuantities[productId];
      } else {
        productQuantities[productId] = 1;
      }

      return { ...prev, products, productQuantities };
    });
  };

  const handleComboProductQuantityChange = (productId, quantity) => {
    setComboForm(prev => ({
      ...prev,
      productQuantities: {
        ...prev.productQuantities,
        [productId]: parseInt(quantity) || 1
      }
    }));
  };

  const handleComboSubmit = async () => {
    if (!comboForm.name) {
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    try {
      const productsWithQuantities = (comboForm.products || []).map(productId => ({
        productId,
        quantity: comboForm.productQuantities[productId] || 1
      }));

      const comboData = {
        name: comboForm.name,
        description: comboForm.description || '',
        image: comboForm.image || '',
        productsWithQuantities: productsWithQuantities,
        profitMargin: parseFloat(comboForm.profitMargin || financialSettings.comboProfit),
        slug: comboForm.name.toLowerCase().replace(/\s+/g, '-')
      };

      if (comboForm.id) {
        const { error } = await updateComboDB(comboForm.id, comboData);
        if (error) throw error;
        toast({ title: t('vendor.comboUpdated') });
      } else {
        const { error } = await createCombo(comboData);
        if (error) throw error;
        toast({ title: t('vendor.comboAdded') });
      }

      await onCombosRefresh(true);
      setComboForm(null);
      setComboImagePreview(null);
    } catch (error) {
      console.error('Error saving combo:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const getComboCalculatedPrices = (combo) => {
    if (!combo || !selectedCurrency) return { base: 0, final: 0 };

    const baseCurrencyId = currencies.find(c => c.is_base)?.id;
    const selectedCurrencyCode = currencies.find(c => c.id === selectedCurrency)?.code || 'USD';
    const baseCurrencyCode = currencies.find(c => c.is_base)?.code || 'USD';

    // Map to use currency codes for calculation
    let totalBasePrice = 0;

    (combo.products || []).forEach(productId => {
      const product = products.find(p => p.id === productId);
      if (product) {
        const basePrice = parseFloat(product.base_price || 0);
        const productCurrencyId = product.base_currency_id;
        const productCurrencyCode = currencies.find(c => c.id === productCurrencyId)?.code || 'USD';
        const quantity = combo.productQuantities?.[productId] || 1;

        let convertedPrice = basePrice;
        if (productCurrencyCode !== selectedCurrencyCode && exchangeRates[`${productCurrencyCode}-${selectedCurrencyCode}`]) {
          const rate = exchangeRates[`${productCurrencyCode}-${selectedCurrencyCode}`];
          convertedPrice = basePrice * rate;
        }

        totalBasePrice += convertedPrice * quantity;
      }
    });

    const profitMargin = parseFloat(combo.profitMargin || financialSettings.comboProfit) / 100;
    const finalPrice = totalBasePrice * (1 + profitMargin);

    return {
      base: totalBasePrice.toFixed(2),
      final: finalPrice.toFixed(2)
    };
  };

  const selectedCurrencyObj = currencies.find(c => c.id === selectedCurrency);
  const currencySymbol = selectedCurrencyObj?.symbol || '$';
  const currencyCode = selectedCurrencyObj?.code || 'USD';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      {/* Currency Selector and Add Button */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            {language === 'es' ? 'Moneda:' : 'Currency:'}
          </span>
          <select
            value={selectedCurrency || ''}
            onChange={(e) => onSelectedCurrencyChange(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {currencies.map(currency => (
              <option key={currency.id} value={currency.id}>
                {currency.code} ({currency.symbol})
              </option>
            ))}
          </select>
        </div>
        <Button onClick={openNewComboForm} style={getPrimaryButtonStyle(visualSettings)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('vendor.combos.new')}
        </Button>
      </div>

      {/* Combo Form */}
      {comboForm && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-effect p-8 rounded-2xl"
        >
          <h2 className="text-2xl font-semibold mb-6">
            {comboForm.id ? t('vendor.combos.edit') : t('vendor.combos.new')}
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Left Column - Form Fields */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.combos.name')} *
              </label>
              <input
                type="text"
                value={comboForm.name}
                onChange={e => setComboForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('vendor.combos.name')}
                className="w-full input-style mb-4"
                required
              />

              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.combos.profitMargin')}
              </label>
              <input
                type="number"
                step="0.01"
                value={comboForm.profitMargin}
                onChange={e => setComboForm(prev => ({ ...prev, profitMargin: e.target.value }))}
                placeholder={`${t('vendor.combos.profitMargin')} (def: ${financialSettings.comboProfit}%)`}
                className="w-full input-style mb-4"
              />

              {/* Image Preview */}
              {comboImagePreview && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Vista Previa:' : 'Preview:'}
                  </p>
                  <div className="aspect-square max-w-sm mx-auto rounded-lg overflow-hidden border-2 border-gray-300 bg-gray-100">
                    <img
                      src={comboImagePreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.combos.coverImage')}
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleComboImageUpload}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-4"
              />
            </div>

            {/* Right Column - Product Selection */}
            <div>
              <h3 className="font-semibold mb-2">{t('vendor.combos.products')}</h3>
              <div className="max-h-96 overflow-y-auto space-y-2 p-2 border rounded-lg bg-white">
                {products.map(p => {
                  const stock = p.stock !== undefined ? p.stock : 0;
                  const minStock = p.min_stock_alert || 10;
                  const isOutOfStock = stock === 0;
                  const isLowStock = stock > 0 && stock <= minStock;
                  const requiredQuantity = comboForm.productQuantities[p.id] || 1;
                  const hasInsufficientStock = comboForm.products.includes(p.id) && stock < requiredQuantity;

                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2 p-2 rounded ${
                        isOutOfStock ? 'bg-red-50 border border-red-200' :
                        isLowStock || hasInsufficientStock ? 'bg-yellow-50 border border-yellow-200' :
                        'border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        id={`p-${p.id}`}
                        checked={comboForm.products.includes(p.id)}
                        onChange={() => handleComboProductToggle(p.id)}
                        disabled={isOutOfStock}
                        className="flex-shrink-0"
                      />
                      <label
                        htmlFor={`p-${p.id}`}
                        className={`cursor-pointer flex-1 ${isOutOfStock ? 'text-gray-400 line-through' : ''}`}
                      >
                        {p.name_es || p.name}
                      </label>
                      {isOutOfStock && (
                        <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                      )}
                      {isLowStock && !isOutOfStock && (
                        <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      )}
                      {hasInsufficientStock && (
                        <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0" />
                      )}
                      {comboForm.products.includes(p.id) && (
                        <input
                          type="number"
                          min="1"
                          value={comboForm.productQuantities[p.id] || 1}
                          onChange={(e) => handleComboProductQuantityChange(p.id, e.target.value)}
                          className="w-16 px-2 py-1 border rounded text-sm"
                          placeholder="Cant."
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Price Summary */}
            <div className="md:col-span-2">
              <div className="glass-effect p-4 rounded-lg text-sm">
                <div className="flex justify-between mb-2">
                  <span>{t('vendor.combos.basePrice')}:</span>
                  <span className="font-semibold">
                    {currencySymbol}{getComboCalculatedPrices(comboForm).base} {currencyCode}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t('vendor.combos.finalPrice')}:</span>
                  <span className="text-blue-600">
                    {currencySymbol}{getComboCalculatedPrices(comboForm).final} {currencyCode}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-4 mt-6">
            <Button variant="outline" onClick={() => setComboForm(null)}>
              {t('vendor.addProduct.cancel')}
            </Button>
            <Button onClick={handleComboSubmit} style={getPrimaryButtonStyle(visualSettings)}>
              <Save className="w-4 h-4 mr-2" />
              {t('vendor.combos.save')}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Combos Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {combos.map(c => {
          const totalItems = (c.products || []).reduce((sum, productId) => {
            const quantity = c.productQuantities?.[productId] || 1;
            return sum + quantity;
          }, 0);

          const stockIssues = checkComboStockIssues(c, products, language);
          const isDeactivated = c.is_active === false || stockIssues.length > 0;
          const prices = getComboCalculatedPrices(c);

          return (
            <div
              key={c.id}
              className={`glass-effect p-4 rounded-lg relative ${isDeactivated ? 'border-2 border-red-300' : ''}`}
            >
              {isDeactivated && (
                <div className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {language === 'es' ? 'DESACTIVADO' : 'DEACTIVATED'}
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openEditComboForm(c)}
                className="absolute top-2 right-2"
              >
                <Edit className="h-4 w-4" />
              </Button>

              <h3 className={`font-bold pr-8 ${isDeactivated ? 'line-through text-gray-500 mt-8' : ''}`}>
                {c.name_es || c.name}
              </h3>
              <p className="text-sm text-gray-600">
                {totalItems} {language === 'es' ? 'elementos' : 'items'} ({c.products?.length || 0} {language === 'es' ? 'productos' : 'products'})
              </p>

              {isDeactivated && stockIssues.length > 0 && (
                <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded text-xs">
                  <p className="font-semibold text-red-800 mb-1">
                    {language === 'es' ? 'Problemas de stock:' : 'Stock issues:'}
                  </p>
                  <ul className="space-y-1">
                    {stockIssues.map((issue, idx) => (
                      <li key={idx} className="flex items-start gap-1 text-red-700">
                        <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>{issue.productName}:</strong>{' '}
                          {issue.issue === 'out_of_stock'
                            ? (language === 'es' ? 'Sin stock' : 'Out of stock')
                            : `${language === 'es' ? 'Insuf.' : 'Insuf.'} (${language === 'es' ? 'Req:' : 'Req:'} ${issue.required}, ${language === 'es' ? 'Disp:' : 'Avail:'} ${issue.available})`
                          }
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-2 space-y-1">
                <p className={`text-sm ${isDeactivated ? 'text-gray-400 line-through' : 'text-gray-500'}`}>
                  {language === 'es' ? 'Base:' : 'Base:'} {currencySymbol}{prices.base} {currencyCode}
                </p>
                <p className={`text-lg font-bold ${isDeactivated ? 'text-gray-400 line-through' : 'text-green-600'}`}>
                  {language === 'es' ? 'Final:' : 'Final:'} {currencySymbol}{prices.final} {currencyCode}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default VendorCombosTab;
