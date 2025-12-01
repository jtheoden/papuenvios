import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Package, DollarSign, Save, List, Edit, Trash2, Box, Settings2, Eye, EyeOff, Check, X, AlertTriangle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createProduct, updateProduct as updateProductDB } from '@/lib/productService';
import { supabase } from '@/lib/supabase';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import TabsResponsive from './TabsResponsive';
import VendorCategoriesTab from './vendor/VendorCategoriesTab';
import VendorCombosTab from './vendor/VendorCombosTab';
import VendorManagementTab from './vendor/VendorManagementTab';

const VendorPage = () => {
  const { t, language } = useLanguage();
  const {
    products, refreshProducts,
    financialSettings,
    categories, refreshCategories,
    combos, refreshCombos,
    testimonials, refreshTestimonials,
    visualSettings
  } = useBusiness();

  // Load currency IDs for products
  const [currencies, setCurrencies] = useState([]);
  const [baseCurrencyId, setBaseCurrencyId] = useState(null);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [exchangeRates, setExchangeRates] = useState({});

  useEffect(() => {
    const fetchCurrencies = async () => {
      const { data } = await supabase
        .from('currencies')
        .select('*')
        .eq('is_active', true)
        .order('code', { ascending: true});

      if (data) {
        setCurrencies(data);
        const baseCurrency = data.find(c => c.is_base);
        if (baseCurrency) {
          setBaseCurrencyId(baseCurrency.id);
          setSelectedCurrency(baseCurrency.id);
        }
      }

      // Load exchange rates
      const { data: ratesData } = await supabase
        .from('exchange_rates')
        .select('*')
        .eq('is_active', true);

      if (ratesData) {
        const ratesMap = {};
        ratesData.forEach(rate => {
          ratesMap[`${rate.from_currency_id}-${rate.to_currency_id}`] = rate.rate;
        });
        setExchangeRates(ratesMap);
      }
    };

    const fetchAdminData = async () => {
      // Load testimonials with admin view
      await refreshTestimonials(true);
      // Load all combos including inactive ones for admin view
      await refreshCombos(true);
      // Load all carousel slides
      // await refreshCarouselSlides(false); // Will implement when updating HomePage
    };

    fetchCurrencies();
    fetchAdminData();
  }, []);
  
  const [view, setView] = useState('inventory'); // Used with TabsResponsive for activeTab/onTabChange
  const [productForm, setProductForm] = useState(null);
  const [productImagePreview, setProductImagePreview] = useState(null);

  const handleInputChange = (form, field, value) => {
    if (form === 'product') {
      setProductForm(prev => ({ ...prev, [field]: value }));
    }
  };


  const openNewProductForm = () => {
    setProductForm({
      id: null,
      name: '',
      description_es: '',
      description_en: '',
      basePrice: '',
      base_currency_id: baseCurrencyId || '', // Use USD currency ID
      category: '',
      stock: '',
      min_stock_alert: '',
      expiryDate: '',
      image: ''
    });
    setProductImagePreview(null);
  };
  const openEditProductForm = (product) => {
    setProductForm({
      id: product.id,
      name: product.name_es || product.name,
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
  };

  const handleProductImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Validate and process image
      const result = await validateAndProcessImage(file, 'product');

      if (!result.success) {
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      // Show preview and metadata
      setProductImagePreview(result.base64);
      setProductForm(prev => ({ ...prev, image: result.base64 }));

      toast({
        title: 'Imagen optimizada',
        description: `${result.metadata.originalDimensions} → ${result.metadata.finalDimensions} (${result.metadata.compression} compresión)`,
      });
    } catch (error) {
      console.error('Error processing product image:', error);
      toast({
        title: 'Error al procesar imagen',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleSubmitProduct = async () => {
    if (!productForm.name || !productForm.basePrice || !productForm.category) {
      toast({ title: t('vendor.validation.error'), description: t('vendor.validation.fillFields'), variant: "destructive" });
      return;
    }

    if (!productForm.base_currency_id) {
      toast({ title: 'Error', description: language === 'es' ? 'Debe seleccionar una moneda' : 'You must select a currency', variant: "destructive" });
      return;
    }

    try {
      // Validate category exists
      const category = categories.find(c => c.id === productForm.category);
      if (!category) {
        toast({ title: 'Error', description: 'Categoría no válida', variant: "destructive" });
        return;
      }

      const productData = {
        name: productForm.name,
        description_es: productForm.description_es || '',
        description_en: productForm.description_en || '',
        basePrice: parseFloat(productForm.basePrice),
        stock: parseInt(productForm.stock || 0, 10),
        min_stock_alert: parseInt(productForm.min_stock_alert || 10, 10),
        profitMargin: parseFloat(productForm.profitMargin || 40),
        category_id: productForm.category,
        base_currency_id: productForm.base_currency_id, // Save selected currency ID
        image: productForm.image || '',
        sku: productForm.sku || `SKU-${Date.now()}`,
        slug: productForm.name.toLowerCase().replace(/\s+/g, '-'),
        expiryDate: productForm.expiryDate || null
      };

      console.log('💾 Saving product with data:', productData);
      console.log('📦 Stock value:', productData.stock, typeof productData.stock);
      console.log('🏷️ Category ID:', productData.category_id, typeof productData.category_id);
      console.log('📅 Expiry Date:', productData.expiryDate, typeof productData.expiryDate);

      if (productForm.id) {
        // Update existing product
        const { error } = await updateProductDB(productForm.id, productData);
        if (error) throw error;
        toast({ title: t('vendor.productUpdated') });
      } else {
        // Create new product
        const { error } = await createProduct(productData);
        if (error) throw error;
        toast({ title: t('vendor.productAdded') });
      }

      // Refresh products list
      await refreshProducts();
      setProductForm(null);
      setProductImagePreview(null);
    } catch (error) {
      console.error('Error saving product:', error);
      toast({ title: 'Error', description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>{t('vendor.title')}</h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">{t('vendor.subtitle')}</p>
      </motion.div>

      <TabsResponsive
        tabs={[
          {
            id: 'inventory',
            label: 'vendor.tabs.inventory',
            icon: <Package className="h-5 w-5" />,
            content: (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex justify-end mb-6">
                  <Button onClick={openNewProductForm} style={getPrimaryButtonStyle(visualSettings)}>
                    <Plus className="mr-2 h-4 w-4" />{t('vendor.actions.addProduct')}
            </Button>
          </div>
          {productForm && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl mb-12">
              <h2 className="text-2xl font-semibold mb-6">{productForm.id ? t('vendor.addProduct.editTitle') : t('vendor.addProduct.title')}</h2>
              <div className="grid md:grid-cols-2 gap-6">
                {/* Product Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('vendor.addProduct.name')} *
                  </label>
                  <input
                    type="text"
                    value={productForm.name}
                    onChange={e => handleInputChange('product', 'name', e.target.value)}
                    placeholder={t('vendor.addProduct.namePlaceholder')}
                    className="w-full input-style"
                    required
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('vendor.addProduct.category')} *
                  </label>
                  <select
                    value={productForm.category}
                    onChange={e => handleInputChange('product', 'category', e.target.value)}
                    className="w-full input-style"
                    required
                  >
                    <option value="">{language === 'es' ? 'Seleccionar categoría' : 'Select category'}</option>
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
                    onChange={e => handleInputChange('product', 'description_es', e.target.value)}
                    placeholder={language === 'es' ? 'Descripción del producto en español' : 'Product description in Spanish'}
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
                    onChange={e => handleInputChange('product', 'description_en', e.target.value)}
                    placeholder={language === 'es' ? 'Descripción del producto en inglés' : 'Product description in English'}
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
                    onChange={e => handleInputChange('product', 'basePrice', e.target.value)}
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
                    onChange={e => handleInputChange('product', 'base_currency_id', e.target.value)}
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
                    onChange={e => handleInputChange('product', 'stock', e.target.value)}
                    placeholder="0"
                    className="w-full input-style"
                  />
                </div>

                {/* Minimum Stock Alert */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Alerta de Stock Mínimo' : 'Minimum Stock Alert'}
                  </label>
                  <input
                    type="number"
                    value={productForm.min_stock_alert}
                    onChange={e => handleInputChange('product', 'min_stock_alert', e.target.value)}
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
                    onChange={e => handleInputChange('product', 'expiryDate', e.target.value)}
                    className="w-full input-style"
                  />
                </div>

                {/* Product Image - Preview ABOVE Upload */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('vendor.addProduct.image')}
                  </label>

                  {/* Image Preview (shown above upload button) */}
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

                  {/* File Upload Button */}
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
                <Button variant="outline" onClick={() => setProductForm(null)}>{t('vendor.addProduct.cancel')}</Button>
                <Button onClick={handleSubmitProduct} style={getPrimaryButtonStyle(visualSettings)}><Save className="w-4 h-4 mr-2" />{t('vendor.addProduct.save')}</Button>
              </div>
            </motion.div>
          )}
          <div className="glass-effect rounded-2xl overflow-hidden"><table className="w-full text-left">
            <thead><tr
            >
              <th className="p-4">{t('vendor.inventory.product')}</th>
              <th className="p-4">{language === 'es' ? 'Categoría' : 'Category'}</th>
              <th className="p-4">{language === 'es' ? 'Moneda' : 'Currency'}</th>
              <th className="p-4">{t('vendor.inventory.stock')}</th>
              <th className="p-4">{t('vendor.inventory.price')}</th>
              <th className="p-4">{t('vendor.inventory.expiryDate')}</th>
              <th></th>
            </tr></thead>
            <tbody>{products.map(p => {
              const productCurrency = currencies.find(c => c.id === p.base_currency_id);

              // Calculate stock status
              const stock = p.stock !== undefined ? p.stock : 0;
              const minStock = p.min_stock_alert || 10;
              const isOutOfStock = stock === 0;
              const isLowStock = stock > 0 && stock <= minStock;

              // Calculate expiry status
              const getExpiryStatus = (expiryDate) => {
                if (!expiryDate) return null;

                const today = new Date();
                const expiry = new Date(expiryDate);
                const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
                const monthsUntilExpiry = daysUntilExpiry / 30;

                if (daysUntilExpiry < 0) {
                  return {
                    status: 'expired',
                    color: 'bg-red-50',
                    icon: AlertCircle,
                    iconColor: 'text-red-600',
                    days: daysUntilExpiry
                  };
                } else if (monthsUntilExpiry <= 1) {
                  return {
                    status: 'critical',
                    color: 'bg-pink-50',
                    icon: AlertCircle,
                    iconColor: 'text-red-500',
                    days: daysUntilExpiry
                  };
                } else if (monthsUntilExpiry <= 3) {
                  return {
                    status: 'warning',
                    color: 'bg-yellow-50',
                    icon: AlertTriangle,
                    iconColor: 'text-yellow-600',
                    days: daysUntilExpiry
                  };
                }

                return { status: 'ok', color: '', icon: null, iconColor: '', days: daysUntilExpiry };
              };

              const expiryStatus = getExpiryStatus(p.expiry_date || p.expiryDate);

              return (
                <tr
                  key={p.id}
                  className={`border-b last:border-none ${expiryStatus?.color || ''} ${isOutOfStock ? 'opacity-60' : ''}`}
                >
                  <td className={`p-4 font-medium ${isOutOfStock ? 'line-through text-gray-400' : ''}`}>
                    {p.name_es || p.name || 'Sin nombre'}
                  </td>
                  <td className="p-4 text-gray-600">
                    {p.category ? (language === 'es' ? p.category.name_es : p.category.name_en) : 'Sin categoría'}
                  </td>
                  <td className="p-4 text-center">
                    <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                      {productCurrency?.code || 'USD'}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={isOutOfStock ? 'line-through text-gray-400' : ''}>
                        {stock}
                      </span>
                      {isOutOfStock && (
                        <AlertCircle className="h-4 w-4 text-red-600" title={language === 'es' ? 'Sin stock' : 'Out of stock'} />
                      )}
                      {isLowStock && (
                        <AlertTriangle className="h-4 w-4 text-orange-500" title={language === 'es' ? 'Stock bajo' : 'Low stock'} />
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    {productCurrency?.symbol || '$'}{p.final_price ? Number(p.final_price).toFixed(2) : (p.base_price ? Number(p.base_price).toFixed(2) : '0.00')}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span>
                        {p.expiry_date || p.expiryDate ? new Date(p.expiry_date || p.expiryDate).toLocaleDateString() : 'N/A'}
                      </span>
                      {expiryStatus?.icon && (
                        <expiryStatus.icon
                          className={`h-4 w-4 ${expiryStatus.iconColor}`}
                          title={
                            expiryStatus.status === 'expired'
                              ? (language === 'es' ? 'Expirado' : 'Expired')
                              : (language === 'es' ? `${expiryStatus.days} días restantes` : `${expiryStatus.days} days left`)
                          }
                        />
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEditProductForm(p)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
              </motion.div>
            )
          },
          {
            id: 'categories',
            label: 'vendor.tabs.categories',
            icon: <List className="h-5 w-5" />,
            content: (
              <VendorCategoriesTab
                categories={categories}
                onCategoriesChange={refreshCategories}
                visualSettings={visualSettings}
              />
            )
          },
          {
            id: 'combos',
            label: 'vendor.tabs.combos',
            icon: <Box className="h-5 w-5" />,
            content: (
              <VendorCombosTab
                combos={combos}
                products={products}
                currencies={currencies}
                visualSettings={visualSettings}
                financialSettings={financialSettings}
                exchangeRates={exchangeRates}
                selectedCurrency={selectedCurrency}
                onSelectedCurrencyChange={setSelectedCurrency}
                onCombosRefresh={refreshCombos}
              />
            )
          },
          {
            id: 'management',
            label: 'vendor.tabs.management',
            icon: <Settings2 className="h-5 w-5" />,
            content: (
              <VendorManagementTab
                testimonials={testimonials}
                onTestimonialsRefresh={refreshTestimonials}
              />
            )
          }
        ]}
        activeTab={view}
        onTabChange={setView}
      />
    </div>
  );
};

export default VendorPage;