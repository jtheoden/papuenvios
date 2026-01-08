import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Save, Edit, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createProduct, deleteProduct, setProductActiveState, updateProduct as updateProductDB } from '@/lib/productService';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import { getTableColumns, getModalColumns } from './ProductTableConfig';
import { logActivity } from '@/lib/activityLogger';
import { useRealtimeProducts } from '@/hooks/useRealtimeSubscription';

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
  onSelectedCurrencyChange,
  onProductsRefresh
}) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { convertAmountAsync, getCurrencyById } = useCurrency();
  const [productForm, setProductForm] = useState(null);
  const [productImagePreview, setProductImagePreview] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [processingProductId, setProcessingProductId] = useState(null);
  const [deletingProductId, setDeletingProductId] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [convertedPreview, setConvertedPreview] = useState(null);
  const [isConverting, setIsConverting] = useState(false);

  // Find base currency from currencies list
  const systemBaseCurrency = currencies.find(c => c.is_base);
  const systemBaseCurrencyId = systemBaseCurrency?.id || baseCurrencyId;

  // Calculate converted price preview when price or currency changes
  const updateConvertedPreview = useCallback(async (price, fromCurrencyId) => {
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
      const converted = await convertAmountAsync(parseFloat(price), fromCurrencyId, systemBaseCurrencyId);
      const baseCurrencyInfo = getCurrencyById(systemBaseCurrencyId);
      setConvertedPreview({
        amount: converted,
        symbol: baseCurrencyInfo?.symbol || '$',
        code: baseCurrencyInfo?.code || 'USD'
      });
    } catch (error) {
      console.warn('[VendorInventoryTab] Conversion preview error:', error);
      setConvertedPreview(null);
    } finally {
      setIsConverting(false);
    }
  }, [convertAmountAsync, getCurrencyById, systemBaseCurrencyId]);

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

  // Real-time subscription for product updates
  useRealtimeProducts({
    enabled: true,
    onUpdate: () => {
      console.log('[VendorInventoryTab] Products realtime update detected');
      if (onProductsRefresh) {
        onProductsRefresh(true);
      }
    }
  });

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

  const openNewProductForm = () => {
    console.log('[openNewProductForm] START - Opening new product form');
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
      expiryDate: '',
      image: ''
    });
    setProductImagePreview(null);
    console.log('[openNewProductForm] SUCCESS - Form initialized');
  };

  const openEditProductForm = (product) => {
    console.log('[openEditProductForm] START - Input:', { productId: product.id, productName: product.name_es || product.name });
    setProductForm({
      id: product.id,
      name_es: product.name_es || product.name || '',
      name_en: product.name_en || product.name || '',
      description_es: product.description_es || '',
      description_en: product.description_en || '',
      basePrice: product.base_price || product.basePrice || '',
      profitMargin: product.profit_margin || 40,
      base_currency_id: product.base_currency_id || baseCurrencyId || '',
      category: product.category?.id || product.category_id || '',
      stock: product.stock || '',
      min_stock_alert: product.min_stock_alert || '',
      expiryDate: product.expiry_date || product.expiryDate || '',
      image: product.image_url || product.image_file || product.image || '',
      sku: product.sku || ''
    });
    setProductImagePreview(product.image_url || product.image_file || product.image || null);
    console.log('[openEditProductForm] SUCCESS - Form populated for editing');
  };

  const handleViewProductDetails = (product) => {
    console.log('[handleViewProductDetails] START - Input:', { productId: product.id, productName: product.name_es || product.name });
    setSelectedProduct(product);
    setShowProductDetails(true);
    console.log('[handleViewProductDetails] SUCCESS - Product details modal opened');
  };

  const handleProductImageUpload = async (e) => {
    console.log('[handleProductImageUpload] START - Image upload initiated');
    const file = e.target.files?.[0];
    if (!file) {
      console.log('[handleProductImageUpload] No file selected');
      return;
    }

    console.log('[handleProductImageUpload] File selected:', { name: file.name, size: file.size, type: file.type });
    try {
      console.log('[handleProductImageUpload] Validating and processing image...');
      const result = await validateAndProcessImage(file, 'product');

      if (!result.success) {
        console.log('[handleProductImageUpload] VALIDATION ERROR:', result.errors);
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      console.log('[handleProductImageUpload] Image processed successfully:', result.metadata);
      setProductImagePreview(result.base64);
      setProductForm(prev => ({ ...prev, image: result.base64 }));

      toast({
        title: 'Imagen optimizada',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions} (${result.metadata.compression} compresión)`,
      });
      console.log('[handleProductImageUpload] SUCCESS - Image uploaded and preview set');
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

  const handleSubmitProduct = async () => {
    console.log('[handleSubmitProduct] START - Input:', { productForm, hasId: !!productForm.id });

    if (!productForm.name_es || !productForm.basePrice || !productForm.category) {
      console.log('[handleSubmitProduct] VALIDATION ERROR - Missing required fields');
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    if (!productForm.base_currency_id) {
      console.log('[handleSubmitProduct] VALIDATION ERROR - Missing currency');
      toast({
        title: 'Error',
        description: language === 'es' ? 'Debe seleccionar una moneda' : 'You must select a currency',
        variant: 'destructive'
      });
      return;
    }

    console.log('[handleSubmitProduct] Validation passed, processing submission...');
    try {
      const category = categories.find(c => c.id === productForm.category);
      if (!category) {
        console.log('[handleSubmitProduct] VALIDATION ERROR - Invalid category');
        toast({
          title: 'Error',
          description: 'Categoría no válida',
          variant: 'destructive'
        });
        return;
      }

      console.log('[handleSubmitProduct] Category validated:', { categoryId: category.id, categoryName: category.name_es });

      // Convert price to base currency if different
      let normalizedPrice = parseFloat(productForm.basePrice);
      let finalCurrencyId = productForm.base_currency_id;
      const inputCurrency = getCurrencyById(productForm.base_currency_id);

      if (productForm.base_currency_id !== systemBaseCurrencyId) {
        console.log('[handleSubmitProduct] Converting price to base currency...');
        try {
          normalizedPrice = await convertAmountAsync(
            parseFloat(productForm.basePrice),
            productForm.base_currency_id,
            systemBaseCurrencyId
          );
          finalCurrencyId = systemBaseCurrencyId;
          console.log('[handleSubmitProduct] Price converted:', {
            original: `${inputCurrency?.code} ${productForm.basePrice}`,
            converted: `${systemBaseCurrency?.code} ${normalizedPrice.toFixed(2)}`
          });
        } catch (convError) {
          console.warn('[handleSubmitProduct] Conversion failed, using original:', convError);
          // Fallback: keep original price and currency
        }
      }

      const productData = {
        name_es: productForm.name_es,
        name_en: productForm.name_en || productForm.name_es,
        description_es: productForm.description_es || '',
        description_en: productForm.description_en || '',
        basePrice: normalizedPrice,
        stock: parseInt(productForm.stock || 0, 10),
        min_stock_alert: parseInt(productForm.min_stock_alert || 10, 10),
        profitMargin: parseFloat(productForm.profitMargin || 40),
        category_id: productForm.category,
        base_currency_id: finalCurrencyId,
        image: productForm.image || '',
        sku: productForm.sku || `SKU-${Date.now()}`,
        slug: productForm.name_es.toLowerCase().replace(/\s+/g, '-'),
        expiryDate: productForm.expiryDate || null
      };

      console.log('[handleSubmitProduct] Product data prepared:', { ...productData, imageLength: productData.image?.length || 0 });

      if (productForm.id) {
        console.log('[handleSubmitProduct] Updating existing product:', productForm.id);
        await updateProductDB(productForm.id, productData);
        console.log('[handleSubmitProduct] Product updated, logging activity...');
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
        console.log('[handleSubmitProduct] SUCCESS - Product updated');
        toast({ title: t('vendor.productUpdated') });
      } else {
        console.log('[handleSubmitProduct] Creating new product');
        const createdProduct = await createProduct(productData);
        console.log('[handleSubmitProduct] Product created:', { id: createdProduct?.id });
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
        console.log('[handleSubmitProduct] SUCCESS - Product created');
        toast({ title: t('vendor.productAdded') });
      }

      console.log('[handleSubmitProduct] Refreshing products list...');
      await onProductsRefresh(true);
      setProductForm(null);
      setProductImagePreview(null);
      console.log('[handleSubmitProduct] Form reset and products refreshed');
    } catch (error) {
      console.error('[handleSubmitProduct] ERROR:', error);
      console.error('[handleSubmitProduct] Error details:', { message: error?.message, code: error?.code, stack: error?.stack });
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleToggleProductActive = async (product, nextActive) => {
    console.log('[handleToggleProductActive] START - Input:', { productId: product.id, nextActive });
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
      console.log('[handleToggleProductActive] SUCCESS - Product state updated and list refreshed');
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

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;
    console.log('[handleDeleteProduct] START - Input:', { productId: productToDelete.id });
    setDeletingProductId(productToDelete.id);
    try {
      // Pass user info for activity logging
      const result = await deleteProduct(productToDelete.id, user?.email || user?.id || 'anonymous');

      // Build toast description with deactivated combos info
      const productName = productToDelete.name_es || productToDelete.name_en || productToDelete.id;
      let toastDescription = language === 'es'
        ? `${productName} eliminado`
        : `${productName} deleted`;

      if (result?.deactivatedCombos?.length > 0) {
        const comboNames = result.deactivatedCombos.map(c => c.name).join(', ');
        toastDescription += language === 'es'
          ? `. Combos desactivados: ${comboNames}`
          : `. Deactivated combos: ${comboNames}`;
      }

      toast({
        title: t('vendor.inventory.productDeleted'),
        description: toastDescription
      });
      await onProductsRefresh(true);
      setProductToDelete(null);
      console.log('[handleDeleteProduct] SUCCESS - Product deleted and list refreshed');
    } catch (error) {
      console.error('[handleDeleteProduct] ERROR:', error);
      toast({
        title: t('common.error'),
        description: error?.message || (language === 'es' ? 'No se pudo eliminar el producto.' : 'Could not delete the product.'),
        variant: 'destructive'
      });
    } finally {
      setDeletingProductId(null);
    }
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

    return price; // Retornar precio original si no hay tasa disponible
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
      display_currency_id: selectedCurrency || baseCurrencyId
    };
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header con selector de moneda y botón agregar */}
      <div className="flex justify-between items-center mb-6">
        {/* Currency Selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">
            {t('vendor.inventory.displayCurrency')}:
          </label>
          <select
            value={selectedCurrency ?? baseCurrencyId ?? ''}
            onChange={(e) => onSelectedCurrencyChange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            {currencies.map(currency => (
              <option key={currency.id} value={currency.id}>
                {currency.code}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={openNewProductForm} style={getPrimaryButtonStyle(visualSettings)} className="flex-shrink-0">
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
                onChange={e => handleInputChange('category', e.target.value)}
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
                {t('vendor.addProduct.basePrice')} *
              </label>
              <input
                type="number"
                step="0.01"
                value={productForm.basePrice}
                onChange={e => handleInputChange('basePrice', e.target.value)}
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
              {isConverting && !convertedPreview && (
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{language === 'es' ? 'Calculando...' : 'Calculating...'}</span>
                </div>
              )}
            </div>

            {/* Currency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('vendor.addProduct.currency')}
              </label>
              <select
                value={productForm.base_currency_id}
                onChange={e => handleInputChange('base_currency_id', e.target.value)}
                className="w-full input-style"
              >
                {currencies.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.is_base ? (language === 'es' ? '(Base)' : '(Base)') : ''}
                  </option>
                ))}
              </select>
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
            <Button variant="outline" onClick={() => setProductForm(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmitProduct} style={getPrimaryButtonStyle(visualSettings)}>
              <Save className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('vendor.addProduct.save')}</span>
            </Button>
          </div>
        </motion.div>
      )}

      {/* Responsive Products Table */}
      <ResponsiveTableWrapper
        data={productsWithConvertedPrices}
        columns={getTableColumns(t, language, currencies, {
          onToggleActive: handleToggleProductActive,
          togglingId: processingProductId,
          onDelete: setProductToDelete,
          deletingId: deletingProductId
        })}
        onRowClick={handleViewProductDetails}
        modalTitle="vendor.inventory.productDetails"
        modalColumns={getModalColumns(t, language, currencies)}
        emptyMessage={t('vendor.inventory.noProducts') || 'No products found'}
      />

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
                  <ProductInfoItem label={t('vendor.inventory.basePrice')} value={`${currencies.find(c => c.id === (selectedProduct.display_currency_id || selectedProduct.base_currency_id))?.symbol || '$'}${Number(selectedProduct.base_price || 0).toFixed(2)}`} />
                  <ProductInfoItem label={t('vendor.inventory.price')} value={`${currencies.find(c => c.id === (selectedProduct.display_currency_id || selectedProduct.base_currency_id))?.symbol || '$'}${Number(selectedProduct.final_price || 0).toFixed(2)}`} />
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
                openEditProductForm(selectedProduct);
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
  <div>
    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</dt>
    <dd className="text-sm text-gray-900 font-medium">{value}</dd>
  </div>
);

export default VendorInventoryTab;
