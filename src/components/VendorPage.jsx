import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Package, DollarSign, Save, List, Edit, Trash2, Box, Settings2, Eye, EyeOff, Check, X, AlertTriangle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { createProduct, updateProduct as updateProductDB, createCategory, updateCategory, deleteCategory } from '@/lib/productService';
import { createCombo, updateCombo as updateComboDB } from '@/lib/comboService';
import { toggleTestimonialVisibility, toggleTestimonialVerification } from '@/lib/testimonialService';
import { supabase } from '@/lib/supabase';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import TabsResponsive from './TabsResponsive';

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
  const [comboForm, setComboForm] = useState(null);
  const [categoryForm, setCategoryForm] = useState({
    dbId: null,
    es: '',
    en: '',
    description_es: '',
    description_en: ''
  });
  const [productImagePreview, setProductImagePreview] = useState(null);

  const handleInputChange = (form, field, value, subfield = null) => {
    if (form === 'product') {
      setProductForm(prev => ({ ...prev, [field]: value }));
    } else if (form === 'combo') {
      if (subfield) {
        setComboForm(prev => ({ ...prev, [field]: { ...prev[field], [subfield]: value } }));
      } else {
        setComboForm(prev => ({ ...prev, [field]: value }));
      }
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

  const handleCategorySubmit = async () => {
    if (!categoryForm.es || !categoryForm.en) {
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: language === 'es'
          ? 'Por favor complete los campos de nombre en ambos idiomas'
          : 'Please complete the name fields in both languages',
        variant: "destructive"
      });
      return;
    }

    try {
      if (categoryForm.dbId) {
        // Update existing category
        const { error } = await updateCategory(categoryForm.dbId, {
          es: categoryForm.es,
          en: categoryForm.en,
          description_es: categoryForm.description_es,
          description_en: categoryForm.description_en
        });
        if (error) throw error;
        toast({
          title: language === 'es' ? 'Categoría actualizada' : 'Category Updated',
          description: language === 'es'
            ? 'La categoría se actualizó exitosamente'
            : 'The category was successfully updated'
        });
      } else {
        // Create new category
        const { error } = await createCategory({
          es: categoryForm.es,
          en: categoryForm.en,
          description_es: categoryForm.description_es,
          description_en: categoryForm.description_en
        });
        if (error) throw error;
        toast({
          title: language === 'es' ? 'Categoría creada' : 'Category Created',
          description: language === 'es'
            ? 'La categoría se creó exitosamente'
            : 'The category was successfully created'
        });
      }

      await refreshCategories();
      setCategoryForm({
        dbId: null,
        es: '',
        en: '',
        description_es: '',
        description_en: ''
      });
    } catch (error) {
      console.error('Error saving category:', error);
      toast({
        title: 'Error',
        description: error.message || (language === 'es' ? 'Error al guardar la categoría' : 'Error saving category'),
        variant: "destructive"
      });
    }
  };

  const handleEditCategory = (category) => {
    setCategoryForm({
      dbId: category.id, // Use UUID from database
      es: category.name_es || category.es,
      en: category.name_en || category.en,
      description_es: category.description_es || '',
      description_en: category.description_en || ''
    });
  };

  const handleRemoveCategory = async (categoryId) => {
    const confirmMessage = language === 'es'
      ? '¿Está seguro de que desea eliminar esta categoría?'
      : 'Are you sure you want to delete this category?';

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const { error } = await deleteCategory(categoryId);
      if (error) throw error;

      await refreshCategories();
      toast({
        title: language === 'es' ? 'Categoría eliminada' : 'Category Deleted',
        description: language === 'es'
          ? 'La categoría se eliminó exitosamente'
          : 'The category was successfully deleted'
      });
    } catch (error) {
      console.error('Error deleting category:', error);
      toast({
        title: 'Error',
        description: error.message || (language === 'es' ? 'Error al eliminar la categoría' : 'Error deleting category'),
        variant: "destructive"
      });
    }
  };

  const [comboImagePreview, setComboImagePreview] = useState(null);

  const openNewComboForm = () => {
    setComboForm({
      id: null,
      name: '',
      profitMargin: '',
      shipping: { type: 'paid', value: 0 },
      products: [], // Will be array of product IDs
      productQuantities: {}, // { productId: quantity }
      image: ''
    });
    setComboImagePreview(null);
  };

  const openEditComboForm = (combo) => {
    // Convert combo items to the format we need
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
      // Validate and process image
      const result = await validateAndProcessImage(file, 'combo');

      if (!result.success) {
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      // Show preview and metadata
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
        // Remove quantity when unchecking
        delete productQuantities[productId];
      } else {
        // Set default quantity of 1 when checking
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
      toast({ title: t('vendor.validation.error'), description: t('vendor.validation.fillFields'), variant: "destructive" });
      return;
    }

    try {
      // Map products to include quantities
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
        // Update existing combo
        const { error } = await updateComboDB(comboForm.id, comboData);
        if (error) throw error;
        toast({ title: t('vendor.comboUpdated') });
      } else {
        // Create new combo
        const { error } = await createCombo(comboData);
        if (error) throw error;
        toast({ title: t('vendor.comboAdded') });
      }

      // Refresh combos list (including inactive for admin view)
      await refreshCombos(true);
      setComboForm(null);
      setComboImagePreview(null);
    } catch (error) {
      console.error('Error saving combo:', error);
      toast({ title: 'Error', description: error.message, variant: "destructive" });
    }
  };


  const convertPrice = (price, fromCurrencyId, toCurrencyId) => {
    if (!price || !fromCurrencyId || !toCurrencyId) return price;
    if (fromCurrencyId === toCurrencyId) return price;

    const rateKey = `${fromCurrencyId}-${toCurrencyId}`;
    const rate = exchangeRates[rateKey];

    if (rate) {
      return parseFloat(price) * rate;
    }

    return price;
  };

  const calculateComboPrices = (combo) => {
    if (!combo || !selectedCurrency) return { base: 0, final: 0 };

    let totalBasePrice = 0;

    (combo.products || []).forEach(productId => {
      const product = products.find(p => p.id === productId);
      if (product) {
        // Use ONLY base_price (no product margin)
        const basePrice = parseFloat(product.base_price || 0);
        const productCurrencyId = product.base_currency_id;
        const quantity = combo.productQuantities?.[productId] || 1;

        // Convert each product price to selected currency
        let convertedPrice = basePrice;
        if (productCurrencyId && productCurrencyId !== selectedCurrency) {
          convertedPrice = convertPrice(basePrice, productCurrencyId, selectedCurrency);
        }

        // Multiply by quantity
        totalBasePrice += convertedPrice * quantity;
      }
    });

    // Apply ONLY combo profit margin
    const profitMargin = parseFloat(combo.profitMargin || financialSettings.comboProfit) / 100;
    const finalPrice = totalBasePrice * (1 + profitMargin);

    return { base: totalBasePrice.toFixed(2), final: finalPrice.toFixed(2) };
  };

  // Testimonial management functions
  const handleToggleTestimonialVisibility = async (id, currentVisibility) => {
    try {
      const { error } = await toggleTestimonialVisibility(id, !currentVisibility);
      if (error) throw error;

      toast({
        title: language === 'es' ? 'Actualizado' : 'Updated',
        description: language === 'es'
          ? `Testimonio ${!currentVisibility ? 'visible' : 'oculto'}`
          : `Testimonial ${!currentVisibility ? 'visible' : 'hidden'}`
      });

      await refreshTestimonials(true); // Admin view
    } catch (error) {
      console.error('Error toggling testimonial visibility:', error);
      toast({
        title: 'Error',
        description: error.message || (language === 'es'
          ? 'Error al actualizar testimonio'
          : 'Error updating testimonial'),
        variant: 'destructive'
      });
    }
  };

  const handleToggleTestimonialFeatured = async (id, currentFeatured) => {
    try {
      const { error } = await toggleTestimonialVerification(id, !currentFeatured); // Using same function
      if (error) throw error;

      toast({
        title: language === 'es' ? 'Actualizado' : 'Updated',
        description: language === 'es'
          ? `Testimonio ${!currentFeatured ? 'destacado' : 'normal'}`
          : `Testimonial ${!currentFeatured ? 'featured' : 'unfeatured'}`
      });

      await refreshTestimonials(true); // Admin view
    } catch (error) {
      console.error('Error toggling testimonial featured status:', error);
      toast({
        title: 'Error',
        description: error.message || (language === 'es'
          ? 'Error al destacar testimonio'
          : 'Error featuring testimonial'),
        variant: 'destructive'
      });
    }
  };

  // User management functions
  const toggleUserActive = (id) => setUsers(prev => prev.map(u => u.id === id ? { ...u, active: !u.active } : u));
  const deleteUser = (id) => setUsers(prev => prev.filter(u => u.id !== id));

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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto">
          <div className="glass-effect p-8 rounded-2xl mb-8">
            <h2 className="text-2xl font-semibold mb-6">
              {categoryForm.dbId
                ? (language === 'es' ? 'Editar Categoría' : 'Edit Category')
                : (language === 'es' ? 'Nueva Categoría' : 'New Category')}
            </h2>

            <div className="space-y-4 mb-6">
              {/* Name fields */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Nombre (Español) *' : 'Name (Spanish) *'}
                  </label>
                  <input
                    type="text"
                    value={categoryForm.es}
                    onChange={e => setCategoryForm({...categoryForm, es: e.target.value})}
                    placeholder={language === 'es' ? 'Ej: Electrónica' : 'Ex: Electronics'}
                    className="input-style w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Nombre (Inglés) *' : 'Name (English) *'}
                  </label>
                  <input
                    type="text"
                    value={categoryForm.en}
                    onChange={e => setCategoryForm({...categoryForm, en: e.target.value})}
                    placeholder={language === 'es' ? 'Ej: Electronics' : 'Ex: Electronics'}
                    className="input-style w-full"
                    required
                  />
                </div>
              </div>

              {/* Description fields */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Descripción (Español)' : 'Description (Spanish)'}
                  </label>
                  <textarea
                    value={categoryForm.description_es}
                    onChange={e => setCategoryForm({...categoryForm, description_es: e.target.value})}
                    placeholder={language === 'es' ? 'Descripción opcional...' : 'Optional description...'}
                    className="input-style w-full"
                    rows="3"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {language === 'es' ? 'Descripción (Inglés)' : 'Description (English)'}
                  </label>
                  <textarea
                    value={categoryForm.description_en}
                    onChange={e => setCategoryForm({...categoryForm, description_en: e.target.value})}
                    placeholder={language === 'es' ? 'Descripción opcional...' : 'Optional description...'}
                    className="input-style w-full"
                    rows="3"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCategorySubmit} style={getPrimaryButtonStyle(visualSettings)}>
                {categoryForm.dbId ? (
                  <><Save className="mr-2 h-4 w-4" />{language === 'es' ? 'Actualizar Categoría' : 'Update Category'}</>
                ) : (
                  <><Plus className="mr-2 h-4 w-4" />{language === 'es' ? 'Crear Categoría' : 'Create Category'}</>
                )}
              </Button>
              {categoryForm.dbId && (
                <Button
                  variant="outline"
                  onClick={() => setCategoryForm({
                    dbId: null,
                    es: '',
                    en: '',
                    description_es: '',
                    description_en: ''
                  })}
                >
                  <X className="mr-2 h-4 w-4" />{language === 'es' ? 'Cancelar' : 'Cancel'}
                </Button>
              )}
            </div>
          </div>

          {/* Category list */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold mb-4">
              {language === 'es' ? 'Categorías Existentes' : 'Existing Categories'}
            </h3>
            {categories.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                {language === 'es' ? 'No hay categorías aún' : 'No categories yet'}
              </p>
            ) : (
              <ul className="space-y-2">
                {categories.map(c => (
                  <li key={c.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition">
                    <div className="flex-1">
                      <div className="flex gap-4">
                        <span className="font-semibold">{language === 'es' ? (c.name_es || c.es) : (c.name_en || c.en)}</span>
                        <span className="text-gray-500 text-sm">({c.slug})</span>
                      </div>
                      {(c.description_es || c.description_en) && (
                        <p className="text-sm text-gray-600 mt-1">
                          {language === 'es' ? c.description_es : c.description_en}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEditCategory(c)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => handleRemoveCategory(c.id)}
                        style={{
                          backgroundColor: visualSettings.destructiveBgColor || '#dc2626',
                          color: visualSettings.destructiveTextColor || '#ffffff'
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = visualSettings.destructiveHoverBgColor || '#b91c1c'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = visualSettings.destructiveBgColor || '#dc2626'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
            </motion.div>
            )
          },
          {
            id: 'combos',
            label: 'vendor.tabs.combos',
            icon: <Box className="h-5 w-5" />,
            content: (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{language === 'es' ? 'Moneda:' : 'Currency:'}</span>
              <select
                value={selectedCurrency || ''}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {currencies.map(currency => (
                  <option key={currency.id} value={currency.id}>
                    {currency.code} ({currency.symbol})
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={openNewComboForm} style={getPrimaryButtonStyle(visualSettings)}><Plus className="mr-2 h-4 w-4" />{t('vendor.combos.new')}</Button>
          </div>
          {comboForm && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl mb-12">
              <h2 className="text-2xl font-semibold mb-6">{comboForm.id ? t('vendor.combos.edit') : t('vendor.combos.new')}</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <input type="text" value={comboForm.name} onChange={e => handleInputChange('combo', 'name', e.target.value)} placeholder={t('vendor.combos.name')} className="w-full input-style mb-4" />
                  <input type="number" value={comboForm.profitMargin} onChange={e => handleInputChange('combo', 'profitMargin', e.target.value)} placeholder={`${t('vendor.combos.profitMargin')} (def: ${financialSettings.comboProfit}%)`} className="w-full input-style mb-4" />

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

                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('vendor.combos.coverImage')}</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleComboImageUpload}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-4"
                  />
                </div>
                <div>
                  <h3 className="font-semibold mb-2">{t('vendor.combos.products')}</h3>
                  <div className="max-h-64 overflow-y-auto space-y-2 p-2 border rounded-lg">
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
                            <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" title={language === 'es' ? 'Sin stock' : 'Out of stock'} />
                          )}
                          {isLowStock && !isOutOfStock && (
                            <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" title={language === 'es' ? `Stock: ${stock}` : `Stock: ${stock}`} />
                          )}
                          {hasInsufficientStock && (
                            <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0" title={language === 'es' ? `Insuficiente: ${stock} disponible, ${requiredQuantity} requerido` : `Insufficient: ${stock} available, ${requiredQuantity} required`} />
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
                <div className="md:col-span-2">
                  <div className="glass-effect p-3 rounded-lg text-sm">
                    <div className="flex justify-between">
                      <span>{t('vendor.combos.basePrice')}:</span>
                      <span className="font-semibold">
                        {currencies.find(c => c.id === selectedCurrency)?.symbol || '$'}{calculateComboPrices(comboForm).base} {currencies.find(c => c.id === selectedCurrency)?.code || 'USD'}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>{t('vendor.combos.finalPrice')}:</span>
                      <span className="text-blue-600">
                        {currencies.find(c => c.id === selectedCurrency)?.symbol || '$'}{calculateComboPrices(comboForm).final} {currencies.find(c => c.id === selectedCurrency)?.code || 'USD'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-4 mt-6">
                <Button variant="outline" onClick={() => setComboForm(null)}>{t('vendor.addProduct.cancel')}</Button>
                <Button onClick={handleComboSubmit} style={getPrimaryButtonStyle(visualSettings)}><Save className="w-4 h-4 mr-2" />{t('vendor.combos.save')}</Button>
              </div>
            </motion.div>
          )}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {combos.map(c => {
              // Calculate total items considering quantities
              const totalItems = (c.products || []).reduce((sum, productId) => {
                const quantity = c.productQuantities?.[productId] || 1;
                return sum + quantity;
              }, 0);

              // Check stock issues
              const stockIssues = [];
              (c.products || []).forEach(productId => {
                const product = products.find(p => p.id === productId);
                const requiredQuantity = c.productQuantities?.[productId] || 1;
                const availableStock = product?.stock || 0;

                if (availableStock === 0) {
                  stockIssues.push({
                    productName: product?.name_es || product?.name || 'Unknown',
                    issue: 'out_of_stock',
                    required: requiredQuantity,
                    available: 0
                  });
                } else if (availableStock < requiredQuantity) {
                  stockIssues.push({
                    productName: product?.name_es || product?.name || 'Unknown',
                    issue: 'insufficient',
                    required: requiredQuantity,
                    available: availableStock
                  });
                }
              });

              const isDeactivated = c.is_active === false || stockIssues.length > 0;

              const prices = calculateComboPrices(c);
              const currencySymbol = currencies.find(curr => curr.id === selectedCurrency)?.symbol || '$';
              const currencyCode = currencies.find(curr => curr.id === selectedCurrency)?.code || 'USD';

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
            )
          },
          {
            id: 'management',
            label: 'vendor.tabs.management',
            icon: <Settings2 className="h-5 w-5" />,
            content: (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div>
            <h2 className="text-2xl font-semibold mb-4">{t('vendor.management.testimonials')}</h2>
            <div className="glass-effect p-4 rounded-lg space-y-2">
              {testimonials.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  {language === 'es' ? 'No hay testimonios aún' : 'No testimonials yet'}
                </p>
              ) : (
                testimonials.map(testimonial => (
                  <div key={testimonial.id} className="flex justify-between items-center p-3 border-b hover:bg-gray-50 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        {/* Author Avatar */}
                        {(testimonial.user_avatar || testimonial.user_photo) && (
                          <img
                            src={testimonial.user_avatar || testimonial.user_photo}
                            alt={testimonial.user_name || 'User'}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-gray-900">
                              {testimonial.user_name || 'Usuario'}
                            </p>
                            {testimonial.is_featured && (
                              <Check className="w-4 h-4 text-purple-500" title={language === 'es' ? 'Destacado' : 'Featured'} />
                            )}
                            <span className="text-yellow-500">{'★'.repeat(testimonial.rating)}</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm italic text-gray-600">"{testimonial.comment}"</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={testimonial.is_featured ? "default" : "outline"}
                        onClick={() => handleToggleTestimonialFeatured(testimonial.id, testimonial.is_featured)}
                        title={language === 'es' ? 'Destacar/Quitar destaque' : 'Feature/Unfeature'}
                      >
                        {testimonial.is_featured ? (
                          <><Check className="mr-2 h-4 w-4"/>{language === 'es' ? 'Destacado' : 'Featured'}</>
                        ) : (
                          <><X className="mr-2 h-4 w-4"/>{language === 'es' ? 'Normal' : 'Normal'}</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant={testimonial.is_visible ? "default" : "outline"}
                        onClick={() => handleToggleTestimonialVisibility(testimonial.id, testimonial.is_visible)}
                      >
                        {testimonial.is_visible ? (
                          <><Eye className="mr-2 h-4 w-4"/>{t('vendor.management.hide')}</>
                        ) : (
                          <><EyeOff className="mr-2 h-4 w-4"/>{t('vendor.management.show')}</>
                        )}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
            </motion.div>
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