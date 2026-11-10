import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Save, Edit, X, RefreshCw, Percent, DollarSign, Tag, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getLiveConversionRate } from '@/lib/currencyService';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { isImageUploadError, getImageUploadMessageKey } from '@/lib/imageStorage';
import { isStockBelowReservedError } from '@/lib/stockErrors';
import { createProduct, deleteProduct, setProductActiveState, updateProduct as updateProductDB } from '@/lib/productService';
import { bulkDeleteProducts, previewBulkDeleteProducts } from '@/lib/bulkDeleteService';
import { isAlreadyDeletedError, shouldRefreshAfterBulkDelete } from '@/lib/deleteOutcomePure';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import BulkDeleteBar from '@/components/tables/BulkDeleteBar';
import { getTableColumns, getModalColumns } from './ProductTableConfig';
import { logActivity } from '@/lib/activityLogger';
import { hasAdminProductFields } from '@/lib/adminCatalogColumns';
import { DEFAULTS } from '@/lib/constants';
import { resolveMargin, resolveMarginInput } from '@/lib/marginResolver';
import { getUnitOptions, isKnownUnit, normalizeUnitCode } from '@/lib/productUnits';

const CUP_CODE = 'CUP';
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Vendor Inventory Tab Component
 * Manages product inventory with forms, images, and detailed table
 */
