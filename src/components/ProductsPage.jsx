import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, ShoppingCart, Plus, Package, Upload, X, ChevronLeft, ChevronRight, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/components/ui/use-toast';
import { uploadProductImage, deleteProductImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { validateAndProcessImage } from '@/lib/imageUtils';
import { getHeadingStyle } from '@/lib/styleUtils';
import CurrencySelector from '@/components/CurrencySelector';
import PriceDisplay from '@/components/PriceDisplay';
import { useUserDiscounts } from '@/hooks/useUserDiscounts';
import { buildDiscountBreakdown } from '@/lib/discountDisplayService';
import { computeComboPricing } from '@/lib/comboUtils';
import { useRealtimeProducts, useRealtimeCombos } from '@/hooks/useRealtimeSubscription';

const ProductsPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { user, isAdmin } = useAuth();
  const { products, combos, categories, addToCart, financialSettings, refreshProducts, visualSettings } = useBusiness();
  const { selectedCurrency, setSelectedCurrency, currencySymbol, currencyCode, convertAmount, currencyMap } = useCurrency();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [filteredCombos, setFilteredCombos] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingProduct, setEditingProduct] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const combosScrollRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const { categoryInfo, categoryDiscountPercent } = useUserDiscounts();
  const userCategory = categoryInfo.category || 'regular';
  const userCategoryDiscount = categoryDiscountPercent;

  const baseCurrencyId = useMemo(() => {
    let baseId = null;
    currencyMap?.forEach(cur => {
      if (!baseId && cur?.is_base) {
        baseId = cur.id;
      }
    });
    return baseId || selectedCurrency;
  }, [currencyMap, selectedCurrency]);

  // Suscripción real-time para productos - actualiza automáticamente cuando cambian
  useRealtimeProducts({
    enabled: true,
    onUpdate: () => {
      console.log('[ProductsPage] Products realtime update');
      refreshProducts();
    }
  });

  // Suscripción real-time para combos - actualiza automáticamente cuando cambian
  useRealtimeCombos({
    enabled: true,
    onUpdate: () => {
      console.log('[ProductsPage] Combos realtime update');
      refreshProducts();
    }
  });

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
      const fileName = `product-${productId}-${Date.now()}`;
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
      await deleteProductImage(imageUrl);

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


  useEffect(() => {
    // Filter products - Show all products (including zero stock with visual indicator)
    let filtered = products;

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

    // Filter combos - show all combos (inactive ones will be displayed as disabled)
    let filteredC = combos || [];

    if (searchTerm) {
      filteredC = filteredC.filter(combo =>
        combo.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    setFilteredCombos(filteredC);
  }, [products, combos, searchTerm, selectedCategory, isAdmin]);

  const handleAddToCart = (product) => {
    addToCart(product);
    const productName = language === 'es'
      ? (product.name_es || product.name)
      : (product.name_en || product.name_es || product.name);
    toast({
      title: t('products.addedToCart'),
      description: `${productName} ${t('products.addedToCartDesc')}`,
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

  /**
   * Calculate combo display price (synchronous version)
   * For use in calculations and displays without async/await
   * Applies user category discounts to combos as well
   */
  const getComboBaseAndFinal = useCallback((combo) => {
    const pricing = computeComboPricing({
      combo,
      products,
      convert: convertAmount,
      selectedCurrencyId: selectedCurrency,
      baseCurrencyId,
      defaultProfitMargin: financialSettings.comboProfit
    });

    return pricing;
  }, [products, convertAmount, selectedCurrency, baseCurrencyId, financialSettings.comboProfit]);

  const getComboDisplayPrice = useCallback((combo) => {
    if (!combo) return '0.00';

    const { finalPrice } = getComboBaseAndFinal(combo);
    const breakdown = buildDiscountBreakdown({ amount: finalPrice, categoryPercent: userCategoryDiscount });

    return breakdown.finalAmount.toFixed(2);
  }, [getComboBaseAndFinal, userCategoryDiscount]);

  /**
   * Get combo price breakdown for display (original + discount)
   */
  const getComboPriceBreakdown = useCallback((combo) => {
    if (!combo) return { original: '0.00', discount: '0.00', final: '0.00' };

    const { finalPrice } = getComboBaseAndFinal(combo);
    const breakdown = buildDiscountBreakdown({ amount: finalPrice, categoryPercent: userCategoryDiscount });

    return {
      original: finalPrice.toFixed(2),
      discount: breakdown.total.amount.toFixed(2),
      final: breakdown.finalAmount.toFixed(2),
      hasDiscount: breakdown.total.amount > 0,
      percent: breakdown.total.percent
    };
  }, [getComboBaseAndFinal, userCategoryDiscount]);

  /**
   * Get display price for a product with discount applied
   * Use final_price directly (already includes profit margin from database)
   * Do NOT apply margin again - that was the double-margin bug
   */
  const getDisplayPrice = useCallback((product) => {
    if (!product) return '0.00';

    // Use final_price from database (already includes margin)
    const basePrice = parseFloat(product.final_price || product.base_price || 0);
    const productCurrencyId = product.base_currency_id;

    // Convert to selected currency
    let convertedPrice = basePrice;
    if (productCurrencyId && productCurrencyId !== selectedCurrency) {
      convertedPrice = convertAmount(basePrice, productCurrencyId, selectedCurrency);
    }

    const breakdown = buildDiscountBreakdown({ amount: convertedPrice, categoryPercent: userCategoryDiscount });

    return breakdown.finalAmount.toFixed(2);
  }, [selectedCurrency, convertAmount, userCategoryDiscount]);

  /**
   * Get price breakdown for display (original + discount)
   */
  const getPriceBreakdown = useCallback((product) => {
    if (!product) return { original: '0.00', discount: '0.00', final: '0.00' };

    const basePrice = parseFloat(product.final_price || product.base_price || 0);
    const productCurrencyId = product.base_currency_id;

    let convertedPrice = basePrice;
    if (productCurrencyId && productCurrencyId !== selectedCurrency) {
      convertedPrice = convertAmount(basePrice, productCurrencyId, selectedCurrency);
    }

    const breakdown = buildDiscountBreakdown({ amount: convertedPrice, categoryPercent: userCategoryDiscount });

    return {
      original: convertedPrice.toFixed(2),
      discount: breakdown.total.amount.toFixed(2),
      final: breakdown.finalAmount.toFixed(2),
      hasDiscount: breakdown.total.amount > 0,
      percent: breakdown.total.percent
    };
  }, [selectedCurrency, convertAmount, userCategoryDiscount]);


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

            <CurrencySelector
              selectedCurrency={selectedCurrency}
              onCurrencyChange={setSelectedCurrency}
              label={language === 'es' ? 'Moneda:' : 'Currency:'}
              showSymbol
              size="md"
              className="px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
                <h2 className="text-2xl font-bold" >🎁 <span style={getHeadingStyle(visualSettings)}>{t('products.specialCombos')}</span></h2>
                {filteredCombos.length > 3 && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => scrollCombos('left')}
                      disabled={!showLeftArrow}
                      className="rounded-full w-10 h-10 p-0"
                      aria-label={t('products.scrollLeft')}
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => scrollCombos('right')}
                      disabled={!showRightArrow}
                      className="rounded-full w-10 h-10 p-0"
                      aria-label={t('products.scrollRight')}
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
                // Check if combo is inactive (for non-admin users, show as disabled)
                const isComboInactive = !isAdmin && combo.is_active === false;

                // Savings calculation with currency conversion applied
                const calculateSavings = () => {
                  let totalIndividual = 0;
                  (combo.products || []).forEach(productId => {
                    const product = products.find(p => p.id === productId);
                    if (product) {
                      const basePrice = parseFloat(product.base_price || 0);
                      const productCurrencyId = product.base_currency_id;
                      const quantity = combo.productQuantities?.[productId] || 1;

                      // Convert to selected currency first
                      let convertedPrice = basePrice;
                      if (productCurrencyId && productCurrencyId !== selectedCurrency) {
                        convertedPrice = convertAmount(basePrice, productCurrencyId, selectedCurrency);
                      }

                      const productMargin = parseFloat(financialSettings.productProfit || 40) / 100;
                      const priceWithMargin = convertedPrice * (1 + productMargin);
                      totalIndividual += priceWithMargin * quantity;
                    }
                  });

                  const comboPrice = parseFloat(getComboDisplayPrice(combo));
                  const savings = totalIndividual - comboPrice;
                  const savingsPercent = totalIndividual > 0 ? ((savings / totalIndividual) * 100).toFixed(0) : 0;

                  return { savings: savings.toFixed(2), percent: savingsPercent };
                };

                const savingsData = calculateSavings();

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
                      <div className="flex-1">
                        {userCategoryDiscount > 0 && (
                          <div className="mb-2">
                            <div className="text-xs text-gray-500 line-through">
                              {currencySymbol}{getComboPriceBreakdown(combo).original} {currencyCode}
                            </div>
                            <div className="text-xs text-green-600 font-semibold flex items-center gap-1">
                              <Tag className="w-3 h-3" />
                              {language === 'es' ? 'Descuento' : 'Discount'} {getComboPriceBreakdown(combo).percent?.toFixed(2) || userCategoryDiscount}%: -{currencySymbol}{getComboPriceBreakdown(combo).discount}
                            </div>
                          </div>
                        )}
                        <p className="text-2xl font-bold text-purple-600">
                          {currencySymbol}{getComboDisplayPrice(combo)} <span className="text-sm text-gray-600">{currencyCode}</span>
                        </p>
                        {userCategory !== 'regular' && (
                          <div className="text-xs text-blue-600 mt-1">
                            {language === 'es' ? `Categoría: ${userCategory}` : `Category: ${userCategory}`}
                          </div>
                        )}
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
            <h2 className="text-2xl font-bold mb-4">📦 <span  style={getHeadingStyle(visualSettings)}>Productos</span></h2>
          </motion.div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map((product, index) => {
            const isOutOfStock = !isAdmin && (product.stock === undefined || product.stock === null || product.stock <= 0);

            return (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`glass-effect rounded-2xl overflow-hidden group cursor-pointer ${isOutOfStock ? 'opacity-60' : 'hover-lift'}`}
              onClick={() => onNavigate('product-detail', { itemId: product.id, itemType: 'product' })}
            >
              <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 relative group">
                {imagePreview && editingProduct === product.id ? (
                  <img
                    className="w-full h-full object-cover"
                    alt={t('products.preview')}
                    src={imagePreview}
                  />
                ) : (product.image_url || product.image_file) ? (
                  <img
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    alt={product.name_es || product.name}
                    src={product.image_url || product.image_file}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                {/* Fallback icon when no image or image fails to load */}
                <div className={`absolute inset-0 flex items-center justify-center ${(product.image_url || product.image_file) ? 'hidden' : ''}`}>
                  <Package className="w-20 h-20 text-gray-300" />
                </div>

                {/* Out of Stock Badge */}
                {isOutOfStock && (
                  <div className="absolute top-2 right-2 bg-gray-800 text-white text-xs font-bold px-3 py-1 rounded-full z-10">
                    {language === 'es' ? 'Agotado' : 'Out of Stock'}
                  </div>
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
                <h3 className="text-lg font-semibold mb-2">
                  {language === 'es'
                    ? (product.name_es || product.name)
                    : (product.name_en || product.name_es || product.name)
                  }
                </h3>
                {product.category && (
                  <p className="text-sm text-gray-500 mb-2">
                    {language === 'es' ? product.category.name_es : product.category.name_en}
                  </p>
                )}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex-1">
                    {userCategoryDiscount > 0 && (
                      <div className="mb-2">
                        <div className="text-xs text-gray-500 line-through">
                          {currencySymbol}{getPriceBreakdown(product).original} {currencyCode}
                        </div>
                        <div className="text-xs text-green-600 font-semibold flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {language === 'es' ? 'Descuento' : 'Discount'} {getPriceBreakdown(product).percent?.toFixed(2) || userCategoryDiscount}%: -{currencySymbol}{getPriceBreakdown(product).discount}
                        </div>
                      </div>
                    )}
                    <div className="text-xl font-bold text-green-600">
                      {currencySymbol}{getDisplayPrice(product)} <span className="text-sm text-gray-600">{currencyCode}</span>
                    </div>
                    {userCategory !== 'regular' && (
                      <div className="text-xs text-blue-600 mt-1">
                        {language === 'es' ? `Categoría: ${userCategory}` : `Category: ${userCategory}`}
                      </div>
                    )}
                  </div>
                </div>

                {!isAdmin && (
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isOutOfStock) handleAddToCart(product);
                    }}
                    disabled={isOutOfStock}
                    className="w-full"
                    style={isOutOfStock ? {
                      background: '#9ca3af',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'not-allowed'
                    } : {
                      background: visualSettings.useGradient
                        ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                        : visualSettings.buttonBgColor || '#2563eb',
                      color: visualSettings.buttonTextColor || '#ffffff',
                      border: 'none'
                    }}
                  >
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    {isOutOfStock
                      ? (language === 'es' ? 'Agotado' : 'Out of Stock')
                      : t('products.addToCart')
                    }
                  </Button>
                )}
              </div>
            </motion.div>
          );
          })}
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
