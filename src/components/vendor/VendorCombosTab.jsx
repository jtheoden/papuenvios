import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Save, AlertCircle, AlertTriangle, Box, Trash2, Eye, EyeOff, Loader2, Check, X, Percent, DollarSign, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createCombo, updateCombo as updateComboDB, deleteCombo, setComboActiveState } from '@/lib/comboService';
import { checkComboStockIssues, computeComboPricing } from '@/lib/comboUtils';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { logActivity } from '@/lib/activityLogger';
import { useRealtimeCombos } from '@/hooks/useRealtimeSubscription';

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
  const { user } = useAuth();
  const { refreshCombos } = useBusiness();

  const [comboForm, setComboForm] = useState(null);
  const [comboImagePreview, setComboImagePreview] = useState(null);
  const [processingComboId, setProcessingComboId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [showZeroMarginConfirm, setShowZeroMarginConfirm] = useState(false);

  // Refs for form focus and scroll
  const comboFormRef = useRef(null);
  const comboNameInputRef = useRef(null);
  const formOpenTrigger = useRef(0);

  // Function to scroll and focus the form
  const scrollToFormAndFocus = useCallback(() => {
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      // Additional small delay for animation to start
      setTimeout(() => {
        if (comboFormRef.current) {
          comboFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Focus after scroll starts
        setTimeout(() => {
          if (comboNameInputRef.current) {
            comboNameInputRef.current.focus();
          }
        }, 300);
      }, 50);
    });
  }, []);

  // Real-time subscription for combo updates
  useRealtimeCombos({
    enabled: true,
    onUpdate: () => {
      if (refreshCombos) {
        refreshCombos(true);
      } else if (onCombosRefresh) {
        onCombosRefresh(true);
      }
    }
  });

  const currencyCodeById = useMemo(() => {
    return (currencies || []).reduce((acc, currency) => {
      acc[currency.id] = currency.code;
      return acc;
    }, {});
  }, [currencies]);

  const baseCurrencyId = useMemo(() => {
    const baseCurrency = (currencies || []).find(c => c.is_base);
    return baseCurrency?.id;
  }, [currencies]);

  const baseCurrencyCode = useMemo(() => {
    const baseCurrency = (currencies || []).find(c => c.is_base);
    return baseCurrency?.code || 'USD';
  }, [currencies]);

  const baseCurrencySymbol = useMemo(() => {
    const baseCurrency = (currencies || []).find(c => c.is_base);
    return baseCurrency?.symbol || '$';
  }, [currencies]);

  const selectedCurrencyCode = currencyCodeById[selectedCurrency] || baseCurrencyCode;

  const convertPrice = useCallback((amount, fromCurrencyId, toCurrencyId) => {
    if (!amount || !fromCurrencyId || !toCurrencyId || fromCurrencyId === toCurrencyId) return amount;

    const direct = exchangeRates?.[`${fromCurrencyId}-${toCurrencyId}`];
    if (direct) return amount * direct;

    const inverse = exchangeRates?.[`${toCurrencyId}-${fromCurrencyId}`];
    if (inverse) return amount / inverse;

    return amount;
  }, [exchangeRates]);

  const openNewComboForm = () => {
    setComboForm({
      id: null,
      name: '',
      profitMargin: '',
      profitMode: 'percentage',
      profitAmount: '',
      sellPrice: '',
      shipping: { type: 'paid', value: 0 },
      products: [],
      productQuantities: {},
      image: ''
    });
    setComboImagePreview(null);
    // Scroll to form and focus after state update
    scrollToFormAndFocus();
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
      profitMode: 'percentage',
      profitAmount: '',
      sellPrice: '',
      products: productIds,
      productQuantities: productQuantities
    });
    setComboImagePreview(combo.image_url || combo.image || null);
    // Scroll to form and focus after state update
    scrollToFormAndFocus();
  };

  // Compute combo base price from selected products (in base currency)
  const comboBasePrice = useMemo(() => {
    if (!comboForm?.products?.length) return 0;
    return comboForm.products.reduce((total, productId) => {
      const product = products.find(p => p.id === productId);
      if (!product) return total;
      const qty = comboForm.productQuantities[productId] || 1;
      const priceInBase = convertPrice(product.base_price, product.base_currency_id, baseCurrencyId);
      return total + (priceInBase * qty);
    }, 0);
  }, [comboForm?.products, comboForm?.productQuantities, products, baseCurrencyId, convertPrice]);

  // Cross-calculate profit fields when any one changes
  const handleComboProfitChange = (mode, value) => {
    const basePrice = comboBasePrice;
    const numVal = parseFloat(value);

    if (mode === 'percentage') {
      if (!isNaN(numVal) && numVal < 0) {
        toast({ title: t('vendor.combos.cannotSaveNegative'), description: t('vendor.combos.negativeMarginWarning'), variant: 'destructive' });
        return;
      }
      const margin = isNaN(numVal) ? '' : numVal;
      const amount = (!isNaN(numVal) && basePrice > 0) ? (basePrice * numVal / 100).toFixed(2) : '';
      const sell = (!isNaN(numVal) && basePrice > 0) ? (basePrice * (1 + numVal / 100)).toFixed(2) : '';
      setComboForm(prev => ({ ...prev, profitMargin: margin, profitAmount: amount, sellPrice: sell, profitMode: 'percentage' }));
    } else if (mode === 'amount') {
      if (!isNaN(numVal) && numVal < 0) {
        toast({ title: t('vendor.combos.cannotSaveNegative'), description: t('vendor.combos.negativeMarginWarning'), variant: 'destructive' });
        return;
      }
      const amount = isNaN(numVal) ? '' : value;
      const margin = (!isNaN(numVal) && basePrice > 0) ? ((numVal / basePrice) * 100) : '';
      const sell = (!isNaN(numVal) && basePrice > 0) ? (basePrice + numVal).toFixed(2) : '';
      setComboForm(prev => ({ ...prev, profitMargin: margin !== '' ? parseFloat(margin.toFixed(4)) : '', profitAmount: amount, sellPrice: sell, profitMode: 'amount' }));
    } else if (mode === 'sellPrice') {
      if (!isNaN(numVal) && basePrice > 0 && numVal < basePrice) {
        toast({ title: t('vendor.combos.sellPriceTooLow'), description: t('vendor.combos.sellPriceTooLowDesc'), variant: 'destructive' });
      }
      const sell = isNaN(numVal) ? '' : value;
      const margin = (!isNaN(numVal) && basePrice > 0) ? Math.max(0, ((numVal / basePrice) - 1) * 100) : '';
      const amount = (!isNaN(numVal) && basePrice > 0) ? Math.max(0, numVal - basePrice).toFixed(2) : '';
      setComboForm(prev => ({ ...prev, profitMargin: margin !== '' ? parseFloat(margin.toFixed(4)) : '', profitAmount: amount, sellPrice: sell, profitMode: 'sellPrice' }));
    }
  };

  // Recalculate profit amount and sell price when comboBasePrice changes (products added/removed)
  useEffect(() => {
    if (!comboForm || comboBasePrice <= 0) return;
    const margin = parseFloat(comboForm.profitMargin);
    if (isNaN(margin)) return;
    const amount = (comboBasePrice * margin / 100).toFixed(2);
    const sell = (comboBasePrice * (1 + margin / 100)).toFixed(2);
    setComboForm(prev => ({ ...prev, profitAmount: amount, sellPrice: sell }));
  }, [comboBasePrice]);

  const handleComboImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

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
      console.error('[handleComboImageUpload] ERROR:', error);
      console.error('[handleComboImageUpload] Error details:', { message: error?.message, code: error?.code });
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

  const logComboAudit = async (action, comboId, description, metadata = {}) => {
    try {
      await logActivity({
        action,
        entityType: 'combo',
        entityId: comboId,
        performedBy: user?.email || user?.id || 'anonymous',
        description,
        metadata
      });
    } catch (error) {
      console.warn('[VendorCombosTab] Failed to log combo activity', error?.message || error);
    }
  };

  const handleToggleComboActive = async (combo, nextActive) => {
    setProcessingComboId(combo.id);
    try {
      await setComboActiveState(combo.id, nextActive);
      await logComboAudit(
        nextActive ? 'combo_activated' : 'combo_deactivated',
        combo.id,
        `${nextActive ? 'Activated' : 'Deactivated'} combo ${combo.name || combo.name_es || combo.name_en || combo.id}`,
        { isActive: nextActive, products: combo.products?.length || 0 }
      );
      toast({
        title: nextActive ? (language === 'es' ? 'Combo activado' : 'Combo activated') : (language === 'es' ? 'Combo desactivado' : 'Combo deactivated'),
        description: combo.name || combo.name_es || ''
      });
      await onCombosRefresh(true);
    } catch (error) {
      console.error('[handleToggleComboActive] ERROR:', error);
      console.error('[handleToggleComboActive] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessingComboId(null);
    }
  };

  const handleConfirmDelete = async (combo) => {
    setProcessingComboId(combo.id);
    setConfirmingDeleteId(null);
    try {
      await deleteCombo(combo.id);
      await logComboAudit(
        'combo_deleted',
        combo.id,
        `Combo ${combo.name || combo.name_es || combo.id} deleted from VendorPage`,
        { products: combo.products || [], quantities: combo.productQuantities }
      );
      toast({
        title: language === 'es' ? 'Combo eliminado' : 'Combo deleted',
        description: combo.name || combo.name_es || ''
      });

      // Refresh combos list immediately
      if (refreshCombos) {
        await refreshCombos(true);
      } else if (onCombosRefresh) {
        await onCombosRefresh(true);
      }
    } catch (error) {
      console.error('[handleConfirmDelete] ERROR:', error);
      console.error('[handleConfirmDelete] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessingComboId(null);
    }
  };

  const handleCancelDelete = () => {
    setConfirmingDeleteId(null);
  };

  const handleComboSubmit = async (bypassZeroConfirm = false) => {

    if (!comboForm.name) {
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    // Margin validation
    const margin = parseFloat(comboForm.profitMargin || financialSettings.comboProfit);
    if (margin < 0) {
      toast({
        title: t('vendor.combos.cannotSaveNegative'),
        description: t('vendor.combos.negativeMarginWarning'),
        variant: 'destructive'
      });
      return;
    }
    if (margin === 0 && !bypassZeroConfirm) {
      setShowZeroMarginConfirm(true);
      return;
    }

    setProcessingComboId(comboForm.id || 'new');
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
        await updateComboDB(comboForm.id, comboData);
        await logComboAudit('combo_updated', comboForm.id, `Combo ${comboForm.name} updated`, {
          profitMargin: comboData.profitMargin,
          products: productsWithQuantities,
          imageUpdated: Boolean(comboData.image)
        });
        toast({ title: t('vendor.comboUpdated') });
      } else {
        const createdCombo = await createCombo(comboData);
        await logComboAudit('combo_created', createdCombo?.id || comboForm.name, `Combo ${comboForm.name} created`, {
          profitMargin: comboData.profitMargin,
          products: productsWithQuantities
        });
        toast({ title: t('vendor.comboAdded') });
      }

      await onCombosRefresh(true);
      setComboForm(null);
      setComboImagePreview(null);
    } catch (error) {
      console.error('[handleComboSubmit] ERROR:', error);
      console.error('[handleComboSubmit] Error details:', { message: error?.message, code: error?.code, stack: error?.stack });
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessingComboId(null);
    }
  };

  const getComboCalculatedPrices = (combo) => {
    if (!combo) return { base: 0, final: 0 };

    const prices = computeComboPricing({
      combo,
      products,
      convert: convertPrice,
      selectedCurrencyId: selectedCurrency || baseCurrencyId,
      baseCurrencyId,
      defaultProfitMargin: financialSettings.comboProfit
    });

    return {
      base: prices.basePrice.toFixed(2),
      final: prices.finalPrice.toFixed(2)
    };
  };

  const selectedCurrencyObj = currencies.find(c => c.id === selectedCurrency);
  const currencySymbol = selectedCurrencyObj?.symbol || '$';
  const currencyCode = selectedCurrencyObj?.code || selectedCurrencyCode || 'USD';

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
        <Button onClick={openNewComboForm} style={getPrimaryButtonStyle(visualSettings)} className="flex-shrink-0">
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{t('vendor.combos.new')}</span>
        </Button>
      </div>

      {/* Combo Form */}
      {comboForm && (
        <motion.div
          ref={comboFormRef}
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
                ref={comboNameInputRef}
                type="text"
                value={comboForm.name}
                onChange={e => setComboForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('vendor.combos.name')}
                className="w-full input-style mb-4"
                required
              />

              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.combos.profitMode')}
              </label>
              {/* Mode Toggle */}
              <div className="flex gap-1 mb-3 bg-gray-100 p-1 rounded-lg w-fit">
                {[
                  { id: 'percentage', icon: Percent, label: t('vendor.addProduct.profitByPercent') },
                  { id: 'amount', icon: DollarSign, label: `${t('vendor.addProduct.profitByAmount')} (${baseCurrencyCode})` },
                  { id: 'sellPrice', icon: Tag, label: `${t('vendor.addProduct.profitBySellPrice')} (${baseCurrencyCode})` }
                ].map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      if (comboBasePrice <= 0 && mode.id !== 'percentage') {
                        toast({ title: t('vendor.combos.addProductsFirst'), variant: 'destructive' });
                        return;
                      }
                      setComboForm(prev => ({ ...prev, profitMode: mode.id }));
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      comboForm.profitMode === mode.id
                        ? 'bg-white shadow text-gray-900'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <mode.icon className="h-3.5 w-3.5" />
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Dynamic Input per Mode */}
              {comboForm.profitMode === 'percentage' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('vendor.addProduct.profitByPercent')}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={comboForm.profitMargin}
                      onChange={e => handleComboProfitChange('percentage', e.target.value)}
                      placeholder={`${financialSettings.comboProfit}%`}
                      className={`w-full input-style pr-8 ${
                        parseFloat(comboForm.profitMargin) < 0 ? 'border-red-400 ring-1 ring-red-400' :
                        parseFloat(comboForm.profitMargin) === 0 ? 'border-orange-400 ring-1 ring-orange-400' : ''
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                </div>
              )}
              {comboForm.profitMode === 'amount' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {t('vendor.combos.profitAmountLabel').replace('{symbol}', baseCurrencySymbol)}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{baseCurrencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={comboForm.profitAmount}
                      onChange={e => handleComboProfitChange('amount', e.target.value)}
                      placeholder="0.00"
                      className="w-full input-style pl-7"
                    />
                  </div>
                </div>
              )}
              {comboForm.profitMode === 'sellPrice' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {t('vendor.combos.sellPriceLabel').replace('{symbol}', baseCurrencySymbol)}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{baseCurrencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={comboForm.sellPrice}
                      onChange={e => handleComboProfitChange('sellPrice', e.target.value)}
                      placeholder="0.00"
                      className={`w-full input-style pl-7 ${
                        parseFloat(comboForm.sellPrice || 0) > 0 && parseFloat(comboForm.sellPrice) < comboBasePrice
                          ? 'border-red-400 ring-1 ring-red-400' : ''
                      }`}
                    />
                  </div>
                </div>
              )}
              {/* Margin warnings */}
              {comboForm.profitMargin !== '' && !isNaN(parseFloat(comboForm.profitMargin)) && (
                <>
                  {parseFloat(comboForm.profitMargin) < 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-red-600 text-xs font-medium">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      {t('vendor.combos.negativeMarginWarning')}
                    </div>
                  )}
                  {parseFloat(comboForm.profitMargin) === 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-orange-600 text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      {t('vendor.combos.zeroMarginWarning')}
                    </div>
                  )}
                  {parseFloat(comboForm.profitMargin) > 0 && parseFloat(comboForm.profitMargin) < 5 && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-yellow-600 text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      {t('vendor.combos.belowMinMarginWarning')}
                    </div>
                  )}
                </>
              )}
              <div className="mb-4" />

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

            {/* Price Summary with Cost Breakdown */}
            <div className="md:col-span-2">
              {(() => {
                const hasProducts = comboForm.products && comboForm.products.length > 0;
                const prices = hasProducts ? getComboCalculatedPrices(comboForm) : { base: '0.00', final: '0.00' };
                const baseNum = parseFloat(prices.base) || 0;
                const finalNum = hasProducts ? (parseFloat(prices.final) || 0) : 0;
                const margin = parseFloat(comboForm.profitMargin || financialSettings.comboProfit) || 0;
                const marginAmount = finalNum - baseNum;

                // Calculate user savings: sum of actual individual product final prices vs combo price
                const displayCurrencyId = selectedCurrency || baseCurrencyId;
                const individualTotal = hasProducts ? comboForm.products.reduce((sum, productId) => {
                  const product = products.find(p => p.id === productId);
                  if (!product) return sum;
                  const qty = comboForm.productQuantities[productId] || 1;
                  const finalInDisplay = convertPrice(parseFloat(product.final_price || product.base_price || 0), product.base_currency_id, displayCurrencyId);
                  return sum + (finalInDisplay * qty);
                }, 0) : 0;
                const savings = individualTotal - finalNum;
                const savingsPercent = individualTotal > 0 ? ((savings / individualTotal) * 100) : 0;

                return (
                  <div className="glass-effect p-4 rounded-lg text-sm space-y-2">
                    <div className="flex justify-between">
                      <span>{t('vendor.combos.productCosts')}:</span>
                      <span className="font-semibold">
                        {currencySymbol}{prices.base} {currencyCode}
                      </span>
                    </div>
                    <div className="flex justify-between text-green-700">
                      <span>{t('vendor.combos.marginAmount')} ({margin}%):</span>
                      <span className="font-semibold">
                        +{currencySymbol}{marginAmount.toFixed(2)}
                      </span>
                    </div>
                    <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold">
                      <span>{t('vendor.combos.finalPrice')}:</span>
                      <span className="text-blue-600">
                        {currencySymbol}{finalNum.toFixed(2)} {currencyCode}
                      </span>
                    </div>

                    {/* User savings preview */}
                    {hasProducts && individualTotal > 0 && (
                      <div className={`border-t border-gray-200 pt-2 flex justify-between font-medium ${savings > 0 ? 'text-emerald-600' : savings < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                        <span>{t('vendor.combos.userSavings')}:</span>
                        <span>
                          {savings > 0 ? '-' : savings < 0 ? '+' : ''}{currencySymbol}{Math.abs(savings).toFixed(2)} ({savingsPercent.toFixed(1)}%)
                        </span>
                      </div>
                    )}
                    {hasProducts && individualTotal > 0 && (
                      <div className="text-xs text-gray-400">
                        {t('vendor.combos.individualTotal')}: {currencySymbol}{individualTotal.toFixed(2)} {currencyCode}
                      </div>
                    )}

                    {/* Cross-mode preview */}
                    {comboBasePrice > 0 && comboForm.profitMargin !== '' && !isNaN(parseFloat(comboForm.profitMargin)) && (
                      <div className="border-t border-gray-100 pt-2 mt-1">
                        <p className="text-gray-500 text-xs mb-1">{t('vendor.combos.profitPreview')}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span className="font-medium text-gray-700">
                            {t('vendor.addProduct.profitByPercent')}: <span className="text-blue-600">{parseFloat(comboForm.profitMargin).toFixed(2)}%</span>
                          </span>
                          <span className="font-medium text-gray-700">
                            = <span className="text-green-600">{baseCurrencySymbol}{parseFloat(comboForm.profitAmount || 0).toFixed(2)}</span>
                          </span>
                          <span className="font-medium text-gray-700">
                            | {t('vendor.addProduct.profitBySellPrice')}: <span className="text-purple-600">{baseCurrencySymbol}{parseFloat(comboForm.sellPrice || 0).toFixed(2)}</span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Zero Margin Confirmation */}
          {showZeroMarginConfirm && (
            <div className="mt-4 p-4 bg-orange-50 border border-orange-300 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-orange-800">{t('vendor.combos.confirmZeroMargin')}</p>
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowZeroMarginConfirm(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setShowZeroMarginConfirm(false);
                        handleComboSubmit(true);
                      }}
                    >
                      {t('vendor.combos.save')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex justify-end gap-4 mt-6">
            <Button variant="outline" onClick={() => { setComboForm(null); setShowZeroMarginConfirm(false); }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => handleComboSubmit()}
              style={getPrimaryButtonStyle(visualSettings)}
              disabled={parseFloat(comboForm.profitMargin) < 0}
            >
              <Save className="w-4 h-4 mr-2" />
              {t('vendor.combos.save')}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Combos Grid - Responsive: list on mobile, grid on larger screens */}
      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
        {combos.map(c => {
          const totalItems = (c.products || []).reduce((sum, productId) => {
            const quantity = c.productQuantities?.[productId] || 1;
            return sum + quantity;
          }, 0);

          const stockIssues = checkComboStockIssues(c, products, language);
          const isDeactivated = c.is_active === false || stockIssues.length > 0;
          const prices = getComboCalculatedPrices(c);
          const isConfirming = confirmingDeleteId === c.id;
          const isProcessing = processingComboId === c.id;

          return (
            <div
              key={c.id}
              className={`glass-effect p-4 rounded-lg transition-all duration-200 ${
                isConfirming
                  ? 'border-2 border-red-400 bg-red-50'
                  : isDeactivated
                    ? 'border-2 border-red-300'
                    : ''
              }`}
            >
              {/* Mobile: Horizontal list layout / Desktop: Card layout */}
              <div className="flex flex-col">
                {/* Header row with title and actions */}
                <div className="flex items-start justify-between gap-2">
                  {/* Left: Status badge + Title */}
                  <div className="flex-1 min-w-0">
                    {isDeactivated && !isConfirming && (
                      <div className="inline-flex items-center gap-1 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded mb-1">
                        <AlertCircle className="h-3 w-3" />
                        <span className="hidden xs:inline">{language === 'es' ? 'DESACTIVADO' : 'DEACTIVATED'}</span>
                        <span className="xs:hidden">{language === 'es' ? 'OFF' : 'OFF'}</span>
                      </div>
                    )}
                    <h3 className={`font-bold truncate ${isDeactivated ? 'line-through text-gray-500' : ''}`}>
                      {language === 'es' ? (c.name_es || c.name) : (c.name_en || c.name_es || c.name)}
                    </h3>
                  </div>

                  {/* Right: Action buttons */}
                  <div className="flex-shrink-0">
                    <AnimatePresence mode="wait">
                      {isConfirming ? (
                        <motion.div
                          key="confirm-actions"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="flex flex-col xs:flex-row items-end xs:items-center gap-1 xs:gap-2"
                        >
                          <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {language === 'es' ? '¿Eliminar?' : 'Delete?'}
                          </span>
                          <div className="flex gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleConfirmDelete(c)}
                              disabled={isProcessing}
                              className="h-7 px-2 text-xs"
                            >
                              {isProcessing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <Check className="h-3 w-3 mr-0.5" />
                                  {language === 'es' ? 'Sí' : 'Yes'}
                                </>
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancelDelete}
                              disabled={isProcessing}
                              className="h-7 px-2 text-xs"
                            >
                              <X className="h-3 w-3 mr-0.5" />
                              {language === 'es' ? 'No' : 'No'}
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="default-actions"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex gap-0.5"
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditComboForm(c)}
                            disabled={isProcessing}
                            className="h-8 w-8"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleComboActive(c, !c.is_active)}
                            disabled={isProcessing}
                            className="h-8 w-8"
                          >
                            {c.is_active ? <EyeOff className="h-4 w-4 text-red-600" /> : <Eye className="h-4 w-4 text-green-600" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmingDeleteId(c.id)}
                            disabled={isProcessing}
                            className="h-8 w-8"
                          >
                            {isProcessing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-red-600" />
                            )}
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Content row: items count and prices */}
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                  <p className="text-sm text-gray-600">
                    {totalItems} {language === 'es' ? 'elem.' : 'items'} ({c.products?.length || 0} {language === 'es' ? 'prod.' : 'prod.'})
                  </p>
                  <div className="flex items-center gap-3">
                    <p className={`text-xs ${isDeactivated ? 'text-gray-400 line-through' : 'text-gray-500'}`}>
                      {currencySymbol}{prices.base}
                    </p>
                    <p className={`text-base font-bold ${isDeactivated ? 'text-gray-400 line-through' : 'text-green-600'}`}>
                      {currencySymbol}{prices.final} {currencyCode}
                    </p>
                  </div>
                </div>

                {/* Stock issues - collapsible on mobile */}
                {isDeactivated && stockIssues.length > 0 && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded text-xs">
                    <p className="font-semibold text-red-800 mb-1">
                      {language === 'es' ? 'Problemas de stock:' : 'Stock issues:'}
                    </p>
                    <ul className="space-y-1">
                      {stockIssues.slice(0, 2).map((issue, idx) => (
                        <li key={idx} className="flex items-start gap-1 text-red-700">
                          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span className="truncate">
                            <strong>{issue.productName}:</strong>{' '}
                            {issue.issue === 'out_of_stock'
                              ? (language === 'es' ? 'Sin stock' : 'Out of stock')
                              : `${language === 'es' ? 'Insuf.' : 'Insuf.'} (${issue.required}/${issue.available})`
                            }
                          </span>
                        </li>
                      ))}
                      {stockIssues.length > 2 && (
                        <li className="text-red-600 font-medium">
                          +{stockIssues.length - 2} {language === 'es' ? 'más' : 'more'}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default VendorCombosTab;
