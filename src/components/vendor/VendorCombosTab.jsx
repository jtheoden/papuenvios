import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit, Save, AlertCircle, AlertTriangle, Box, Trash2, Eye, EyeOff, Loader2, Check, X, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createCombo, updateCombo as updateComboDB, deleteCombo, setComboActiveState } from '@/lib/comboService';
import { checkComboStockIssues, computeComboPricing } from '@/lib/comboUtils';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { logActivity } from '@/lib/activityLogger';
import { useRealtimeCombos } from '@/hooks/useRealtimeSubscription';
import { getGlobalPricing } from '@/lib/businessStatusService';

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
  const { convertAmountAsync, getCurrencyById } = useCurrency();

  const [comboForm, setComboForm] = useState(null);
  const [comboImagePreview, setComboImagePreview] = useState(null);
  const [processingComboId, setProcessingComboId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [originalCurrencyId, setOriginalCurrencyId] = useState(null);
  const [globalPricing, setGlobalPricing] = useState({ multiplier: 1.0, appliesToCombos: false });

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
      console.log('[VendorCombosTab] Combos realtime update detected');
      if (refreshCombos) {
        refreshCombos(true);
      } else if (onCombosRefresh) {
        onCombosRefresh(true);
      }
    }
  });

  // Load global pricing (multiplier) on mount
  useEffect(() => {
    const loadGlobalPricing = async () => {
      try {
        const pricing = await getGlobalPricing();
        if (pricing) {
          setGlobalPricing({
            multiplier: pricing.price_multiplier || 1.0,
            appliesToCombos: pricing.applies_to_combos === true
          });
        }
      } catch (error) {
        console.warn('[VendorCombosTab] Error loading global pricing:', error);
      }
    };
    loadGlobalPricing();
  }, []);

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
    console.log('[openNewComboForm] START - Opening new combo form');
    setComboForm({
      id: null,
      name: '',
      profitMargin: '',
      shipping: { type: 'paid', value: 0 },
      products: [],
      productQuantities: {},
      image: '',
      base_currency_id: baseCurrencyId
    });
    setComboImagePreview(null);
    setOriginalCurrencyId(baseCurrencyId);
    console.log('[openNewComboForm] SUCCESS - Form initialized');
    // Scroll to form and focus after state update
    scrollToFormAndFocus();
  };

  const openEditComboForm = (combo) => {
    console.log('[openEditComboForm] START - Input:', { comboId: combo.id, comboName: combo.name, itemsCount: combo.items?.length || 0 });
    const productQuantities = {};
    const productIds = [];

    if (combo.items && combo.items.length > 0) {
      combo.items.forEach(item => {
        productIds.push(item.product.id);
        productQuantities[item.product.id] = item.quantity || 1;
      });
    }

    console.log('[openEditComboForm] Parsed products:', { productCount: productIds.length, quantities: productQuantities });
    const comboCurrencyId = combo.base_currency_id || baseCurrencyId;
    setComboForm({
      ...combo,
      products: productIds,
      productQuantities: productQuantities,
      base_currency_id: comboCurrencyId
    });
    setComboImagePreview(combo.image_url || combo.image || null);
    setOriginalCurrencyId(comboCurrencyId);
    console.log('[openEditComboForm] SUCCESS - Form populated for editing');
    // Scroll to form and focus after state update
    scrollToFormAndFocus();
  };

  const handleComboImageUpload = async (e) => {
    console.log('[handleComboImageUpload] START - Image upload initiated');
    const file = e.target.files?.[0];
    if (!file) {
      console.log('[handleComboImageUpload] No file selected');
      return;
    }

    console.log('[handleComboImageUpload] File selected:', { name: file.name, size: file.size, type: file.type });
    try {
      console.log('[handleComboImageUpload] Validating and processing image...');
      const result = await validateAndProcessImage(file, 'combo');

      if (!result.success) {
        console.log('[handleComboImageUpload] VALIDATION ERROR:', result.errors);
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      console.log('[handleComboImageUpload] Image processed successfully:', result.metadata);
      setComboImagePreview(result.base64);
      setComboForm(prev => ({ ...prev, image: result.base64 }));

      toast({
        title: 'Imagen optimizada',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions} (${result.metadata.compression} compresión)`,
      });
      console.log('[handleComboImageUpload] SUCCESS - Image uploaded and preview set');
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
    console.log('[handleToggleComboActive] START - Input:', { comboId: combo.id, comboName: combo.name, currentActive: combo.is_active, nextActive });
    setProcessingComboId(combo.id);
    try {
      console.log('[handleToggleComboActive] Setting combo active state...');
      await setComboActiveState(combo.id, nextActive);
      console.log('[handleToggleComboActive] Active state updated, logging audit...');
      await logComboAudit(
        nextActive ? 'combo_activated' : 'combo_deactivated',
        combo.id,
        `${nextActive ? 'Activated' : 'Deactivated'} combo ${combo.name || combo.name_es || combo.name_en || combo.id}`,
        { isActive: nextActive, products: combo.products?.length || 0 }
      );
      console.log('[handleToggleComboActive] SUCCESS - Combo state toggled');
      toast({
        title: nextActive ? (language === 'es' ? 'Combo activado' : 'Combo activated') : (language === 'es' ? 'Combo desactivado' : 'Combo deactivated'),
        description: combo.name || combo.name_es || ''
      });
      console.log('[handleToggleComboActive] Refreshing combos list...');
      await onCombosRefresh(true);
      console.log('[handleToggleComboActive] Combos refreshed');
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
      console.log('[handleToggleComboActive] Processing state cleared');
    }
  };

  const handleConfirmDelete = async (combo) => {
    console.log('[handleConfirmDelete] START - Input:', { comboId: combo.id, comboName: combo.name });
    setProcessingComboId(combo.id);
    setConfirmingDeleteId(null);
    try {
      console.log('[handleConfirmDelete] Deleting combo...');
      await deleteCombo(combo.id);
      console.log('[handleConfirmDelete] Combo deleted, logging audit...');
      await logComboAudit(
        'combo_deleted',
        combo.id,
        `Combo ${combo.name || combo.name_es || combo.id} deleted from VendorPage`,
        { products: combo.products || [], quantities: combo.productQuantities }
      );
      console.log('[handleConfirmDelete] SUCCESS - Combo deleted');
      toast({
        title: language === 'es' ? 'Combo eliminado' : 'Combo deleted',
        description: combo.name || combo.name_es || ''
      });

      // Refresh combos list immediately
      console.log('[handleConfirmDelete] Refreshing combos list...');
      if (refreshCombos) {
        await refreshCombos(true);
      } else if (onCombosRefresh) {
        await onCombosRefresh(true);
      }
      console.log('[handleConfirmDelete] Combos refreshed');
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
      console.log('[handleConfirmDelete] Processing state cleared');
    }
  };

  const handleCancelDelete = () => {
    setConfirmingDeleteId(null);
  };

  const handleComboSubmit = async () => {
    console.log('[handleComboSubmit] START - Input:', { comboForm, hasId: !!comboForm.id, productCount: comboForm.products?.length || 0 });

    if (!comboForm.name) {
      console.log('[handleComboSubmit] VALIDATION ERROR - Missing combo name');
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    console.log('[handleComboSubmit] Validation passed, processing submission...');
    setProcessingComboId(comboForm.id || 'new');
    try {
      const productsWithQuantities = (comboForm.products || []).map(productId => ({
        productId,
        quantity: comboForm.productQuantities[productId] || 1
      }));

      console.log('[handleComboSubmit] Products with quantities:', productsWithQuantities);

      const comboData = {
        name: comboForm.name,
        description: comboForm.description || '',
        image: comboForm.image || '',
        productsWithQuantities: productsWithQuantities,
        profitMargin: parseFloat(comboForm.profitMargin || financialSettings.comboProfit),
        slug: comboForm.name.toLowerCase().replace(/\s+/g, '-'),
        base_currency_id: comboForm.base_currency_id || baseCurrencyId
      };

      console.log('[handleComboSubmit] Combo data prepared:', { ...comboData, imageLength: comboData.image?.length || 0 });

      if (comboForm.id) {
        console.log('[handleComboSubmit] Updating existing combo:', comboForm.id);
        await updateComboDB(comboForm.id, comboData);
        console.log('[handleComboSubmit] Combo updated, logging audit...');
        await logComboAudit('combo_updated', comboForm.id, `Combo ${comboForm.name} updated`, {
          profitMargin: comboData.profitMargin,
          products: productsWithQuantities,
          imageUpdated: Boolean(comboData.image)
        });
        console.log('[handleComboSubmit] SUCCESS - Combo updated');
        toast({ title: t('vendor.comboUpdated') });
      } else {
        console.log('[handleComboSubmit] Creating new combo');
        const createdCombo = await createCombo(comboData);
        console.log('[handleComboSubmit] Combo created:', { id: createdCombo?.id });
        await logComboAudit('combo_created', createdCombo?.id || comboForm.name, `Combo ${comboForm.name} created`, {
          profitMargin: comboData.profitMargin,
          products: productsWithQuantities
        });
        console.log('[handleComboSubmit] SUCCESS - Combo created');
        toast({ title: t('vendor.comboAdded') });
      }

      console.log('[handleComboSubmit] Refreshing combos list...');
      await onCombosRefresh(true);
      setComboForm(null);
      setComboImagePreview(null);
      setOriginalCurrencyId(null);
      console.log('[handleComboSubmit] Form reset and combos refreshed');
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
      console.log('[handleComboSubmit] Processing state cleared');
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

              {/* Currency Selector */}
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <DollarSign className="inline h-4 w-4 mr-1" />
                {language === 'es' ? 'Moneda del Combo' : 'Combo Currency'}
              </label>
              <select
                value={comboForm.base_currency_id || ''}
                onChange={e => setComboForm(prev => ({ ...prev, base_currency_id: e.target.value }))}
                className="w-full input-style mb-4"
              >
                {currencies.map(currency => (
                  <option key={currency.id} value={currency.id}>
                    {currency.code} ({currency.symbol}) - {language === 'es' ? currency.name_es : currency.name_en}
                  </option>
                ))}
              </select>

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

            {/* Price Summary - Enhanced with market rate and global multiplier */}
            <div className="md:col-span-2">
              <div className="glass-effect p-4 rounded-lg text-sm space-y-3">
                {/* Base Cost (Market) */}
                <div className="flex justify-between">
                  <span className="text-amber-700">
                    {language === 'es' ? 'Costo Base (Mercado):' : 'Base Cost (Market):'}
                  </span>
                  <span className="font-semibold text-amber-700">
                    {currencySymbol}{getComboCalculatedPrices(comboForm).base} {currencyCode}
                  </span>
                </div>

                {/* Profit Margin */}
                {(comboForm.profitMargin || financialSettings.comboProfit) > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>
                      {language === 'es' ? 'Ganancia' : 'Profit'} ({comboForm.profitMargin || financialSettings.comboProfit}%):
                    </span>
                    <span>
                      +{currencySymbol}{(
                        parseFloat(getComboCalculatedPrices(comboForm).base) *
                        (parseFloat(comboForm.profitMargin || financialSettings.comboProfit) / 100)
                      ).toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Price before global multiplier */}
                <div className="flex justify-between border-t pt-2">
                  <span>{language === 'es' ? 'Precio Base:' : 'Base Price:'}</span>
                  <span className="font-semibold">
                    {currencySymbol}{getComboCalculatedPrices(comboForm).final} {currencyCode}
                  </span>
                </div>

                {/* Global Multiplier (if active for combos) */}
                {globalPricing.appliesToCombos && globalPricing.multiplier !== 1.0 && (
                  <div className="flex justify-between text-purple-600 bg-purple-50 p-2 rounded">
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {language === 'es' ? 'Ajuste Global' : 'Global Adjustment'} (×{globalPricing.multiplier.toFixed(2)}):
                    </span>
                    <span className="font-semibold">
                      {globalPricing.multiplier > 1 ? '+' : ''}
                      {currencySymbol}{(
                        parseFloat(getComboCalculatedPrices(comboForm).final) *
                        (globalPricing.multiplier - 1)
                      ).toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Final Customer Price */}
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span className="text-blue-600">
                    {language === 'es' ? 'Precio Final Cliente:' : 'Final Customer Price:'}
                  </span>
                  <span className="text-blue-600">
                    {currencySymbol}{(
                      parseFloat(getComboCalculatedPrices(comboForm).final) *
                      (globalPricing.appliesToCombos ? globalPricing.multiplier : 1)
                    ).toFixed(2)} {currencyCode}
                  </span>
                </div>

                {/* Info about global multiplier if not active */}
                {(!globalPricing.appliesToCombos || globalPricing.multiplier === 1.0) && (
                  <p className="text-xs text-gray-500 mt-2">
                    {language === 'es'
                      ? 'Sin ajuste de precio global aplicado a combos.'
                      : 'No global price adjustment applied to combos.'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-4 mt-6">
            <Button variant="outline" onClick={() => { setComboForm(null); setOriginalCurrencyId(null); }}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleComboSubmit} style={getPrimaryButtonStyle(visualSettings)}>
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
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <p className={`text-xs ${isDeactivated ? 'text-gray-400 line-through' : 'text-amber-600'}`}>
                        {language === 'es' ? 'Costo:' : 'Cost:'} {currencySymbol}{prices.base}
                      </p>
                      <p className={`text-sm font-semibold ${isDeactivated ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                        {currencySymbol}{prices.final}
                      </p>
                    </div>
                    {/* Show final price with global multiplier if active */}
                    {globalPricing.appliesToCombos && globalPricing.multiplier !== 1.0 && (
                      <p className={`text-base font-bold ${isDeactivated ? 'text-gray-400 line-through' : 'text-green-600'}`}>
                        {language === 'es' ? 'Cliente:' : 'Customer:'} {currencySymbol}{(parseFloat(prices.final) * globalPricing.multiplier).toFixed(2)} {currencyCode}
                      </p>
                    )}
                    {(!globalPricing.appliesToCombos || globalPricing.multiplier === 1.0) && (
                      <p className={`text-base font-bold ${isDeactivated ? 'text-gray-400 line-through' : 'text-green-600'}`}>
                        {currencySymbol}{prices.final} {currencyCode}
                      </p>
                    )}
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
