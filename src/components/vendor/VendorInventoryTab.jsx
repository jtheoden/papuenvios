import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Save, Edit, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createProduct, updateProduct as updateProductDB } from '@/lib/productService';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import { getTableColumns, getModalColumns } from './ProductTableConfig';
import { logActivity } from '@/lib/activityLogger';

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
  const [productForm, setProductForm] = useState(null);
  const [productImagePreview, setProductImagePreview] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showProductDetails, setShowProductDetails] = useState(false);

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

      const productData = {
        name_es: productForm.name_es,
        name_en: productForm.name_en || productForm.name_es,
        description_es: productForm.description_es || '',
        description_en: productForm.description_en || '',
        basePrice: parseFloat(productForm.basePrice),
        stock: parseInt(productForm.stock || 0, 10),
        min_stock_alert: parseInt(productForm.min_stock_alert || 10, 10),
        profitMargin: parseFloat(productForm.profitMargin || 40),
        category_id: productForm.category,
        base_currency_id: productForm.base_currency_id,
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
      await onProductsRefresh();
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
                {currency.code} - {language === 'es' ? currency.name_es : currency.name_en}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={openNewProductForm} style={getPrimaryButtonStyle(visualSettings)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('vendor.actions.addProduct')}
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
                    {c.code} - {language === 'es' ? c.name_es : c.name_en}
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
              {t('vendor.addProduct.cancel')}
            </Button>
            <Button onClick={handleSubmitProduct} style={getPrimaryButtonStyle(visualSettings)}>
              <Save className="w-4 h-4 mr-2" />
              {t('vendor.addProduct.save')}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Responsive Products Table */}
      <ResponsiveTableWrapper
        data={productsWithConvertedPrices}
        columns={getTableColumns(t, language, currencies)}
        onRowClick={handleViewProductDetails}
        modalTitle="vendor.inventory.productDetails"
        modalColumns={getModalColumns(t, language, currencies)}
        emptyMessage={t('vendor.inventory.noProducts') || 'No products found'}
      />

      {/* Product Details Modal */}
      {showProductDetails && selectedProduct && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setShowProductDetails(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
              <h3 className="text-xl font-bold text-gray-900">
                {t('vendor.inventory.productDetails')} - {language === 'es' ? selectedProduct.name_es : selectedProduct.name_en}
              </h3>
              <button
                onClick={() => setShowProductDetails(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Product Information */}
              <div className="lg:col-span-2 space-y-6">
                {/* Product Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <h4 className="text-lg font-semibold text-gray-900 mb-3">
                      {t('vendor.addProduct.description')}
                    </h4>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4">
                      {language === 'es'
                        ? (selectedProduct.description_es || selectedProduct.description_en)
                        : (selectedProduct.description_en || selectedProduct.description_es)
                      }
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column - Product Image */}
              <div className="lg:col-span-1">
                {selectedProduct.image_url || selectedProduct.image_file || selectedProduct.image ? (
                  <div className="sticky top-20 space-y-3">
                    <h4 className="text-lg font-semibold text-gray-900">📷 {language === 'es' ? 'Imagen del Producto' : 'Product Image'}</h4>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-2">
                      <img
                        src={selectedProduct.image_url || selectedProduct.image_file || selectedProduct.image}
                        alt={selectedProduct.name_es || selectedProduct.name}
                        className="w-full h-auto rounded-lg"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="sticky top-20 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 font-medium">
                      {language === 'es' ? 'Sin imagen' : 'No image'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
              <Button variant="outline" onClick={() => setShowProductDetails(false)}>
                {t('vendor.addProduct.cancel')}
              </Button>
              <Button onClick={() => {
                openEditProductForm(selectedProduct);
                setShowProductDetails(false);
              }} style={getPrimaryButtonStyle(visualSettings)}>
                <Edit className="h-4 w-4 mr-2" />
                {t('vendor.actions.edit')}
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
