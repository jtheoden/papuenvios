import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ArrowRight, ShoppingCart, Package, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { CurrencySelector } from '@/components/CurrencySelector';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { getProductPriceInCurrency, getComboPriceInCurrency } from '@/lib/publicPricing';
import CatalogLoadError from '@/components/CatalogLoadError';

// Product Thumbnail Component with Toggle
const ProductThumbnail = ({ product, selectedCurrency, currencySymbol, currencyCode, convertAmount, quantity = 1 }) => {
  const [expanded, setExpanded] = useState(false);
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  // Stored final_price in the selected currency; null when the product has no usable price
  const unitPrice = getProductPriceInCurrency(product, { convert: convertAmount, selectedCurrencyId: selectedCurrency });
  const unitLabel = unitPrice === null ? null : unitPrice.toFixed(2);
  const totalLabel = unitPrice === null ? null : (parseFloat(unitLabel) * quantity).toFixed(2);

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-200 last:border-0">
      <motion.div
        className="flex-shrink-0 cursor-pointer relative"
        onClick={() => setExpanded(!expanded)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          animate={{
            width: expanded ? '120px' : '60px',
            height: expanded ? '120px' : '60px',
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="rounded-lg overflow-hidden border-2 border-gray-300 bg-gradient-to-br from-gray-100 to-gray-200"
        >
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={language === 'es'
                ? (product.name_es || product.name)
                : (product.name_en || product.name_es || product.name)
              }
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div className={`w-full h-full flex items-center justify-center ${product.image_url ? 'hidden' : ''}`}>
            <Package className="w-8 h-8 text-gray-300" />
          </div>
        </motion.div>
      </motion.div>
      <div className="flex-1">
        <p className="font-medium text-gray-800">
          {language === 'es'
            ? (product.name_es || product.name)
            : (product.name_en || product.name_es || product.name)
          }
        </p>
        {product.category && (
          <p className="text-xs text-gray-500">
            {language === 'es' ? product.category.name_es : product.category.name_en}
          </p>
        )}
        {/* Always show quantity in combos */}
        <p className="text-sm font-semibold" style={getHeadingStyle(visualSettings)}>
          {language === 'es' ? `Cantidad: ${quantity}` : `Quantity: ${quantity}`}
        </p>
      </div>
      <div className="text-right">
        {/* Show individual price per unit */}
        {unitLabel === null ? (
          <p className="text-xs text-gray-500">{t('products.priceUnavailable')}</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-1">
              {currencySymbol}{unitLabel} {language === 'es' ? 'c/u' : 'each'}
            </p>
            {/* Show total price for this product (price × quantity) */}
            <p className="font-semibold text-gray-800">
              {language === 'es' ? 'Total:' : 'Total:'} {currencySymbol}{totalLabel}
            </p>
            <p className="text-xs text-gray-500">{currencyCode}</p>
          </>
        )}
      </div>
    </div>
  );
};

const ProductDetailPage = ({ onNavigate, itemId, itemType }) => {
  const { t, language } = useLanguage();
  const { products, combos, categories, addToCart, visualSettings, catalogError } = useBusiness();
  const { isAdmin } = useAuth();
  const { selectedCurrency, setSelectedCurrency, currencySymbol, currencyCode, convertAmount, currencies, loading: currenciesLoading } = useCurrency();
  const baseCurrencyId = currencies?.find(currency => currency.is_base)?.id ?? null;
  const [currentItem, setCurrentItem] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentList, setCurrentList] = useState([]);
  const [showTransition, setShowTransition] = useState(false);

  useEffect(() => {
    // Determine which list to use based on itemType
    const list = itemType === 'combo' ? combos : products;
    setCurrentList(list);

    // Find the current item index
    const index = list.findIndex(item => item.id === itemId);
    if (index !== -1) {
      setCurrentIndex(index);
      setCurrentItem(list[index]);
    }
  }, [itemId, itemType, products, combos]);


  // Stored final_price of the item in the selected currency, formatted; null when it has no
  // usable price (never 0). Products are priced in their own currency, combos in the base one.
  const getDisplayPrice = (item, isProduct) => {
    if (!item) return null;

    const price = isProduct
      ? getProductPriceInCurrency(item, { convert: convertAmount, selectedCurrencyId: selectedCurrency })
      : getComboPriceInCurrency(item, { convert: convertAmount, baseCurrencyId, selectedCurrencyId: selectedCurrency });

    return price === null ? null : price.toFixed(2);
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      // Navigate to previous item in same list
      const prevItem = currentList[currentIndex - 1];
      setCurrentIndex(currentIndex - 1);
      setCurrentItem(prevItem);
      setShowTransition(false);
    } else {
      // At first item, show transition to other list
      setShowTransition(true);
    }
  };

  const handleNext = () => {
    if (currentIndex < currentList.length - 1) {
      // Navigate to next item in same list
      const nextItem = currentList[currentIndex + 1];
      setCurrentIndex(currentIndex + 1);
      setCurrentItem(nextItem);
      setShowTransition(false);
    } else {
      // At last item, show transition to other list
      setShowTransition(true);
    }
  };

  const handleTransitionClick = () => {
    // Determine current type based on current item, not prop
    const currentIsProduct = !currentItem?.products; // Products don't have a 'products' array

    if (currentIsProduct && currentIndex === currentList.length - 1) {
      // At last product, transition to first combo
      if (combos.length > 0) {
        const firstCombo = combos[0];
        setCurrentList(combos);
        setCurrentIndex(0);
        setCurrentItem(firstCombo);
        setShowTransition(false);
      }
    } else if (currentIsProduct && currentIndex === 0) {
      // At first product, transition to last combo
      if (combos.length > 0) {
        const lastCombo = combos[combos.length - 1];
        setCurrentList(combos);
        setCurrentIndex(combos.length - 1);
        setCurrentItem(lastCombo);
        setShowTransition(false);
      }
    } else if (!currentIsProduct && currentIndex === currentList.length - 1) {
      // At last combo, transition to first product
      if (products.length > 0) {
        const firstProduct = products[0];
        setCurrentList(products);
        setCurrentIndex(0);
        setCurrentItem(firstProduct);
        setShowTransition(false);
      }
    } else if (!currentIsProduct && currentIndex === 0) {
      // At first combo, transition to last product
      if (products.length > 0) {
        const lastProduct = products[products.length - 1];
        setCurrentList(products);
        setCurrentIndex(products.length - 1);
        setCurrentItem(lastProduct);
        setShowTransition(false);
      }
    }
  };

  const handleAddToCart = () => {
    // For display consistency, use the price already shown in the current selected currency
    // This ensures what user sees is what gets added to cart
    const displayedPrice = parseFloat(getDisplayPrice(currentItem, isProduct));
    if (!Number.isFinite(displayedPrice)) return;

    // Add to cart with price and currency info
    const itemWithPrice = {
      ...currentItem,
      // Explicit type so a combo is never stored as a product order item (stock handling depends on it)
      type: isProduct ? 'product' : 'combo',
      displayed_price: displayedPrice,
      displayed_currency_code: currencyCode,
      displayed_currency_id: selectedCurrency
    };

    addToCart(itemWithPrice);
    const itemName = language === 'es'
      ? (currentItem.name_es || currentItem.name)
      : (currentItem.name_en || currentItem.name_es || currentItem.name);
    toast({
      title: t('products.addedToCart'),
      description: `${itemName} ${t('products.addedToCartDesc')}`,
    });
  };

  const getCategoryName = (categoryId) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return '';
    return language === 'es' ? (category.name_es || category.es) : (category.name_en || category.en);
  };

  // Show loading while currencies load
  if (!selectedCurrency || currenciesLoading) {
    return (
      <div className="min-h-screen py-8 px-4 flex items-center justify-center">
        <p className="text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="min-h-screen py-8 px-4 flex flex-col items-center justify-center">
        <CatalogLoadError error={catalogError} />
        <p className="text-gray-500">{t('products.noProducts')}</p>
      </div>
    );
  }

  const isProduct = !currentItem.products; // Products don't have a 'products' array
  const price = getDisplayPrice(currentItem, isProduct);
  const priceUnavailable = price === null;

  // Combo vs buying the components separately, from the stored prices only. Any unpriced
  // component makes the comparison unreliable, so it is not shown at all.
  const comboComparison = (() => {
    if (isProduct) return null;

    const lines = (currentItem.products || []).reduce((acc, productId) => {
      const product = products.find(p => p.id === productId);
      if (!product) return acc;

      const quantity = currentItem.productQuantities?.[productId] || 1;
      const unit = getProductPriceInCurrency(product, { convert: convertAmount, selectedCurrencyId: selectedCurrency });
      acc.push({ productId, product, quantity, total: unit === null ? null : unit * quantity });
      return acc;
    }, []);

    if (lines.some(line => line.total === null)) return null;

    const totalIndividual = lines.reduce((sum, line) => sum + line.total, 0);
    return {
      lines,
      totalIndividual,
      savings: priceUnavailable ? null : totalIndividual - parseFloat(price)
    };
  })();

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Back Button */}
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => onNavigate('products')}
          className="mb-6 flex items-center text-gray-600 hover:text-gray-900 transition-colors"
        >
          {isProduct ? t('products.detail.backToProducts') : t('products.detail.backToCombos')}
        </motion.button>

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Image Section */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative"
          >
            <div className="aspect-square rounded-2xl overflow-hidden bg-gray-100 relative">
              {currentItem.image_url || currentItem.image ? (
                <img
                  src={currentItem.image_url || currentItem.image}
                  alt={currentItem.name_es || currentItem.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="w-24 h-24 text-gray-300" />
                </div>
              )}

              {!isProduct && (
                <div className="absolute top-4 right-4 bg-purple-600 text-white text-sm font-bold px-4 py-2 rounded-full">
                  COMBO
                </div>
              )}
            </div>

            {/* Navigation Arrows */}
            <div className="flex items-center justify-between mt-6">
              <Button
                onClick={handlePrevious}
                variant="outline"
                size="lg"
                disabled={currentIndex === 0 && itemType === 'combo' && products.length === 0}
                className="flex items-center gap-2"
              >
                <ChevronLeft className="w-5 h-5" />
                {t('products.detail.previous')}
              </Button>

              <Button
                onClick={handleNext}
                variant="outline"
                size="lg"
                disabled={currentIndex === currentList.length - 1 && itemType === 'combo' && products.length === 0}
                className="flex items-center gap-2"
              >
                {t('products.detail.next')}
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            {/* Transition Message */}
            {showTransition && (() => {
              const currentIsProduct = !currentItem?.products;
              return (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4"
                >
                  <Button
                    onClick={handleTransitionClick}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    size="lg"
                  >
                    {/* Show appropriate transition message based on current item type */}
                    {currentIsProduct && (currentIndex === currentList.length - 1 || currentIndex === 0) && t('products.detail.continueToCombos')}
                    {!currentIsProduct && (currentIndex === currentList.length - 1 || currentIndex === 0) && t('products.detail.continueToProducts')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </motion.div>
              );
            })()}
          </motion.div>

          {/* Details Section */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
                {language === 'es'
                  ? (currentItem.name_es || currentItem.name)
                  : (currentItem.name_en || currentItem.name_es || currentItem.name)
                }
              </h1>
              {isProduct && (currentItem.category_id || currentItem.category) && (
                <div className="flex items-center gap-2 text-gray-600 mb-4">
                  <Tag className="w-4 h-4" />
                  <span>{getCategoryName(currentItem.category_id || currentItem.category)}</span>
                </div>
              )}
            </div>

            {/* Price */}
            <div className="glass-effect p-6 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">{t('products.detail.displayIn')}</span>
                <CurrencySelector
                  selectedCurrency={selectedCurrency}
                  onCurrencyChange={setSelectedCurrency}
                  showSymbol={true}
                />
              </div>
              <div className="flex items-baseline gap-2">
                {priceUnavailable ? (
                  <span className="text-2xl font-semibold text-gray-500">{t('products.priceUnavailable')}</span>
                ) : (
                  <>
                    <span className="text-4xl font-bold" style={getHeadingStyle(visualSettings)}>{currencySymbol}{price}</span>
                    <span className="text-gray-500">{currencyCode}</span>
                  </>
                )}
              </div>
            </div>

            {/* Description */}
            {(currentItem.description_es || currentItem.description_en || currentItem.description) && (
              <div className="glass-effect p-6 rounded-xl">
                <h3 className="font-semibold text-lg mb-2">{t('products.detail.description')}</h3>
                <p className="text-gray-600">
                  {language === 'es'
                    ? (currentItem.description_es || currentItem.description)
                    : (currentItem.description_en || currentItem.description_es || currentItem.description)}
                </p>
              </div>
            )}

            {/* Product-specific Details */}
            {isProduct && (
              <div className="space-y-4">
                {/* Stock - Only visible to admin/super_admin */}
                {isAdmin && currentItem.stock !== undefined && (
                  <div className="flex items-center justify-between glass-effect p-4 rounded-xl">
                    <span className="text-gray-600">{t('products.detail.stock')}:</span>
                    <span className={`font-semibold ${currentItem.stock > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {currentItem.stock > 0
                        ? `${currentItem.stock} ${t('products.detail.units')}`
                        : t('products.detail.outOfStock')
                      }
                    </span>
                  </div>
                )}

                {/* Expiry Date */}
                {currentItem.expiryDate && (
                  <div className="flex items-center justify-between glass-effect p-4 rounded-xl">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar className="w-4 h-4" />
                      <span>{t('products.detail.expiryDate')}:</span>
                    </div>
                    <span className="font-semibold">{currentItem.expiryDate}</span>
                  </div>
                )}
              </div>
            )}

            {/* Combo-specific Details */}
            {!isProduct && (
              <div className="space-y-4">
                {/* Price Comparison for Customers: only when every price is a stored, usable one */}
                {comboComparison && !priceUnavailable && (
                  <div className="glass-effect p-6 rounded-xl bg-gradient-to-r from-purple-50 to-pink-50">
                    <h3 className="font-semibold text-lg mb-3" >💰
                     <span style={getHeadingStyle(visualSettings)}> {t('products.detail.saveWithCombo')}</span>
                    </h3>
                    <div className="space-y-3">
                      <div className="bg-white bg-opacity-50 p-3 rounded-lg space-y-1">
                        <p className="text-sm font-semibold text-gray-700 mb-2">
                          {t('products.detail.buyingSeparately')}
                        </p>
                        {comboComparison.lines.map(({ productId, product, quantity, total }) => (
                          <div key={productId} className="flex justify-between text-xs text-gray-600">
                            <span>
                              {language === 'es'
                                ? (product.name_es || product.name)
                                : (product.name_en || product.name_es || product.name)
                              } × {quantity}
                            </span>
                            <span>{currencySymbol}{total.toFixed(2)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between pt-2 border-t border-gray-300">
                          <span className="font-semibold text-gray-700">{t('products.detail.total')}</span>
                          <span className="text-lg font-semibold line-through text-gray-500">
                            {currencySymbol}{comboComparison.totalIndividual.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-purple-200">
                        <span className="text-lg font-bold" style={getHeadingStyle(visualSettings)}>
                          {t('products.detail.comboPrice')}
                        </span>
                        <span className="text-2xl font-bold" style={getHeadingStyle(visualSettings)}>
                          {currencySymbol}{price}
                        </span>
                      </div>
                      <div className="text-center pt-2">
                        <span className="inline-block bg-green-100 px-4 py-2 rounded-full text-sm font-semibold" style={getHeadingStyle(visualSettings)}>
                          {t('products.detail.youSave')}
                          {currencySymbol}{comboComparison.savings.toFixed(2)}!
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Included Products */}
                <div className="glass-effect p-6 rounded-xl">
                  <h3 className="font-semibold text-lg mb-3">{t('products.detail.includedProducts')}</h3>
                  <div className="space-y-3">
                    {currentItem.products?.map(productId => {
                      const product = products.find(p => p.id === productId);
                      const quantity = currentItem.productQuantities?.[productId] || 1;
                      return product ? (
                        <ProductThumbnail
                          key={productId}
                          product={product}
                          selectedCurrency={selectedCurrency}
                          currencySymbol={currencySymbol}
                          currencyCode={currencyCode}
                          convertAmount={convertAmount}
                          quantity={quantity}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Add to Cart Button */}
            <Button
              onClick={handleAddToCart}
              disabled={priceUnavailable}
              size="lg"
              className="w-full text-lg py-6"
              style={getPrimaryButtonStyle(visualSettings)}
            >
              <ShoppingCart className="w-5 h-5 mr-2" />
              {priceUnavailable ? t('products.priceUnavailable') : t('products.addToCart')}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailPage;