const VendorInventoryTab = ({
  products,
  categories,
  currencies,
  visualSettings,
  baseCurrencyId,
  selectedCurrency,
  exchangeRates,
  financialSettings,
  onSelectedCurrencyChange,
  onProductsRefresh
}) => {
  const { t, language } = useLanguage();
  const { user, isSuperAdmin } = useAuth();
  const { convertAmountAsync, getCurrencyById } = useCurrency();
  const [productForm, setProductForm] = useState(null);
  const [productImagePreview, setProductImagePreview] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [processingProductId, setProcessingProductId] = useState(null);
  const [deletingProductId, setDeletingProductId] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState([]);

  // Drop selected ids that no longer exist (deleted here or by another user)
  useEffect(() => {
    const present = new Set(products.map((p) => p.id));
    setSelectedProductIds((prev) => {
      const next = prev.filter((id) => present.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [products]);
  const [convertedPreview, setConvertedPreview] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  // Last price the user can trust, in its own currency: currency switches re-convert from it so round trips stay exact
  const priceAnchorRef = useRef(null);
  const currencySwitchSeqRef = useRef(0);
  const [currencyNote, setCurrencyNote] = useState(null);
  const [isSwitchingCurrency, setIsSwitchingCurrency] = useState(false);
  const switchingCurrencyRef = useRef(false);
  const submittingRef = useRef(false);
  const [filterName, setFilterName] = useState('');
  const [filterCategories, setFilterCategories] = useState([]);
  const [filterExpiry, setFilterExpiry] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Find base currency from currencies list
  const systemBaseCurrency = currencies.find(c => c.is_base);
  const systemBaseCurrencyId = systemBaseCurrency?.id || baseCurrencyId;
  const cupCurrency = currencies.find(c => c.code === CUP_CODE);

  // A cost typed in CUP (when CUP is not the base) is stored as cost_cup; the base price follows from the live
  // USD->CUP rate of the pair itself, never the inverse CUP->USD row. Throws when no valid rate exists (fail closed).
  const costCupToBase = async (costCup, cupCurrencyId) => {
    const rate = await getLiveConversionRate(systemBaseCurrencyId, cupCurrencyId);
    const base = round2(costCup / rate);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(base)) throw new Error('No valid exchange rate available');
    return base;
  };
  // Signal that the cost_cup migration is applied: admin rows only carry the cost_cup key after it (null or a number).
  // No loaded row with the key (old DB, or empty catalog) => compat mode: save exactly as before, never send cost_cup.
  const costCupAvailable = products.some(p => p.cost_cup !== undefined);
  const isCostInCup = (currencyId) =>
    costCupAvailable && getCurrencyById(currencyId)?.code === CUP_CODE && currencyId !== systemBaseCurrencyId;

  // Resolve the active form currency (from the currency selector)
  const formCurrency = getCurrencyById(productForm?.base_currency_id) || systemBaseCurrency;
  const formCurrencySymbol = formCurrency?.symbol || '$';
  const formCurrencyCode = formCurrency?.code || 'USD';
  const listCurrencyCode = getCurrencyById(selectedCurrency ?? baseCurrencyId)?.code || systemBaseCurrency?.code || '';

  // Catalog units; a stored code outside the catalog stays selectable so saving never wipes it
  const unitOptions = useMemo(() => {
    const options = getUnitOptions(language);
    const current = normalizeUnitCode(productForm?.unit);
    return current && !isKnownUnit(current) ? [...options, { value: current, label: current }] : options;
  }, [language, productForm?.unit]);

  // Calculate converted price preview when price or currency changes
  const updateConvertedPreview = useCallback(async (price, fromCurrencyId) => {
    setPreviewFailed(false);
    if (!price || !fromCurrencyId || !systemBaseCurrencyId) {
      setConvertedPreview(null);
      return;
    }

    // Same currency - no conversion needed
    if (fromCurrencyId === systemBaseCurrencyId) {
      setConvertedPreview(null);
      return;
    }

    setIsConverting(true);
    try {
      // Same live rate as the save: the preview is the amount that will be stored
      const converted = isCostInCup(fromCurrencyId)
        ? await costCupToBase(parseFloat(price), fromCurrencyId)
        : parseFloat(price) * await getLiveConversionRate(fromCurrencyId, systemBaseCurrencyId);
      if (!Number.isFinite(converted)) throw new Error('No valid exchange rate available');
      const baseCurrencyInfo = getCurrencyById(systemBaseCurrencyId);
      setConvertedPreview({
        amount: converted,
        symbol: baseCurrencyInfo?.symbol || '$',
        code: baseCurrencyInfo?.code || 'USD'
      });
    } catch (error) {
      console.warn('[VendorInventoryTab] Conversion preview error:', error);
      setConvertedPreview(null);
      setPreviewFailed(true);
    } finally {
      setIsConverting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCurrencyById, systemBaseCurrencyId]);

  // Trigger conversion preview when form price or currency changes
  useEffect(() => {
    if (productForm?.basePrice && productForm?.base_currency_id) {
      const timer = setTimeout(() => {
        updateConvertedPreview(productForm.basePrice, productForm.base_currency_id);
      }, 300); // Debounce 300ms
      return () => clearTimeout(timer);
    } else {
      setConvertedPreview(null);
    }
  }, [productForm?.basePrice, productForm?.base_currency_id, updateConvertedPreview]);

  const logProductActivity = async (action, productId, description, metadata = {}) => {
    try {
      await logActivity({
        action,
        entityType: 'product',
        entityId: productId,
        performedBy: user?.email || user?.id || 'anonymous',
        description,
        metadata
      });
    } catch (error) {
      console.warn('[VendorInventoryTab] Failed to log product activity', error?.message || error);
    }
  };

  const handleInputChange = (field, value) => {
    setProductForm(prev => ({ ...prev, [field]: value }));
  };

  // Cross-calculate profit fields when any one changes
  const handleProfitChange = (mode, value) => {
    const basePrice = parseFloat(productForm?.basePrice || 0);
    const numVal = parseFloat(value);

    if (mode === 'percentage') {
      // Block negative margins (would cause sell price < base price)
      if (!isNaN(numVal) && numVal < 0) {
        toast({ title: t('vendor.addProduct.sellPriceTooLow'), description: t('vendor.addProduct.sellPriceTooLowDesc'), variant: 'destructive' });
        return;
      }
      const margin = isNaN(numVal) ? '' : numVal;
      const amount = (!isNaN(numVal) && basePrice > 0) ? (basePrice * numVal / 100).toFixed(2) : '';
      const sell = (!isNaN(numVal) && basePrice > 0) ? (basePrice * (1 + numVal / 100)).toFixed(2) : '';
      setProductForm(prev => ({ ...prev, profitMargin: margin, profitAmount: amount, sellPrice: sell, profitMode: 'percentage', marginSource: 'product', marginTouched: true }));
    } else if (mode === 'amount') {
      // Block negative profit (would cause sell price < base price)
      if (!isNaN(numVal) && numVal < 0) {
        toast({ title: t('vendor.addProduct.sellPriceTooLow'), description: t('vendor.addProduct.sellPriceTooLowDesc'), variant: 'destructive' });
        return;
      }
      const amount = isNaN(numVal) ? '' : value;
      const margin = (!isNaN(numVal) && basePrice > 0) ? ((numVal / basePrice) * 100) : '';
      const sell = (!isNaN(numVal) && basePrice > 0) ? (basePrice + numVal).toFixed(2) : '';
      setProductForm(prev => ({ ...prev, profitMargin: margin !== '' ? parseFloat(margin.toFixed(4)) : '', profitAmount: amount, sellPrice: sell, profitMode: 'amount', marginSource: 'product', marginTouched: true }));
    } else if (mode === 'sellPrice') {
      // Block sell price below base price
      if (!isNaN(numVal) && basePrice > 0 && numVal < basePrice) {
        toast({ title: t('vendor.addProduct.sellPriceTooLow'), description: t('vendor.addProduct.sellPriceTooLowDesc'), variant: 'destructive' });
      }
      const sell = isNaN(numVal) ? '' : value;
      const margin = (!isNaN(numVal) && basePrice > 0) ? Math.max(0, ((numVal / basePrice) - 1) * 100) : '';
      const amount = (!isNaN(numVal) && basePrice > 0) ? Math.max(0, numVal - basePrice).toFixed(2) : '';
      setProductForm(prev => ({ ...prev, profitMargin: margin !== '' ? parseFloat(margin.toFixed(4)) : '', profitAmount: amount, sellPrice: sell, profitMode: 'sellPrice', marginSource: 'product', marginTouched: true }));
    }
  };

  // Recalculate secondary profit fields when basePrice changes
  // Pure: the form with a new base price and its derived profit fields
  const withBasePrice = (prev, value) => {
    const basePrice = parseFloat(value);
    const updated = { ...prev, basePrice: value };
    const margin = parseFloat(prev.profitMargin);
    if (!isNaN(margin) && basePrice > 0) {
      updated.profitAmount = (basePrice * margin / 100).toFixed(2);
      updated.sellPrice = (basePrice * (1 + margin / 100)).toFixed(2);
    } else {
      updated.profitAmount = '';
      updated.sellPrice = '';
    }
    return updated;
  };

  // Single reset point for the trusted price and any in-flight currency conversion:
  // used by open, cancel and save so a late response can never touch another form.
  const setSwitching = (value) => {
    switchingCurrencyRef.current = value;
    setIsSwitchingCurrency(value);
  };

  const resetPriceAnchor = (anchor = null) => {
    currencySwitchSeqRef.current += 1;
    setSwitching(false);
    priceAnchorRef.current = anchor;
    setCurrencyNote(null);
  };

  const closeProductForm = () => {
    resetPriceAnchor(null);
    setProductForm(null);
  };

  const handleBasePriceChange = (value) => {
    const typed = parseFloat(value);
    currencySwitchSeqRef.current += 1; // a typed figure beats any pending conversion
    setSwitching(false);
    // Editing only: a positive typed figure becomes the anchor (also after the field was emptied);
    // creating has no original price, so the figure is simply read in the selected currency.
    priceAnchorRef.current = productForm.id && typed > 0
      ? { amount: typed, currencyId: productForm.base_currency_id }
      : null;
    // A missing-rate alert stays until the next currency switch, form open or close
    setCurrencyNote(prev => (prev?.kind === 'missing' ? prev : null));
    setProductForm(prev => withBasePrice(prev, value));
  };

  // Switching the currency of an already loaded price re-converts the figure so its value is preserved.
  // The currency only changes together with the converted figure: if the conversion fails the
  // previous currency stays, so a figure is never shown under a currency it was not converted to.
  const handleCurrencyChange = async (nextCurrencyId) => {
    const seq = ++currencySwitchSeqRef.current;
    setSwitching(false); // supersedes any pending switch
    setCurrencyNote(null);
    const anchor = priceAnchorRef.current;
    if (!anchor) {
      // Create mode: no original price, the typed figure is read in the chosen currency
      handleInputChange('base_currency_id', nextCurrencyId);
      return;
    }

    const code = getCurrencyById(nextCurrencyId)?.code || '';
    let converted = anchor.amount;
    if (nextCurrencyId !== anchor.currencyId) {
      setSwitching(true);
      try {
        converted = await convertAmountAsync(anchor.amount, anchor.currencyId, nextCurrencyId);
      } catch (error) {
        console.warn('[VendorInventoryTab] Currency switch conversion failed:', error);
        converted = NaN;
      }
      if (seq !== currencySwitchSeqRef.current) return;
      setSwitching(false);
      converted = Math.round(converted * 100) / 100;
      // A zero/negative/non-finite result (also after rounding) is a failed conversion, never a price
      if (!Number.isFinite(converted) || converted <= 0) {
        setCurrencyNote({ kind: 'missing', code });
        return;
      }
    }

    setProductForm(prev => ({ ...withBasePrice(prev, String(converted)), base_currency_id: nextCurrencyId }));
    if (nextCurrencyId !== anchor.currencyId) setCurrencyNote({ kind: 'converted', code });
  };

  const defaultProfitMargin = resolveMarginInput(financialSettings?.productProfit, DEFAULTS.PRODUCT_PROFIT_MARGIN);

  // Precedence: product's own margin > category margin > global default.
  // Only used to pre-fill the form; existing product prices are never recomputed.
  const getEffectiveMargin = (productMargin, categoryId) => {
    const category = categories.find(c => c.id === categoryId);
    return resolveMargin({
      product: productMargin,
      category: category?.profit_margin,
      global: defaultProfitMargin
    });
  };

  // Re-suggest the margin from the newly selected category unless the admin already set one
  const handleCategoryChange = (categoryId) => {
    setProductForm(prev => {
      const next = { ...prev, category: categoryId };
      if (prev.marginTouched) return next;
      const effective = getEffectiveMargin(null, categoryId);
      const basePrice = parseFloat(prev.basePrice);
      return {
        ...next,
        profitMargin: effective.value,
        marginSource: effective.source,
        profitAmount: basePrice > 0 ? (basePrice * effective.value / 100).toFixed(2) : '',
        sellPrice: basePrice > 0 ? (basePrice * (1 + effective.value / 100)).toFixed(2) : ''
      };
    });
  };

  const openNewProductForm = () => {
    setProductForm({
      id: null,
      name_es: '',
      name_en: '',
      description_es: '',
      description_en: '',
      basePrice: '',
      base_currency_id: baseCurrencyId || '',
      category: '',
      stock: '',
      min_stock_alert: '',
      unit: '',
      expiryDate: '',
      image: '',
      profitMargin: defaultProfitMargin,
      marginSource: 'global',
      marginTouched: false,
      profitMode: 'percentage',
      profitAmount: '',
      sellPrice: ''
    });
    resetPriceAnchor(null);
    setProductImagePreview(null);
  };

  const openEditProductForm = (product) => {
    // Rows from the public catalog carry no cost fields: reload the admin data instead of
    // seeding a form that would overwrite them with defaults.
    if (!hasAdminProductFields(product)) {
      toast({ title: t('vendor.adminDataPending'), variant: 'destructive' });
      onProductsRefresh(true);
      return;
    }

    // A product's own margin always wins; NULL falls back to category, then global
    const { value: margin, source: marginSource } = getEffectiveMargin(
      product.profit_margin,
      product.category?.id || product.category_id
    );
    // A product with a CUP cost opens in CUP (the source of truth), not in the USD derived from it
    const costCup = product.cost_cup !== null && product.cost_cup !== undefined && cupCurrency
      ? parseFloat(product.cost_cup)
      : null;
    const hasCostCup = costCup !== null;
    const formPrice = hasCostCup ? costCup : (product.base_price || product.basePrice || '');
    const formCurrencyId = hasCostCup ? cupCurrency.id : (product.base_currency_id || baseCurrencyId || '');
    const base = parseFloat(formPrice || 0);
    resetPriceAnchor(base > 0 ? { amount: base, currencyId: formCurrencyId } : null);
    setProductForm({
      id: product.id,
      name_es: product.name_es || product.name || '',
      name_en: product.name_en || product.name || '',
      description_es: product.description_es || '',
      description_en: product.description_en || '',
      basePrice: formPrice,
      hadCostCup: hasCostCup,
      origPrice: formPrice,
      origCurrencyId: formCurrencyId,
      profitMargin: margin,
      marginSource,
      marginTouched: marginSource === 'product',
      profitMode: 'percentage',
      profitAmount: base > 0 ? (base * margin / 100).toFixed(2) : '',
      sellPrice: base > 0 ? (base * (1 + margin / 100)).toFixed(2) : '',
      base_currency_id: formCurrencyId,
      category: product.category?.id || product.category_id || '',
      stock: product.stock || '',
      min_stock_alert: product.min_stock_alert || '',
      unit: product.unit || '',
      expiryDate: product.expiry_date || product.expiryDate || '',
      image: product.image_url || product.image_file || product.image || '',
      sku: product.sku || ''
    });
    setProductImagePreview(product.image_url || product.image_file || product.image || null);
  };

  const handleViewProductDetails = (product) => {
    setSelectedProductId(product.id);
    setShowProductDetails(true);
  };

  const handleProductImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const result = await validateAndProcessImage(file, 'product');

      if (!result.success) {
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      setProductImagePreview(result.base64);
      setProductForm(prev => ({ ...prev, image: result.base64 }));

      toast({
        title: 'Imagen optimizada',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions} (${result.metadata.compression} compresión)`,
      });
    } catch (error) {
      console.error('[handleProductImageUpload] ERROR:', error);
      console.error('[handleProductImageUpload] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: 'Error al procesar imagen',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const submitProduct = async () => {

    if (!productForm.name_es || !productForm.basePrice || !productForm.category) {
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    if (!productForm.base_currency_id) {
      toast({
        title: 'Error',
        description: language === 'es' ? 'Debe seleccionar una moneda' : 'You must select a currency',
        variant: 'destructive'
      });
      return;
    }

    try {
      const category = categories.find(c => c.id === productForm.category);
      if (!category) {
        toast({
          title: 'Error',
          description: 'Categoría no válida',
          variant: 'destructive'
        });
        return;
      }

      // Convert price to base currency if different
      let normalizedPrice = parseFloat(productForm.basePrice);
      let finalCurrencyId = productForm.base_currency_id;
      const inputCurrency = getCurrencyById(productForm.base_currency_id);

      // undefined = leave cost_cup untouched (also keeps the payload valid before the migration is applied)
      let costCup;

      // Editing other fields must not reprice: an unchanged cost and currency sends neither base_price nor cost_cup
      // (compared at 2 decimals, like cost_cup: a sub-cent retype would otherwise reprice base_price while cost_cup stays equal)
      const costUnchanged = Boolean(productForm.id)
        && round2(parseFloat(productForm.basePrice)) === round2(parseFloat(productForm.origPrice))
        && productForm.base_currency_id === productForm.origCurrencyId;

      if (!costUnchanged && productForm.base_currency_id !== systemBaseCurrencyId) {
        try {
          // A saved price: converted with the rate read live, never the cached display rate.
          if (isCostInCup(productForm.base_currency_id)) {
            costCup = round2(parseFloat(productForm.basePrice));
            normalizedPrice = await costCupToBase(costCup, productForm.base_currency_id);
          } else {
            const liveRate = await getLiveConversionRate(productForm.base_currency_id, systemBaseCurrencyId);
            normalizedPrice = parseFloat(productForm.basePrice) * liveRate;
            if (!Number.isFinite(normalizedPrice)) throw new Error('No valid exchange rate available');
          }
          finalCurrencyId = systemBaseCurrencyId;
        } catch (convError) {
          // Never persist a number typed in one currency under another: abort and keep the form open
          console.warn('[handleSubmitProduct] Conversion failed, save aborted:', convError);
          toast({
            title: t('common.error'),
            description: t('vendor.inventory.conversionToBaseFailed'),
            variant: 'destructive'
          });
          return;
        }
      }

      // A zero USD price (tiny CUP cost / big rate) must never be saved
      if (costCup !== undefined && normalizedPrice < 0.01) {
        toast({
          title: t('common.error'),
          description: t('vendor.inventory.costTooLow'),
          variant: 'destructive'
        });
        return;
      }

      // A fixed non-CUP cost must not be repriced by the rate: clear a previously stored cost_cup
      if (!costUnchanged && costCup === undefined && productForm.id && productForm.hadCostCup) costCup = null;

      const productData = {
        name_es: productForm.name_es,
        name_en: productForm.name_en || productForm.name_es,
        description_es: productForm.description_es || '',
        description_en: productForm.description_en || '',
        basePrice: costUnchanged ? undefined : normalizedPrice,
        costCup,
        stock: parseInt(productForm.stock || 0, 10),
        min_stock_alert: parseInt(productForm.min_stock_alert || 10, 10),
        unit: normalizeUnitCode(productForm.unit),
        profitMargin: resolveMarginInput(productForm.profitMargin, DEFAULTS.PRODUCT_PROFIT_MARGIN),
        category_id: productForm.category,
        base_currency_id: costUnchanged ? undefined : finalCurrencyId,
        image: productForm.image || '',
        sku: productForm.sku || `SKU-${Date.now()}`,
        slug: productForm.name_es.toLowerCase().replace(/\s+/g, '-'),
        expiryDate: productForm.expiryDate || null
      };

      if (productForm.id) {
        await updateProductDB(productForm.id, productData);
        await logProductActivity('product_updated', productForm.id, `Product ${productData.name_es} updated`, {
          name_es: productData.name_es,
          name_en: productData.name_en,
          category_id: productData.category_id,
          basePrice: productData.basePrice,
          profitMargin: productData.profitMargin,
          stock: productData.stock,
          min_stock_alert: productData.min_stock_alert,
          base_currency_id: productData.base_currency_id,
          expiryDate: productData.expiryDate || null,
          sku: productData.sku,
          imageUpdated: Boolean(productData.image)
        });
        toast({ title: t('vendor.productUpdated') });
      } else {
        const createdProduct = await createProduct(productData);
        await logProductActivity('product_created', createdProduct?.id || productData.slug || productData.name_es, `Product ${productData.name_es} created`, {
          name_es: productData.name_es,
          name_en: productData.name_en,
          category_id: productData.category_id,
          basePrice: productData.basePrice,
          profitMargin: productData.profitMargin,
          stock: productData.stock,
          min_stock_alert: productData.min_stock_alert,
          base_currency_id: productData.base_currency_id,
          expiryDate: productData.expiryDate || null,
          sku: productData.sku,
          imageUpdated: Boolean(productData.image)
        });
        toast({ title: t('vendor.productAdded') });
      }

      await onProductsRefresh(true);
      closeProductForm();
      setProductImagePreview(null);
    } catch (error) {
      console.error('[handleSubmitProduct] ERROR:', error);
      console.error('[handleSubmitProduct] Error details:', { message: error?.message, code: error?.code, stack: error?.stack });
      toast({
        title: 'Error',
        description: isStockBelowReservedError(error)
          ? t('vendor.inventory.stockBelowReserved')
          : (isImageUploadError(error) ? t(getImageUploadMessageKey(error)) : error.message),
        variant: 'destructive'
      });
    }
  };

  // Ignores clicks while a currency conversion or an earlier save is still in flight (no duplicate creates)
  const handleSubmitProduct = async () => {
    if (switchingCurrencyRef.current || submittingRef.current) return;
    submittingRef.current = true;
    try {
      await submitProduct();
    } finally {
      submittingRef.current = false;
    }
  };

  const handleToggleProductActive = async (product, nextActive) => {
    setProcessingProductId(product.id);
    try {
      await setProductActiveState(product.id, nextActive);
      await logProductActivity(
        nextActive ? 'product_activated' : 'product_deactivated',
        product.id,
        `Product ${product.name_es || product.name_en || product.id} ${nextActive ? 'activated' : 'deactivated'}`,
        { isActive: nextActive }
      );

      toast({
        title: nextActive ? t('vendor.inventory.productActivated') : t('vendor.inventory.productDeactivated'),
        description: language === 'es'
          ? `${product.name_es || product.name_en || product.id} ${nextActive ? 'activado' : 'desactivado'}`
          : `${product.name_en || product.name_es || product.id} ${nextActive ? 'activated' : 'deactivated'}`
      });

      await onProductsRefresh(true);
    } catch (error) {
      console.error('[handleToggleProductActive] ERROR:', error);
      console.error('[handleToggleProductActive] Error details:', { message: error?.message, code: error?.code, context: error?.context });
      const directOrders = error?.context?.directOrders || [];
      const comboOrders = error?.context?.comboOrders || [];
      const hasBlockingOrders = directOrders.length > 0 || comboOrders.length > 0;

      let description = error?.message || (language === 'es'
        ? 'No se pudo actualizar el estado del producto.'
        : 'Could not update the product status.');

      if (hasBlockingOrders) {
        description = t('vendor.inventory.toggleBlockedOrders');
        if (comboOrders.length > 0) {
          description = `${description} ${t('vendor.inventory.toggleBlockedCombos')}`;
        }
      }

      toast({
        title: t('common.error'),
        description,
        variant: 'destructive'
      });
    } finally {
      setProcessingProductId(null);
    }
  };

  // Refreshes the product list; a failure is reported but never thrown, so it
  // cannot be mistaken for a failed delete or become an unhandled rejection.
  const refreshProductsSafely = async () => {
    try {
      await onProductsRefresh(true);
    } catch (refreshError) {
      console.error('[refreshProductsSafely] ERROR:', refreshError);
      toast({
        title: t('vendor.inventory.refreshFailed'),
        variant: 'destructive'
      });
    }
  };

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;
    setDeletingProductId(productToDelete.id);
    let deleteResult;
    try {
      // Pass user info for activity logging
      deleteResult = await deleteProduct(productToDelete.id, user?.email || user?.id || 'anonymous');
    } catch (error) {
      if (isAlreadyDeletedError(error)) {
        toast({ title: t('vendor.inventory.productAlreadyDeleted') });
        setProductToDelete(null);
        await refreshProductsSafely();
      } else {
        console.error('[handleDeleteProduct] ERROR:', error);
        toast({
          title: t('common.error'),
          description: error?.message || (language === 'es' ? 'No se pudo eliminar el producto.' : 'Could not delete the product.'),
          variant: 'destructive'
        });
      }
      setDeletingProductId(null);
      return;
    }

    // Build toast description with deactivated combos info
    const productName = productToDelete.name_es || productToDelete.name_en || productToDelete.id;
    let toastDescription = language === 'es'
      ? `${productName} eliminado`
      : `${productName} deleted`;

    if (deleteResult?.deactivatedCombos?.length > 0) {
      const comboNames = deleteResult.deactivatedCombos.map(c => c.name).join(', ');
      toastDescription += language === 'es'
        ? `. Combos desactivados: ${comboNames}`
        : `. Deactivated combos: ${comboNames}`;
    }

    toast({
      title: t('vendor.inventory.productDeleted'),
      description: toastDescription
    });
    setProductToDelete(null);
    await refreshProductsSafely();
    setDeletingProductId(null);
  };

  const handleBulkDeleteProducts = async (ids) => {
    const outcome = await bulkDeleteProducts(ids);
    if (outcome.deleted.length > 0) {
      toast({
        title: t('vendor.inventory.productDeleted'),
        description: (t('tables.bulkDeleteSuccess') || '{count} item(s) deleted').replace('{count}', outcome.deleted.length)
      });
    }
    if (shouldRefreshAfterBulkDelete(outcome)) {
      await refreshProductsSafely();
    }
    return outcome;
  };

  const getProductLabelById = (id) => {
    const product = products.find((p) => p.id === id);
    return product ? (product.name_es || product.name_en || id) : id;
  };

  // Función para convertir precio según moneda seleccionada
  const convertPrice = (price, fromCurrencyId, toCurrencyId) => {
    if (!price || fromCurrencyId === toCurrencyId) return price;

    const rateKey = `${fromCurrencyId}-${toCurrencyId}`;
    const rate = exchangeRates[rateKey];

    if (rate) {
      return price * rate;
    }

    // Si no existe tasa directa, intentar inversa
    const inverseRateKey = `${toCurrencyId}-${fromCurrencyId}`;
    const inverseRate = exchangeRates[inverseRateKey];

    if (inverseRate && inverseRate !== 0) {
      return price / inverseRate;
    }

    // No rate: null so the UI shows an em dash, never an unconverted number under another symbol.
    // shortcut: local rate map fetched once by VendorPage; upgrade with the unified rate system (RB-17)
    return null;
  };

  // Productos con precios convertidos
  const productsWithConvertedPrices = products.map(product => {
    const convertedBasePrice = convertPrice(
      product.base_price,
      product.base_currency_id || baseCurrencyId,
      selectedCurrency || baseCurrencyId
    );

    const convertedFinalPrice = convertPrice(
      product.final_price,
      product.base_currency_id || baseCurrencyId,
      selectedCurrency || baseCurrencyId
    );

    return {
      ...product,
      base_price: convertedBasePrice,
      final_price: convertedFinalPrice,
      // Flag only real conversion failures: a price that was already missing keeps the old fallbacks
      price_unavailable:
        (product.base_price != null && convertedBasePrice === null) ||
        (product.final_price != null && convertedFinalPrice === null),
      display_currency_id: selectedCurrency || baseCurrencyId
    };
  });

  // Resolved by id at use time so a products refresh never leaves a stale snapshot
  const selectedProduct = productsWithConvertedPrices.find(p => p.id === selectedProductId) || null;

  const notifyProductGone = () =>
    toast({ title: t('common.error'), description: t('vendor.inventory.productNotFound'), variant: 'destructive' });

  // The product was deleted/refreshed away while its details were open: close and say so
  useEffect(() => {
    if (showProductDetails && selectedProductId && !selectedProduct) {
      notifyProductGone();
      setShowProductDetails(false);
    }
  }, [showProductDetails, selectedProductId, selectedProduct]);

  // Apply filters
  const filteredProducts = useMemo(() => {
    let result = productsWithConvertedPrices;

    // Filter by name
    if (filterName.trim()) {
      const search = filterName.trim().toLowerCase();
      result = result.filter(p =>
        (p.name_es || '').toLowerCase().includes(search) ||
        (p.name_en || '').toLowerCase().includes(search)
      );
    }

    // Filter by categories (multi-select)
    if (filterCategories.length > 0) {
      result = result.filter(p => {
        const catId = p.category?.id || p.category_id;
        return filterCategories.includes(catId);
      });
    }

    // Filter by expiry date
    if (filterExpiry) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      result = result.filter(p => {
        const expiry = p.expiry_date || p.expiryDate;
        if (!expiry) return filterExpiry === 'none';
        const expiryDate = new Date(expiry);
        expiryDate.setHours(0, 0, 0, 0);
        const daysLeft = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
        if (filterExpiry === 'expired') return daysLeft < 0;
        if (filterExpiry === 'week') return daysLeft >= 0 && daysLeft <= 7;
        if (filterExpiry === 'month') return daysLeft >= 0 && daysLeft <= 30;
        if (filterExpiry === 'none') return !expiry;
        return true;
      });
    }

    return result;
  }, [productsWithConvertedPrices, filterName, filterCategories, filterExpiry]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header con selector de moneda y botón agregar */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 sm:mb-6">
        {/* Currency Selector */}
        {productForm ? (
          // Same box height as the select so opening the form causes no layout shift
          <p
            data-testid="list-currency-cue"
            className="flex items-center min-h-[34px] sm:min-h-[42px] text-xs sm:text-sm font-medium text-gray-700"
          >
            {t('vendor.inventory.listPricesCue', { code: listCurrencyCode })}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <label htmlFor="inventory-list-currency" className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">
              {t('vendor.inventory.viewPricesIn')}
            </label>
            <select
              id="inventory-list-currency"
              value={selectedCurrency ?? baseCurrencyId ?? ''}
              onChange={(e) => onSelectedCurrencyChange(e.target.value)}
              className="flex-1 px-2 sm:px-3 py-1.5 sm:py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {currencies.map(currency => (
                <option key={currency.id} value={currency.id}>
                  {currency.code}
                </option>
              ))}
            </select>
          </div>
        )}

        <Button onClick={openNewProductForm} style={getPrimaryButtonStyle(visualSettings)} className="flex-shrink-0 h-9 sm:h-10 px-3 sm:px-4 text-sm">
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{t('vendor.actions.addProduct')}</span>
        </Button>
      </div>

      {productForm && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-effect p-8 rounded-2xl mb-12"
        >
          <h2 className="text-2xl font-semibold mb-6">
            {productForm.id ? t('vendor.addProduct.editTitle') : t('vendor.addProduct.title')}
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Product Name (Spanish) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.nameSpanish')} *
              </label>
              <input
                type="text"
                value={productForm.name_es}
                onChange={e => handleInputChange('name_es', e.target.value)}
                placeholder={t('vendor.addProduct.namePlaceholder')}
                className="w-full input-style"
                required
              />
            </div>

            {/* Product Name (English) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.nameEnglish')}
              </label>
              <input
                type="text"
                value={productForm.name_en}
                onChange={e => handleInputChange('name_en', e.target.value)}
                placeholder={t('vendor.addProduct.namePlaceholder')}
                className="w-full input-style"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.category')} *
              </label>
              <select
                value={productForm.category}
                onChange={e => handleCategoryChange(e.target.value)}
                className="w-full input-style"
                required
              >
                <option value="">
                  {language === 'es' ? 'Seleccionar categoría' : 'Select category'}
                </option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {language === 'es' ? c.name_es : c.name_en}
                  </option>
                ))}
              </select>
            </div>

            {/* Description - Bilingual */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'es' ? 'Descripción (Español)' : 'Description (Spanish)'}
              </label>
              <textarea
                value={productForm.description_es}
                onChange={e => handleInputChange('description_es', e.target.value)}
                placeholder={
                  language === 'es'
                    ? 'Descripción del producto en español'
                    : 'Product description in Spanish'
                }
                rows={3}
                className="w-full input-style"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'es' ? 'Descripción (Inglés)' : 'Description (English)'}
              </label>
              <textarea
                value={productForm.description_en}
                onChange={e => handleInputChange('description_en', e.target.value)}
                placeholder={
                  language === 'es'
                    ? 'Descripción del producto en inglés'
                    : 'Product description in English'
                }
                rows={3}
                className="w-full input-style"
              />
            </div>

            {/* Base Price */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {isCostInCup(productForm.base_currency_id) ? t('vendor.inventory.costCupLabel') : t('vendor.addProduct.basePrice')} *
              </label>
              <input
                type="number"
                step="0.01"
                data-testid="product-base-price-input"
                value={productForm.basePrice}
                onChange={e => handleBasePriceChange(e.target.value)}
                placeholder="0.00"
                className="w-full input-style"
                required
              />
              {/* Conversion Preview */}
              {convertedPreview && (
                <div className="mt-2 flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                  <RefreshCw className={`w-4 h-4 ${isConverting ? 'animate-spin' : ''}`} />
                  <span>
                    ≈ {convertedPreview.symbol}{convertedPreview.amount.toFixed(2)} {convertedPreview.code}
                    <span className="text-gray-500 ml-1">
                      ({language === 'es' ? 'precio base' : 'base price'})
                    </span>
                  </span>
                </div>
              )}
              {previewFailed && !isConverting && (
                <p role="status" className="mt-2 text-xs text-amber-700">
                  {t('vendor.inventory.previewUnavailable')}
                </p>
              )}
              {isConverting && !convertedPreview && (
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{language === 'es' ? 'Calculando...' : 'Calculating...'}</span>
                </div>
              )}
            </div>

            {/* Currency */}
            <div>
              <label htmlFor="product-price-currency" className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.inventory.priceCurrencyLabel')}
              </label>
              <select
                id="product-price-currency"
                aria-describedby="product-price-currency-help"
                value={productForm.base_currency_id}
                onChange={e => handleCurrencyChange(e.target.value)}
                className="w-full input-style"
              >
                {currencies.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.is_base ? (language === 'es' ? '(Base)' : '(Base)') : ''}
                  </option>
                ))}
              </select>
              <p id="product-price-currency-help" className="mt-2 text-xs text-gray-500">
                {t('vendor.inventory.priceCurrencyHelp', { base: systemBaseCurrency?.code || 'USD' })}
              </p>
              {isSwitchingCurrency && (
                <p role="status" aria-busy="true" className="mt-2 text-xs text-gray-500">
                  {t('vendor.inventory.priceConverting')}
                </p>
              )}
              {currencyNote?.kind === 'converted' && (
                <p role="status" className="mt-2 text-xs text-blue-700">
                  {t('vendor.inventory.priceConvertedNote', { code: currencyNote.code })}
                </p>
              )}
              {currencyNote?.kind === 'missing' && (
                <p role="alert" className="mt-2 text-xs text-red-600">
                  {t('vendor.inventory.priceRateMissing', { code: currencyNote.code })}
                </p>
              )}
            </div>

            {/* Profit Mode */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.profitMode')}
              </label>
              {/* Mode Toggle */}
              <div className="flex gap-1 mb-3 bg-gray-100 p-1 rounded-lg w-fit">
                {[
                  { id: 'percentage', icon: Percent, label: t('vendor.addProduct.profitByPercent') },
                  { id: 'amount', icon: DollarSign, label: `${t('vendor.addProduct.profitByAmount')} (${formCurrencyCode})` },
                  { id: 'sellPrice', icon: Tag, label: `${t('vendor.addProduct.profitBySellPrice')} (${formCurrencyCode})` }
                ].map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      if (parseFloat(productForm.basePrice || 0) <= 0 && mode.id !== 'percentage') {
                        toast({
                          title: t('vendor.addProduct.basePriceRequired'),
                          variant: 'destructive'
                        });
                        return;
                      }
                      setProductForm(prev => ({ ...prev, profitMode: mode.id }));
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      productForm.profitMode === mode.id
                        ? 'bg-white shadow text-gray-900'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <mode.icon className="h-3.5 w-3.5" />
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Dynamic Input */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  {productForm.profitMode === 'percentage' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('vendor.addProduct.profitByPercent')}</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={productForm.profitMargin}
                          onChange={e => handleProfitChange('percentage', e.target.value)}
                          placeholder={String(defaultProfitMargin)}
                          className="w-full input-style pr-8"
                          data-testid="product-profit-margin-input"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                      </div>
                      {productForm.marginSource && (
                        <p
                          className="text-xs text-gray-500 mt-1"
                          data-testid="product-margin-source"
                          data-source={productForm.marginSource}
                        >
                          {t(`vendor.addProduct.marginSource.${productForm.marginSource}`)}
                        </p>
                      )}
                    </div>
                  )}
                  {productForm.profitMode === 'amount' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('vendor.addProduct.profitAmountLabel').replace('{symbol}', formCurrencySymbol)}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{formCurrencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={productForm.profitAmount}
                          onChange={e => handleProfitChange('amount', e.target.value)}
                          placeholder="0.00"
                          className="w-full input-style pl-7"
                        />
                      </div>
                    </div>
                  )}
                  {productForm.profitMode === 'sellPrice' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('vendor.addProduct.sellPriceLabel').replace('{symbol}', formCurrencySymbol)}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{formCurrencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={productForm.sellPrice}
                          onChange={e => handleProfitChange('sellPrice', e.target.value)}
                          placeholder="0.00"
                          className={`w-full input-style pl-7 ${
                            parseFloat(productForm.sellPrice || 0) > 0 && parseFloat(productForm.sellPrice) < parseFloat(productForm.basePrice || 0)
                              ? 'border-red-400 ring-1 ring-red-400'
                              : ''
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Preview */}
                {parseFloat(productForm.basePrice || 0) > 0 && productForm.profitMargin !== '' && !isNaN(parseFloat(productForm.profitMargin)) && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col justify-center text-sm">
                    <p className="text-gray-500 text-xs mb-1">{t('vendor.addProduct.profitPreview')}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span className="font-medium text-gray-700">
                        {t('vendor.addProduct.profitByPercent')}: <span className="text-blue-600">{parseFloat(productForm.profitMargin).toFixed(2)}%</span>
                      </span>
                      <span className="font-medium text-gray-700">
                        = <span className="text-green-600">{formCurrencySymbol}{parseFloat(productForm.profitAmount || 0).toFixed(2)}</span>
                      </span>
                      <span className="font-medium text-gray-700">
                        | {t('vendor.addProduct.profitBySellPrice')}: <span className="text-purple-600">{formCurrencySymbol}{parseFloat(productForm.sellPrice || 0).toFixed(2)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Stock */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.inventory.stock')}
              </label>
              <input
                type="number"
                value={productForm.stock}
                onChange={e => handleInputChange('stock', e.target.value)}
                placeholder="0"
                className="w-full input-style"
              />
            </div>

            {/* Minimum Stock Alert */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.inventory.minStock')}
              </label>
              <input
                type="number"
                value={productForm.min_stock_alert}
                onChange={e => handleInputChange('min_stock_alert', e.target.value)}
                placeholder="10"
                className="w-full input-style"
              />
            </div>

            {/* Unit of measure (optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.unit')}
              </label>
              <select
                data-testid="product-unit-select"
                value={productForm.unit || ''}
                onChange={e => handleInputChange('unit', e.target.value)}
                className="w-full input-style"
              >
                <option value="">{t('vendor.addProduct.unitNone')}</option>
                {unitOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{t('vendor.addProduct.unitHelp')}</p>
            </div>

            {/* Expiry Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.inventory.expiryDate')}
              </label>
              <input
                type="date"
                value={productForm.expiryDate}
                onChange={e => handleInputChange('expiryDate', e.target.value)}
                className="w-full input-style"
              />
            </div>

            {/* Product Image */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.image')}
              </label>

              {productImagePreview && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Vista Previa:' : 'Preview:'}
                  </p>
                  <div className="aspect-square max-w-sm mx-auto rounded-lg overflow-hidden border-2 border-gray-300 bg-gray-100">
                    <img
                      src={productImagePreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleProductImageUpload}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <p className="text-xs text-gray-500 mt-2">
                {language === 'es'
                  ? 'Recomendado: imagen cuadrada (1:1), máx 5MB'
                  : 'Recommended: square image (1:1), max 5MB'}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-4 mt-6">
            <Button variant="outline" onClick={closeProductForm}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitProduct} disabled={isSwitchingCurrency} style={getPrimaryButtonStyle(visualSettings)}>
              <Save className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('vendor.addProduct.save')}</span>
            </Button>
          </div>
        </motion.div>
      )}

      {/* Filter Bar */}
      <div className="mb-4 space-y-3">
        {/* Search + Toggle */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              placeholder={t('vendor.inventory.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            {filterName && (
              <button onClick={() => setFilterName('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
              showFilters || filterCategories.length > 0 || filterExpiry
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">{t('vendor.inventory.filters')}</span>
            {(filterCategories.length > 0 || filterExpiry) && (
              <span className="bg-purple-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                {filterCategories.length + (filterExpiry ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="flex flex-col sm:flex-row gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            {/* Category Multi-Select */}
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('vendor.inventory.filterByCategory')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map(cat => {
                  const isSelected = filterCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setFilterCategories(prev =>
                        isSelected ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                      )}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        isSelected
                          ? 'bg-purple-100 border-purple-400 text-purple-700 font-medium'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {language === 'es' ? cat.name_es : cat.name_en}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Expiry Date Filter */}
            <div className="sm:w-48">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('vendor.inventory.filterByExpiry')}
              </label>
              <select
                value={filterExpiry}
                onChange={e => setFilterExpiry(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">{t('vendor.inventory.expiryAll')}</option>
                <option value="expired">{t('vendor.inventory.expiryExpired')}</option>
                <option value="week">{t('vendor.inventory.expiryWeek')}</option>
                <option value="month">{t('vendor.inventory.expiryMonth')}</option>
                <option value="none">{t('vendor.inventory.expiryNone')}</option>
              </select>
            </div>

            {/* Clear Filters */}
            {(filterCategories.length > 0 || filterExpiry) && (
              <div className="sm:self-end">
                <button
                  onClick={() => { setFilterCategories([]); setFilterExpiry(''); }}
                  className="text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
                >
                  {t('vendor.inventory.clearFilters')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Results count when filtering */}
        {(filterName || filterCategories.length > 0 || filterExpiry) && (
          <p className="text-xs text-gray-500">
            {t('vendor.inventory.showingResults').replace('{count}', filteredProducts.length).replace('{total}', products.length)}
          </p>
        )}
      </div>

      {/* Responsive Products Table */}
      <ResponsiveTableWrapper
        data={filteredProducts}
        columns={getTableColumns(t, language, currencies, {
          onToggleActive: handleToggleProductActive,
          togglingId: processingProductId,
          onDelete: setProductToDelete,
          deletingId: deletingProductId
        })}
        onRowClick={handleViewProductDetails}
        emptyMessage={t('vendor.inventory.noProducts') || 'No products found'}
        pageSize={10}
        pageSizeOptions={[10, 20, 50]}
        selectable={isSuperAdmin}
        selectedIds={selectedProductIds}
        onSelectionChange={setSelectedProductIds}
      />

      {isSuperAdmin && (
        <BulkDeleteBar
          selectedIds={selectedProductIds}
          onClearSelection={(remainingIds) => setSelectedProductIds(remainingIds || [])}
          onConfirmDelete={handleBulkDeleteProducts}
          onPreview={previewBulkDeleteProducts}
          getItemLabel={getProductLabelById}
        />
      )}

      {/* Delete Confirmation Modal */}
      {productToDelete && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setProductToDelete(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold text-gray-900">
              {t('vendor.inventory.deleteConfirmTitle')}
            </h3>
            <p className="text-sm text-gray-700">
              {t('vendor.inventory.deleteConfirmMessage', {
                name: language === 'es'
                  ? (productToDelete.name_es || productToDelete.name_en || productToDelete.id)
                  : (productToDelete.name_en || productToDelete.name_es || productToDelete.id)
              })}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setProductToDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteProduct}
                disabled={deletingProductId === productToDelete.id}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Product Details Modal - Responsive */}
      {showProductDetails && selectedProduct && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-50"
          onClick={() => setShowProductDetails(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between rounded-t-lg">
              <h3 className="text-base sm:text-xl font-bold text-gray-900 truncate pr-2">
                <span className="hidden sm:inline">{t('vendor.inventory.productDetails')} - </span>
                {language === 'es' ? selectedProduct.name_es : selectedProduct.name_en}
              </h3>
              <button
                onClick={() => setShowProductDetails(false)}
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <X className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </div>

            <div className="p-3 sm:p-6 flex flex-col lg:grid lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Product Image - First on mobile */}
              <div className="lg:col-span-1 lg:order-2">
                {selectedProduct.image_url || selectedProduct.image_file || selectedProduct.image ? (
                  <div className="space-y-2 sm:space-y-3 lg:sticky lg:top-20">
                    <h4 className="text-sm sm:text-lg font-semibold text-gray-900 hidden lg:block">
                      {language === 'es' ? 'Imagen del Producto' : 'Product Image'}
                    </h4>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-1 sm:p-2">
                      <img
                        src={selectedProduct.image_url || selectedProduct.image_file || selectedProduct.image}
                        alt={selectedProduct.name_es || selectedProduct.name}
                        className="w-full h-auto max-h-48 sm:max-h-64 lg:max-h-none object-contain rounded-lg"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="lg:sticky lg:top-20 bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-yellow-800 font-medium">
                      {language === 'es' ? 'Sin imagen' : 'No image'}
                    </p>
                  </div>
                )}
              </div>

              {/* Product Information */}
              <div className="lg:col-span-2 lg:order-1 space-y-4 sm:space-y-6">
                {/* Product Info Grid */}
                <div className="grid grid-cols-2 gap-2 sm:gap-4">
                  <ProductInfoItem
                    label={t('vendor.inventory.product')}
                    value={language === 'es'
                      ? (selectedProduct.name_es || selectedProduct.name_en)
                      : (selectedProduct.name_en || selectedProduct.name_es)
                    }
                  />
                  <ProductInfoItem label={t('vendor.addProduct.category')} value={selectedProduct.category ? (language === 'es' ? selectedProduct.category.name_es : selectedProduct.category.name_en) : 'Sin categoría'} />
                  <ProductInfoItem label={t('vendor.inventory.stock')} value={selectedProduct.stock || 0} />
                  <ProductInfoItem label={t('vendor.inventory.currency')} value={currencies.find(c => c.id === (selectedProduct.display_currency_id || selectedProduct.base_currency_id))?.code || 'USD'} />
                  <ProductInfoItem label={t('vendor.inventory.basePrice')} value={selectedProduct.price_unavailable ? '—' : `${currencies.find(c => c.id === (selectedProduct.display_currency_id || selectedProduct.base_currency_id))?.symbol || '$'}${Number(selectedProduct.base_price || 0).toFixed(2)}`} />
                  <ProductInfoItem label={t('vendor.inventory.price')} value={selectedProduct.price_unavailable ? '—' : `${currencies.find(c => c.id === (selectedProduct.display_currency_id || selectedProduct.base_currency_id))?.symbol || '$'}${Number(selectedProduct.final_price || 0).toFixed(2)}`} />
                  <ProductInfoItem label={t('vendor.inventory.minStock')} value={selectedProduct.min_stock_alert || 10} />
                  <ProductInfoItem label={t('vendor.inventory.expiryDate')} value={selectedProduct.expiry_date ? new Date(selectedProduct.expiry_date).toLocaleDateString() : 'N/A'} />
                </div>

                {/* Description - Based on active language */}
                {(language === 'es' ? selectedProduct.description_es : selectedProduct.description_en || selectedProduct.description_es) && (
                  <div>
                    <h4 className="text-sm sm:text-lg font-semibold text-gray-900 mb-2 sm:mb-3">
                      {t('vendor.addProduct.description')}
                    </h4>
                    <p className="text-xs sm:text-sm text-gray-700 bg-gray-50 rounded-lg p-3 sm:p-4">
                      {language === 'es'
                        ? (selectedProduct.description_es || selectedProduct.description_en)
                        : (selectedProduct.description_en || selectedProduct.description_es)
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-3 sm:px-6 py-3 sm:py-4 flex justify-end gap-2 sm:gap-3 rounded-b-lg">
              <Button variant="outline" onClick={() => setShowProductDetails(false)} className="text-sm sm:text-base">
                <X className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('common.cancel')}</span>
              </Button>
              <Button onClick={() => {
                // Edit always seeds from the stored record, never from the display-converted row
                const original = products.find(p => p.id === selectedProductId);
                if (original) openEditProductForm(original);
                else notifyProductGone();
                setShowProductDetails(false);
              }} style={getPrimaryButtonStyle(visualSettings)} className="text-sm sm:text-base">
                <Edit className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('common.edit')}</span>
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
};

// Helper component for product info items
const ProductInfoItem = ({ label, value }) => (
  <div className="overflow-hidden">
    <dt className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wider mb-0.5 sm:mb-1 truncate">{label}</dt>
    <dd className="text-xs sm:text-sm text-gray-900 font-medium truncate" title={String(value)}>{value}</dd>
  </div>
);

export default VendorInventoryTab;
