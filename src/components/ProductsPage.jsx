import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, ShoppingCart, Plus, Package, Upload, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { uploadProductImage, deleteProductImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { getHeadingStyle } from '@/lib/styleUtils';

const ProductsPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { user, isAdmin } = useAuth();
  const { products, combos, categories, addToCart, financialSettings, refreshProducts, visualSettings } = useBusiness();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [filteredCombos, setFilteredCombos] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingProduct, setEditingProduct] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [currencies, setCurrencies] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [exchangeRates, setExchangeRates] = useState({});
  const combosScrollRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const handleImageUpload = useCallback(async (event, productId) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Validate and process image
      const result = await validateAndProcessImage(
        file,
        'product',
        (progress) => setUploadProgress(progress.progress)
      );

      if (!result.success) {
        toast({
          title: 'Error de validación',
          description: result.errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }

      // Show preview
      setImagePreview(result.base64);

      // Upload processed image
      const fileName = `product-${productId}-${Date.now()}.jpg`;
      const { publicUrl } = await uploadProductImage(result.blob, fileName);

      // Update product in database
      const { error: updateError } = await supabase
        .from('products')
        .update({ image_url: publicUrl })
        .eq('id', productId);

      if (updateError) throw updateError;

      // Refresh products list
      await refreshProducts();

      toast({
        title: t('products.imageUploaded'),
        description: `${t('products.imageUploadedSuccess')} (${result.metadata.compression} compresión)`,
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: t('products.imageUploadError'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setImagePreview(null);
    }
  }, [t, refreshProducts]);

  const handleDeleteImage = useCallback(async (productId, imageUrl) => {
    if (!imageUrl) return;

    try {
      // Extract file path from URL
      const filePath = imageUrl.split('/').pop();
      await deleteProductImage(filePath);

      // Update product in database
      const { error: updateError } = await supabase
        .from('products')
        .update({ image_url: null })
        .eq('id', productId);

      if (updateError) throw updateError;

      // Refresh products list
      await refreshProducts();

      toast({
        title: t('products.imageDeleted'),
        description: t('products.imageDeletedSuccess'),
      });
    } catch (error) {
      console.error('Error deleting image:', error);
      toast({
        title: t('products.imageDeleteError'),
        description: error.message,
        variant: "destructive",
      });
    }
  }, [t, refreshProducts]);

  // Load currencies and exchange rates
  useEffect(() => {
    const loadCurrencies = async () => {
      try {
        const { data: currenciesData, error: currError } = await supabase
          .from('currencies')
          .select('*')
          .eq('is_active', true)
          .order('code', { ascending: true });

        if (currError) throw currError;

        setCurrencies(currenciesData || []);

        // Set base currency as default
        const baseCurrency = currenciesData?.find(c => c.is_base);
        if (baseCurrency) {
          setSelectedCurrency(baseCurrency.id);
        }

        // Load exchange rates
        const { data: ratesData, error: ratesError } = await supabase
          .from('exchange_rates')
          .select('*')
          .eq('is_active', true);

        if (ratesError) throw ratesError;

        // Create exchange rate map: "fromId-toId" => rate
        const ratesMap = {};
        (ratesData || []).forEach(rate => {
          ratesMap[`${rate.from_currency_id}-${rate.to_currency_id}`] = rate.rate;
        });
        setExchangeRates(ratesMap);
      } catch (error) {
        console.error('Error loading currencies:', error);
      }
    };

    loadCurrencies();
  }, []);

  useEffect(() => {
    // Filter products - Hide products with zero stock for non-admin users
    let filtered = products;

    // Filter out zero-stock products for customers
    if (!isAdmin) {
      filtered = filtered.filter(product => {
        const stock = product.stock !== undefined ? product.stock : 0;
        return stock > 0;
      });
    }

    if (searchTerm) {
      filtered = filtered.filter(product =>
        (product.name_es || product.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.name_en || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(product => product.category?.id === selectedCategory || product.category_id === selectedCategory);
    }

    setFilteredProducts(filtered);

    // Filter combos - Only show active combos for non-admin users
    let filteredC = combos || [];

    if (!isAdmin) {
      filteredC = filteredC.filter(combo => combo.is_active !== false);
    }

    if (searchTerm) {
      filteredC = filteredC.filter(combo =>
        combo.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    setFilteredCombos(filteredC);
  }, [products, combos, searchTerm, selectedCategory, isAdmin]);

  const handleAddToCart = (product) => {
    addToCart(product);
    toast({
      title: t('products.addedToCart'),
      description: `${product.name_es || product.name} ${t('products.addedToCartDesc')}`,
    });
  };

  // Carousel navigation functions
  const scrollCombos = (direction) => {
    if (combosScrollRef.current) {
      const scrollAmount = 400;
      const newScrollLeft = direction === 'left'
        ? combosScrollRef.current.scrollLeft - scrollAmount
        : combosScrollRef.current.scrollLeft + scrollAmount;

      combosScrollRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      });
    }
  };

  const checkScrollButtons = () => {
    if (combosScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = combosScrollRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  // Check scroll buttons when combos change
  useEffect(() => {
    checkScrollButtons();
    const scrollContainer = combosScrollRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', checkScrollButtons);
      return () => scrollContainer.removeEventListener('scroll', checkScrollButtons);
    }
  }, [filteredCombos]);

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

  const getDisplayPrice = (product) => {
    if (!product || !selectedCurrency) return '0.00';

    // Use final_price if available, otherwise use base_price
    const basePrice = parseFloat(product.final_price || product.base_price || 0);
    const productCurrencyId = product.base_currency_id;

    if (!productCurrencyId) return basePrice.toFixed(2);

    // Convert to selected currency
    const convertedPrice = convertPrice(basePrice, productCurrencyId, selectedCurrency);
    return convertedPrice.toFixed(2);
  };

  const getComboDisplayPrice = (combo) => {
    if (!combo || !selectedCurrency) return '0.00';

    // Calculate from base_price and apply ONLY combo profit margin
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

        totalBasePrice += convertedPrice * quantity;
      }
    });

    // Apply ONLY combo profit margin
    const profitMargin = parseFloat(combo.profitMargin || financialSettings.comboProfit) / 100;
    const finalPrice = totalBasePrice * (1 + profitMargin);

    return finalPrice.toFixed(2);
  };

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>
            {t('products.title')}
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {t('products.subtitle')}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-effect p-6 rounded-2xl mb-8"
        >
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder={t('products.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-gray-400" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">{t('products.categories.all')}</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {language === 'es' ? category.name_es : category.name_en}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">{language === 'es' ? 'Moneda:' : 'Currency:'}</span>
              <select
                value={selectedCurrency || ''}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                className="px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {currencies.map(currency => (
                  <option key={currency.id} value={currency.id}>
                    {currency.code} ({currency.symbol})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>

        {/* Display Combos First (if any) */}
        {filteredCombos.length > 0 && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold" style={getHeadingStyle(visualSettings)}>🎁 Combos Especiales</h2>
                {filteredCombos.length > 3 && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => scrollCombos('left')}
                      disabled={!showLeftArrow}
                      className="rounded-full w-10 h-10 p-0"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => scrollCombos('right')}
                      disabled={!showRightArrow}
                      className="rounded-full w-10 h-10 p-0"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>

            <style>{`
              .combos-carousel::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <div
              ref={combosScrollRef}
              className="combos-carousel flex gap-6 mb-12 overflow-x-auto pb-4"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {filteredCombos.map((combo, index) => {
                // Calculate savings for this combo
                const calculateSavings = () => {
                  let totalIndividual = 0;
                  (combo.products || []).forEach(productId => {
                    const product = products.find(p => p.id === productId);
                    if (product) {
                      const basePrice = parseFloat(product.base_price || 0);
                      const convertedBase = convertPrice(basePrice, product.base_currency_id, selectedCurrency);
                      const quantity = combo.productQuantities?.[productId] || 1;
                      const productMargin = parseFloat(financialSettings.productProfit || 40) / 100;
                      const priceWithMargin = convertedBase * (1 + productMargin);
                      totalIndividual += priceWithMargin * quantity;
                    }
                  });

                  const comboPrice = parseFloat(getComboDisplayPrice(combo));
                  const savings = totalIndividual - comboPrice;
                  const savingsPercent = totalIndividual > 0 ? ((savings / totalIndividual) * 100).toFixed(0) : 0;

                  return { savings: savings.toFixed(2), percent: savingsPercent };
                };

                const savingsData = calculateSavings();
                const currencySymbol = currencies.find(c => c.id === selectedCurrency)?.symbol || '$';

                return (
                  <motion.div
                    key={`combo-${combo.id}`}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="glass-effect rounded-2xl overflow-hidden hover-lift group border-2 border-purple-200 cursor-pointer flex-shrink-0"
                    style={{ width: '300px' }}
                    onClick={() => onNavigate('product-detail', { itemId: combo.id, itemType: 'combo' })}
                  >
                    <div className="aspect-square bg-gradient-to-br from-purple-100 to-pink-100 relative">
                      {combo.image ? (
                        <img
                          src={combo.image}
                          alt={combo.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-20 h-20 text-purple-300" />
                        </div>
                      )}

                      {/* Savings Badge - Top Left */}
                      {savingsData.savings > 0 && (
                        <div className="absolute top-2 left-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg shadow-lg animate-pulse">
                          <div className="flex flex-col items-center leading-tight">
                            <span className="text-[10px] opacity-90">{language === 'es' ? 'AHORRA' : 'SAVE'}</span>
                            <span className="text-sm">{currencySymbol}{savingsData.savings}</span>
                            <span className="text-[10px] bg-white bg-opacity-20 px-2 rounded-full mt-0.5">-{savingsData.percent}%</span>
                          </div>
                        </div>
                      )}

                      {/* Combo Badge - Top Right */}
                      <div className="absolute top-2 right-2 bg-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        COMBO
                      </div>
                    </div>

                  <div className="p-4">
                    <h3 className="font-bold text-lg mb-2">{combo.name}</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      {combo.products?.length || 0} {t('vendor.combos.includedProducts')}
                    </p>

                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-2xl font-bold text-purple-600">
                          {currencies.find(c => c.id === selectedCurrency)?.symbol || '$'}{getComboDisplayPrice(combo)}
                        </p>
                        <p className="text-xs text-gray-500">{currencies.find(c => c.id === selectedCurrency)?.code || 'USD'}</p>
                      </div>
                    </div>

                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart({ ...combo, type: 'combo' });
                      }}
                      className="w-full"
                      style={{
                        background: visualSettings.useGradient
                          ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                          : visualSettings.buttonBgColor || '#2563eb',
                        color: visualSettings.buttonTextColor || '#ffffff',
                        border: 'none'
                      }}
                    >
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      {t('products.addToCart')}
                    </Button>
                  </div>
                </motion.div>
                );
              })}
            </div>
          </>
        )}

        {/* Products Section */}
        {filteredProducts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <h2 className="text-2xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>📦 Productos</h2>
          </motion.div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map((product, index) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="glass-effect rounded-2xl overflow-hidden hover-lift group cursor-pointer"
              onClick={() => onNavigate('product-detail', { itemId: product.id, itemType: 'product' })}
            >
              <div className="aspect-square bg-gray-100 relative group">
                {imagePreview && editingProduct === product.id ? (
                  <img
                    className="w-full h-full object-cover"
                    alt={t('products.preview')}
                    src={imagePreview}
                  />
                ) : (
                  <img
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    alt={product.name_es || product.name}
                    src={product.image_url || "https://images.unsplash.com/photo-1646193186132-7976c1670e81"}
                  />
                )}

                {isAdmin && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center z-10">
                    <div className="flex gap-2">
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={(e) => {
                            e.stopPropagation();
                            setEditingProduct(product.id);
                            handleImageUpload(e, product.id);
                          }}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="bg-white hover:bg-gray-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Upload className="w-4 h-4" />
                        </Button>
                      </label>
                      {product.image_url && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteImage(product.id, product.image_url);
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {isUploading && editingProduct === product.id && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
                    <div className="w-full max-w-[80%] bg-white rounded-lg p-4">
                      <div className="h-2 bg-gray-200 rounded">
                        <div
                          className="h-full rounded transition-all duration-300"
                          style={{
                            width: `${uploadProgress}%`,
                            background: visualSettings.useGradient
                              ? `linear-gradient(to right, ${visualSettings.primaryColor}, ${visualSettings.secondaryColor})`
                              : visualSettings.primaryColor
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6">
                <h3 className="text-lg font-semibold mb-2">{product.name_es || product.name}</h3>
                {product.category && (
                  <p className="text-sm text-gray-500 mb-2">
                    {language === 'es' ? product.category.name_es : product.category.name_en}
                  </p>
                )}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xl font-bold text-green-600">
                      {currencies.find(c => c.id === selectedCurrency)?.symbol || '$'}{getDisplayPrice(product)}
                    </div>
                    <p className="text-xs text-gray-500">{currencies.find(c => c.id === selectedCurrency)?.code || 'USD'}</p>
                  </div>
                </div>

                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToCart(product);
                  }}
                  className="w-full"
                  style={{
                    background: visualSettings.useGradient
                      ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                      : visualSettings.buttonBgColor || '#2563eb',
                    color: visualSettings.buttonTextColor || '#ffffff',
                    border: 'none'
                  }}
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  {t('products.addToCart')}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">
              {t('products.noProducts')}
            </h3>
            <p className="text-gray-500">{t('products.noProductsDesc')}</p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ProductsPage;