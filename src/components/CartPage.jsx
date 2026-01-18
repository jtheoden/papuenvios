import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, X, Plus, Minus, Copy, Upload, CheckCircle, MessageCircle, ArrowLeft, ArrowRight, Tag, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle, getAlertStyle } from '@/lib/styleUtils';
import { processImage } from '@/lib/imageUtils';
import { getActiveShippingZones, calculateShippingCost } from '@/lib/shippingService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import { convertCurrency } from '@/lib/currencyService';
import { generateWhatsAppURL, notifyAdminNewPayment, openWhatsAppChat } from '@/lib/whatsappService';
import { getActiveWhatsappRecipient, getFreshWhatsappRecipient, getFreshNotificationSettings } from '@/lib/notificationSettingsService';
import { createOrder, uploadPaymentProof } from '@/lib/orderService';
import { getAvailableZelleAccount } from '@/lib/zelleService';
import { FILE_SIZE_LIMITS, ALLOWED_IMAGE_TYPES } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { calculateOrderTotal } from '@/lib/priceCalculationService';
import { validateAndGetOffer, recordOfferUsage } from '@/lib/orderDiscountService';
import { buildDiscountBreakdown } from '@/lib/discountDisplayService';
import { logActivity } from '@/lib/activityLogger';
import RecipientSelector from '@/components/RecipientSelector';
import ZelleAccountSelector from '@/components/ZelleAccountSelector';
import ZelleAccountAlert from '@/components/ZelleAccountAlert';
import FileUploadWithPreview from '@/components/FileUploadWithPreview';
import CurrencySelector from '@/components/CurrencySelector';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useUserDiscounts } from '@/hooks/useUserDiscounts';
import { useModal } from '@/contexts/ModalContext';

const CartPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { cart, updateCartQuantity, removeFromCart, clearCart, financialSettings, zelleAccounts, visualSettings, businessInfo, notificationSettings } = useBusiness();
  const { isAuthenticated, user } = useAuth();
  const { selectedCurrency, setSelectedCurrency, currencies, currencyCode, currencySymbol, convertAmount } = useCurrency();
  const { showModal } = useModal();

  const recipientSelectorRef = useRef();

  const [view, setView] = useState('cart'); // cart, recipient, payment
  const [recipientDetails, setRecipientDetails] = useState({
    fullName: '',
    phone: '',
    province: '',
    municipality: '',
    address: ''
  });
  const [selectedRecipientData, setSelectedRecipientData] = useState(null);
  const [selectedZelle, setSelectedZelle] = useState(null);
  const [paymentProof, setPaymentProof] = useState(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [shippingZones, setShippingZones] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [convertedSubtotal, setConvertedSubtotal] = useState(null);
  const [convertedDiscountedSubtotal, setConvertedDiscountedSubtotal] = useState(null);
  const [convertedShipping, setConvertedShipping] = useState(null);
  const [convertedTotal, setConvertedTotal] = useState(null);

  // Confirmation modal state
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [confirmedOrderInfo, setConfirmedOrderInfo] = useState(null);

  const { categoryInfo, categoryDiscountPercent } = useUserDiscounts();
  const userCategory = categoryInfo.category || 'regular';
  const userCategoryDiscount = categoryDiscountPercent;

  // Coupon/offer code state
  const [couponCode, setCouponCode] = useState('');
  const [appliedOffer, setAppliedOffer] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  // Calculate item price based on type (product or combo) - memoized with useCallback
  const getItemPrice = useCallback((item) => {
    if (!item) return 0;

    // Use displayed price if available (price shown when added to cart)
    // But convert from the currency it was displayed in to the currently selected currency
    if (item.displayed_price && item.displayed_currency_id) {
      const displayedPrice = parseFloat(item.displayed_price);
      // If prices are in different currencies, convert them
      if (item.displayed_currency_id !== selectedCurrency) {
        return convertAmount(displayedPrice, item.displayed_currency_id, selectedCurrency);
      }
      return displayedPrice;
    }

    // Fallback: use calculated_price_usd if available
    if (item.calculated_price_usd) {
      return parseFloat(item.calculated_price_usd);
    }

    // Legacy fallback (for old items in cart)
    if (item.products) {
      // It's a combo - use baseTotalPrice with combo profit margin
      const basePrice = parseFloat(item.baseTotalPrice || 0);
      const profitMargin = parseFloat(item.profitMargin || financialSettings.comboProfit || 35) / 100;
      return basePrice * (1 + profitMargin);
    } else {
      // It's a product - use base_price with product profit margin
      const basePrice = parseFloat(item.base_price || item.basePrice || 0);
      const profitMargin = parseFloat(financialSettings.productProfit || 40) / 100;
      return basePrice * (1 + profitMargin);
    }
  }, [financialSettings, selectedCurrency, convertAmount]);

  // Calculate subtotal - memoized to avoid recalculation on every render
  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      return acc + getItemPrice(item) * item.quantity;
    }, 0);
  }, [cart, getItemPrice]);

  // Calculate discount amount and final total (category + offers)
  const orderTotals = useMemo(() => calculateOrderTotal({
    subtotal,
    categoryDiscount: userCategoryDiscount,
    offer: appliedOffer,
    shippingCost
  }), [appliedOffer, shippingCost, subtotal, userCategoryDiscount]);

  const categoryDiscountAmount = orderTotals?.categoryDiscountAmount || 0;
  const offerDiscountAmount = orderTotals?.offerDiscountAmount || 0;
  const totalDiscountAmount = orderTotals?.totalDiscount || 0;
  const discountedSubtotal = orderTotals?.afterAllDiscounts ?? (subtotal - totalDiscountAmount);
  const totalAmount = orderTotals?.total ?? (discountedSubtotal + shippingCost);
  const totalDisplay = totalAmount.toFixed(2);
  const effectiveDiscountPercent = subtotal > 0 ? ((totalDiscountAmount / subtotal) * 100).toFixed(2) : '0.00';
  const discountBreakdown = buildDiscountBreakdown({ amount: subtotal, categoryPercent: userCategoryDiscount, offer: appliedOffer });

  // Load shipping zones once
  useEffect(() => {
    loadShippingZones();
  }, []);

  // Restaurar flujo de checkout pendiente después del login
  useEffect(() => {
    if (isAuthenticated && cart.length > 0) {
      const savedState = localStorage.getItem('pendingCheckout');
      if (savedState) {
        try {
          const { timestamp } = JSON.parse(savedState);
          // Solo restaurar si el pendingCheckout tiene menos de 1 hora
          const ONE_HOUR = 60 * 60 * 1000;
          if (Date.now() - timestamp < ONE_HOUR) {
            localStorage.removeItem('pendingCheckout');
            // Mostrar notificación y avanzar al paso de destinatario
            toast({
              title: t('cart.restored.title'),
              description: t('cart.restored.description'),
            });
            // Avanzar al siguiente paso del checkout
            setView('recipient');
          } else {
            // Expiró, limpiar
            localStorage.removeItem('pendingCheckout');
          }
        } catch (e) {
          console.warn('[CartPage] Error restoring checkout state:', e);
          localStorage.removeItem('pendingCheckout');
        }
      }
    }
  }, [isAuthenticated, cart.length, t]);

  // Load municipalities when province changes
  useEffect(() => {
    if (recipientDetails.province) {
      const muns = getMunicipalitiesByProvince(recipientDetails.province);
      setMunicipalities(muns);
      // Reset municipality when province changes
      setRecipientDetails(prev => ({ ...prev, municipality: '' }));
    } else {
      setMunicipalities([]);
    }
  }, [recipientDetails.province]);

  // Calculate shipping when province/municipality changes or cart changes
  useEffect(() => {
    if (recipientDetails.province) {
      updateShippingCost(recipientDetails.province, recipientDetails.municipality);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientDetails.province, recipientDetails.municipality, subtotal]);

  // Convert amounts when currency or totals change
  useEffect(() => {
    convertAmounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyCode, subtotal, discountedSubtotal, shippingCost, totalAmount]);

  const loadShippingZones = async () => {
    try {
      const zones = await getActiveShippingZones();
      console.log('Shipping zones loaded:', zones);

      // Filter zones: exclude zones with shipping_cost = 0 UNLESS they are marked as free_shipping
      const availableZones = (zones || []).filter(zone => {
        const cost = parseFloat(zone.shipping_cost || 0);
        // Show if: free_shipping is true OR shipping_cost > 0
        return zone.free_shipping === true || cost > 0;
      });
      setShippingZones(availableZones);
      console.log('Zones set:', availableZones.length);
    } catch (error) {
      console.error('Error loading shipping zones:', error);
    }
  };

  const convertAmounts = async () => {
    // If selected currency is USD (base currency), no conversion needed
    if (currencyCode === 'USD') {
      setConvertedSubtotal(subtotal);
      setConvertedDiscountedSubtotal(discountedSubtotal);
      setConvertedShipping(shippingCost);
      setConvertedTotal(totalAmount);
      return;
    }

    try {
      // convertCurrency returns a numeric value (not an object), so keep a strict numeric fallback
      const convertedSub = await convertCurrency(subtotal, 'USD', currencyCode);
      const convertedDiscounted = await convertCurrency(discountedSubtotal, 'USD', currencyCode);
      const convertedShip = await convertCurrency(shippingCost, 'USD', currencyCode);
      const convertedGrandTotal = await convertCurrency(totalAmount, 'USD', currencyCode);

      const safeConvertedSub = typeof convertedSub === 'number' && !Number.isNaN(convertedSub)
        ? convertedSub
        : subtotal;
      const safeConvertedDiscounted = typeof convertedDiscounted === 'number' && !Number.isNaN(convertedDiscounted)
        ? convertedDiscounted
        : discountedSubtotal;
      const safeConvertedShip = typeof convertedShip === 'number' && !Number.isNaN(convertedShip)
        ? convertedShip
        : shippingCost;
      const safeConvertedGrandTotal = typeof convertedGrandTotal === 'number' && !Number.isNaN(convertedGrandTotal)
        ? convertedGrandTotal
        : totalAmount;

      setConvertedSubtotal(safeConvertedSub);
      setConvertedDiscountedSubtotal(safeConvertedDiscounted);
      setConvertedShipping(safeConvertedShip);
      setConvertedTotal(safeConvertedGrandTotal);
    } catch (error) {
      console.error('Error converting currency:', error);
      // Fallback to original values
      setConvertedSubtotal(subtotal);
      setConvertedDiscountedSubtotal(discountedSubtotal);
      setConvertedShipping(shippingCost);
      setConvertedTotal(totalAmount);
    }
  };

  const updateShippingCost = async (provinceName, municipalityName = null) => {
    if (!provinceName) {
      console.log('[CartPage] No province provided for shipping calculation');
      setShippingCost(0);
      return;
    }

    console.log('[CartPage] Calculating shipping for:', { provinceName, municipalityName, subtotal });
    try {
      // Pass municipality for priority-based cost lookup
      const result = await calculateShippingCost(provinceName, subtotal, municipalityName);
      console.log('[CartPage] Shipping calculation result:', result);
      const cost = typeof result?.cost === 'number' ? result.cost : 0;
      setShippingCost(cost);
      console.log('[CartPage] Shipping cost set to:', cost, 'source:', result?.source);
    } catch (error) {
      console.error('[CartPage] Error calculating shipping:', error);
      setShippingCost(0);
    }
  };

  const purchaseId = `PO-${Date.now()}`;

  const activeZelleAccount = zelleAccounts.find(acc => acc.forProducts && acc.active);

  const exchangeRateForDisplay = useMemo(() => {
    if (subtotal > 0 && convertedSubtotal !== null) {
      return convertedSubtotal / subtotal;
    }
    return 1;
  }, [convertedSubtotal, subtotal]);

  const displayValues = {
    subtotal: convertedSubtotal !== null ? convertedSubtotal : subtotal,
    discountedSubtotal: convertedDiscountedSubtotal !== null ? convertedDiscountedSubtotal : discountedSubtotal,
    shipping: convertedShipping !== null ? convertedShipping : shippingCost,
    total: convertedTotal !== null ? convertedTotal : totalAmount,
    categoryDiscount: categoryDiscountAmount * exchangeRateForDisplay,
    offerDiscount: offerDiscountAmount * exchangeRateForDisplay
  };

  const handleCheckout = async () => {
    if (!isAuthenticated) {
      // Guardar estado para restaurar después del login
      localStorage.setItem('pendingCheckout', JSON.stringify({
        timestamp: Date.now(),
        cartItemCount: cart.length
      }));

      const confirmed = await showModal({
        type: 'warning',
        title: t('auth.loginRequired'),
        message: t('auth.loginRequiredMessage'),
        confirmText: t('auth.goToLogin'),
        cancelText: t('common.cancel')
      });
      if (confirmed) {
        onNavigate('login');
      } else {
        // Si cancela, eliminar el pendingCheckout
        localStorage.removeItem('pendingCheckout');
      }
      return;
    }

    // Show payment proof notification before proceeding
    await showModal({
      type: 'info',
      title: t('auth.paymentProofRequired'),
      message: t('auth.paymentProofMessage'),
      confirmText: t('common.continue'),
      cancelText: null
    });

    await logActivity({
      action: 'checkout_initiated',
      entityType: 'cart',
      entityId: user?.id || null,
      performedBy: user?.email || 'anonymous',
      description: language === 'es'
        ? 'Usuario inició el flujo de pago desde el carrito'
        : 'User started checkout from cart',
      metadata: {
        subtotal,
        discountedSubtotal,
        shippingCost,
        total: totalAmount,
        currency: currencyCode,
        userCategory,
        userCategoryDiscount,
        categoryDiscountAmount,
        appliedOffer: appliedOffer ? {
          id: appliedOffer.id,
          code: appliedOffer.code,
          type: appliedOffer.discount_type,
          value: appliedOffer.discount_value
        } : null,
        offerDiscountAmount,
        effectiveDiscountPercent
      }
    });

    setView('recipient');
  };

  const handleRecipientSubmit = () => {
    if (!selectedRecipientData) {
      toast({
        title: t('common.error'),
        description: t('cart.validation.selectRecipient'),
        variant: 'destructive'
      });
      return;
    }

    if (!selectedZelle) {
      toast({
        title: t('common.error'),
        description: t('cart.validation.selectZelleAccount'),
        variant: 'destructive'
      });
      return;
    }

    setView('payment');
  };

  // Translate coupon error codes to user-friendly messages
  const getCouponErrorMessage = (validation) => {
    const { errorCode, requiredAmount, currentAmount, usage } = validation;

    switch (errorCode) {
      case 'NOT_FOUND':
        return language === 'es'
          ? 'Código de cupón no encontrado o inactivo'
          : 'Coupon code not found or inactive';
      case 'EXPIRED':
        return language === 'es'
          ? 'Este cupón ha expirado'
          : 'This coupon has expired';
      case 'MIN_AMOUNT':
        return language === 'es'
          ? `Compra mínima requerida: ${currencySymbol}${requiredAmount?.toFixed(2)}. Tu subtotal actual: ${currencySymbol}${currentAmount?.toFixed(2)}`
          : `Minimum purchase required: ${currencySymbol}${requiredAmount?.toFixed(2)}. Your current subtotal: ${currencySymbol}${currentAmount?.toFixed(2)}`;
      case 'GLOBAL_LIMIT':
        return language === 'es'
          ? 'Este cupón ya alcanzó su límite de usos'
          : 'This coupon has reached its usage limit';
      case 'USER_LIMIT':
        return language === 'es'
          ? `Ya usaste este cupón ${usage?.userCount || 0} veces (máximo: ${usage?.userLimit || 1})`
          : `You have already used this coupon ${usage?.userCount || 0} times (limit: ${usage?.userLimit || 1})`;
      case 'VALIDATION_ERROR':
        return language === 'es'
          ? 'Error al validar el cupón. Por favor intenta de nuevo.'
          : 'Error validating coupon. Please try again.';
      default:
        return validation.reason || t('cart.coupon.invalid');
    }
  };

  // Apply coupon code
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      setCouponError(t('cart.coupon.enterCode'));
      return;
    }

    setValidatingCoupon(true);
    setCouponError('');

    try {
      const validation = await validateAndGetOffer(couponCode, subtotal, user?.id);

      if (!validation.valid) {
        await logActivity({
          action: 'coupon_validation_blocked',
          entityType: 'offer',
          entityId: validation.code || couponCode,
          performedBy: user?.email || 'anonymous',
          description: `Coupon ${couponCode} rejected`,
          metadata: {
            reason: validation.reason,
            errorCode: validation.errorCode,
            subtotal,
            usage: validation.usage || null
          }
        });
        setCouponError(getCouponErrorMessage(validation));
        setAppliedOffer(null);
        setValidatingCoupon(false);
        return;
      }

      setAppliedOffer(validation.offer);
      await logActivity({
        action: 'coupon_applied',
        entityType: 'offer',
        entityId: validation.offer.id,
        performedBy: user?.email || 'anonymous',
        description: `Coupon ${validation.offer.code} applied`,
        metadata: {
          subtotal,
          discount: validation.offer.discount_value,
          type: validation.offer.discount_type,
          usage: validation.usage || null,
          limits: {
            global: validation.offer.max_usage_global || null,
            perUser: validation.offer.max_usage_per_user || null
          }
        }
      });
      toast({
        title: t('cart.coupon.applied'),
        description: t('cart.coupon.appliedDescription')
      });
    } catch (error) {
      console.error('Error validating coupon:', error);
      logActivity({
        action: 'coupon_validation_failed',
        entityType: 'offer',
        entityId: couponCode,
        performedBy: user?.email || 'anonymous',
        description: 'Coupon validation failed',
        metadata: { error: error.message }
      });
      setCouponError(error.message || t('cart.coupon.validationError'));
      setAppliedOffer(null);
    }

    setValidatingCoupon(false);
  };

  // Remove coupon
  const handleRemoveCoupon = () => {
    setCouponCode('');
    setAppliedOffer(null);
    setCouponError('');
    logActivity({
      action: 'coupon_removed',
      entityType: 'offer',
      entityId: couponCode || appliedOffer?.id,
      performedBy: user?.email || 'anonymous',
      description: 'Coupon removed from cart'
    });
  };

  // Use cached settings for UI display only (contact support button)
  // For actual notifications, we fetch fresh settings from DB in handleConfirmPayment
  const whatsappTarget = getActiveWhatsappRecipient(notificationSettings);

  const handleContactSupport = () => {
    if (!whatsappTarget) {
      toast({
        title: t('common.error'),
        description: t('cart.payment.whatsappNotConfigured'),
        variant: 'destructive'
      });
      return;
    }

    const message = language === 'es'
      ? `Hola! Tengo una pregunta sobre mi pedido.\n\nNúmero de pedido: ${purchaseId}`
      : `Hello! I have a question about my order.\n\nOrder number: ${purchaseId}`;

    openWhatsAppChat(whatsappTarget, message);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${text} ${t('cart.payment.copy')}!` });
  };

  const handlePaymentProofUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast({
        title: language === 'es' ? 'Tipo de archivo inválido' : 'Invalid file type',
        description: language === 'es'
          ? 'Solo se permiten imágenes JPG, PNG o WebP'
          : 'Only JPG, PNG or WebP images are allowed',
        variant: 'destructive'
      });
      return;
    }

    // Validate file size
    if (file.size > FILE_SIZE_LIMITS.PAYMENT_PROOF) {
      toast({
        title: language === 'es' ? 'Archivo muy grande' : 'File too large',
        description: language === 'es'
          ? 'El tamaño máximo es 5MB'
          : 'Maximum size is 5MB',
        variant: 'destructive'
      });
      return;
    }

    setUploadingProof(true);

    try {
      // Process image
      const result = await processImage(file, 'payment_proof');

      if (!result.success) {
        throw new Error(result.error || 'Error processing image');
      }

      // Set preview and file
      setPaymentProofPreview(result.base64);
      setPaymentProof(result.blob);

      toast({
        title: language === 'es' ? '✅ Comprobante cargado' : '✅ Proof uploaded',
        description: language === 'es'
          ? 'La imagen se ha cargado correctamente'
          : 'Image uploaded successfully'
      });
    } catch (error) {
      console.error('Error uploading payment proof:', error);
      toast({
        title: language === 'es' ? 'Error al cargar' : 'Upload error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setUploadingProof(false);
    }
  };

  // Pre-payment confirmation modal
  const handlePrePaymentConfirmation = async () => {
    if (!paymentProof) {
      toast({
        title: language === 'es' ? 'Comprobante requerido' : 'Proof required',
        description: language === 'es'
          ? 'Por favor sube el comprobante de pago'
          : 'Please upload payment proof',
        variant: 'destructive'
      });
      return;
    }

    const summaryText = language === 'es'
      ? `Destinatario: ${recipientDetails.fullName}\nTotal: ${currencySymbol}${convertedTotal?.toFixed(2) || totalAmount.toFixed(2)} ${currencyCode}\nProductos: ${cart.length} artículo(s)`
      : `Recipient: ${recipientDetails.fullName}\nTotal: ${currencySymbol}${convertedTotal?.toFixed(2) || totalAmount.toFixed(2)} ${currencyCode}\nProducts: ${cart.length} item(s)`;

    const confirmed = await showModal({
      type: 'confirm',
      title: language === 'es' ? '¿Confirmar pedido?' : 'Confirm order?',
      message: language === 'es'
        ? `¿Estás seguro de que deseas confirmar este pedido?\n\n${summaryText}\n\nUna vez confirmado, procesaremos tu pedido.`
        : `Are you sure you want to confirm this order?\n\n${summaryText}\n\nOnce confirmed, we will process your order.`,
      confirmText: language === 'es' ? 'Sí, confirmar' : 'Yes, confirm',
      cancelText: language === 'es' ? 'Cancelar' : 'Cancel'
    });

    if (confirmed) {
      handleConfirmPayment();
    }
  };

  const handleConfirmPayment = async () => {
    if (!paymentProof) {
      toast({
        title: language === 'es' ? 'Comprobante requerido' : 'Proof required',
        description: language === 'es'
          ? 'Por favor sube el comprobante de pago'
          : 'Please upload payment proof',
        variant: 'destructive'
      });
      return;
    }

    if (!user) {
      toast({
        title: language === 'es' ? 'Error de autenticación' : 'Authentication error',
        description: language === 'es'
          ? 'Por favor inicia sesión para continuar'
          : 'Please log in to continue',
        variant: 'destructive'
      });
      return;
    }

    setProcessingPayment(true);

    try {
      // Get currency object (selectedCurrency is already the UUID)
      const currency = currencies.find(c => c.id === selectedCurrency);
      if (!currency) {
        throw new Error('Currency not found');
      }

      // Get shipping zone ID
      const shippingZone = shippingZones.find(z => z.province_name === recipientDetails.province);

      // Get Zelle account: prioritize user selection, fallback to automatic assignment
      let selectedZelleAccountId = selectedZelle?.id || null;

      if (!selectedZelleAccountId) {
        // User didn't select a Zelle account, assign one automatically
        try {
          const zelleResult = await getAvailableZelleAccount('order', totalAmount);
          if (zelleResult.success && zelleResult.account) {
            selectedZelleAccountId = zelleResult.account.id;
            console.log('[CartPage] Auto-assigned Zelle account:', selectedZelleAccountId);
          } else {
            console.warn('[CartPage] No Zelle accounts available:', zelleResult.error);
          }
        } catch (zelleError) {
          console.error('[CartPage] Error getting Zelle account:', zelleError);
        }
      } else {
        console.log('[CartPage] Using user-selected Zelle account:', selectedZelleAccountId);
      }

      // Debug logs
      console.log('Creating order with:', {
        userId: user.id,
        currencyId: currency.id,
        shippingZoneId: shippingZone?.id,
        zelleAccountId: selectedZelleAccountId
      });

      // Prepare order items
      const orderItems = cart.map(item => ({
        itemType: item.type || 'product',
        itemId: item.id,
        nameEs: item.name_es || item.name,
        nameEn: item.name_en || item.name,
        quantity: item.quantity,
        unitPrice: getItemPrice(item),
        totalPrice: getItemPrice(item) * item.quantity,
        inventoryId: item.inventory_id || null
      }));

      // Prepare order data with discount applied
      const orderData = {
        userId: user.id,
        orderType: 'product',
        subtotal: parseFloat(subtotal.toFixed(2)),
        discountAmount: parseFloat(totalDiscountAmount.toFixed(2)),
        shippingCost: parseFloat(shippingCost.toFixed(2)),
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        currencyId: currency.id,
        recipientInfo: JSON.stringify(recipientDetails),
        paymentMethod: 'zelle',
        shippingZoneId: shippingZone?.id || null,
        zelleAccountId: selectedZelleAccountId,
        // Offer/coupon code - added from Phase 3.13
        offerId: appliedOffer?.id || null
      };

      // Create order (returns order object directly, throws on error)
      const createdOrder = await createOrder(orderData, orderItems);

      // Record offer usage if coupon was applied
      if (appliedOffer?.id) {
        try {
          await recordOfferUsage(appliedOffer.id, user.id, createdOrder.id);
        } catch (offerUsageErr) {
          console.warn('Error recording offer usage (non-blocking):', offerUsageErr?.message || offerUsageErr);
          // Don't fail the order if usage recording fails
        }
      }

      // Upload payment proof (throws on failure)
      let uploadedProofUrl = null;
      try {
        uploadedProofUrl = await uploadPaymentProof(paymentProof, createdOrder.id, user.id);
        await logActivity({
          action: 'payment_proof_uploaded',
          entityType: 'order',
          entityId: createdOrder.id,
          performedBy: user?.email || 'anonymous',
          description: `Payment proof uploaded for order ${createdOrder.order_number}`,
          metadata: {
            orderId: createdOrder.id,
            orderNumber: createdOrder.order_number,
            uploadUrl: uploadedProofUrl
          }
        });
      } catch (uploadErr) {
        console.error('Error uploading payment proof:', uploadErr);
        // Continue anyway - order is created
        await logActivity({
          action: 'payment_proof_upload_failed',
          entityType: 'order',
          entityId: createdOrder.id,
          performedBy: user?.email || 'anonymous',
          description: `Payment proof upload failed for order ${createdOrder.order_number}`,
          metadata: { error: uploadErr?.message || uploadErr }
        });
      }

      // IMPORTANT: Fetch FRESH notification settings from DB to avoid using stale cached values
      // This ensures notifications go to the currently configured phone/group, not old cached values
      let freshSettings;
      let notificationWhatsapp;
      try {
        freshSettings = await getFreshNotificationSettings();
        notificationWhatsapp = getActiveWhatsappRecipient(freshSettings);
        console.log('[CartPage] Using fresh notification settings:', {
          whatsapp: freshSettings?.whatsapp,
          whatsappTarget: freshSettings?.whatsappTarget,
          resolvedRecipient: notificationWhatsapp
        });
      } catch (settingsErr) {
        console.warn('[CartPage] Error fetching fresh settings, using cached:', settingsErr);
        freshSettings = notificationSettings;
        notificationWhatsapp = getActiveWhatsappRecipient(notificationSettings);
      }

      // Notify admin via WhatsApp using optimized function
      if (notificationWhatsapp) {
        // Prepare order data for notification
        const orderForNotification = {
          ...createdOrder,
          order_items: orderItems.map(item => ({
            item_name_es: language === 'es' ? item.name : item.nameEn || item.name,
            item_name_en: item.nameEn || item.name,
            quantity: item.quantity
          })),
          user_name: recipientDetails.fullName
        };

        // Use the optimized notification function with fresh recipient
        notifyAdminNewPayment(orderForNotification, notificationWhatsapp, language);
      }

      // Trigger server-side email/WhatsApp notification via Supabase Edge Function (if configured)
      try {
        if (freshSettings?.adminEmail || notificationWhatsapp) {
          await supabase.functions.invoke('notify-order', {
            body: {
              orderData: {
                orderNumber: createdOrder.order_number,
                customerName: recipientDetails.fullName,
                subtotal: subtotal.toFixed(2),
                discountAmount: totalDiscountAmount.toFixed(2),
                total: totalDisplay,  // Includes discount and shipping
                currency: selectedCurrency,
                couponCode: appliedOffer?.code || null,  // Include coupon if applied
                paymentProofUrl: uploadedProofUrl || createdOrder.payment_proof_url || null
              },
              notificationSettings: {
                ...freshSettings, // Use fresh settings, not cached
                whatsapp: notificationWhatsapp
              }
            }
          });
        }
      } catch (fnErr) {
        console.warn('notify-order function error (non-blocking):', fnErr?.message || fnErr);
      }

      // Log activity
      await logActivity({
        action: 'order_submitted',
        entityType: 'order',
        entityId: createdOrder.id,
        performedBy: user?.email || 'anonymous',
        description: `Order ${createdOrder.order_number} submitted from cart`,
        metadata: {
          total: totalAmount,
          subtotal,
          discount: totalDiscountAmount,
          shippingCost,
          paymentStatus: createdOrder.payment_status,
          offerId: appliedOffer?.id || null
        }
      });

      // Store order info and show confirmation modal
      setConfirmedOrderInfo({
        orderNumber: createdOrder.order_number,
        total: totalAmount,
        currency: currency.code || 'USD',
        recipientName: recipientDetails.fullName,
        itemCount: cart.length
      });
      setShowConfirmationModal(true);

    } catch (error) {
      console.error('Error confirming payment:', error);
      toast({
        title: language === 'es' ? 'Error al procesar' : 'Processing error',
        description: error.message || (language === 'es'
          ? 'No se pudo procesar tu pedido. Por favor intenta de nuevo.'
          : 'Could not process your order. Please try again.'),
        variant: 'destructive'
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  if (view === 'recipient') {
    return (
      <div className="container mx-auto max-w-4xl py-8 px-4">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Page Header */}
          <div className="glass-effect p-6 rounded-xl">
            <h1 className="text-3xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
              {language === 'es' ? 'Selecciona Destinatario y Método de Pago' : 'Select Recipient & Payment Method'}
            </h1>
            <p className="text-gray-600">
              {language === 'es'
                ? 'Elige un destinatario existente o crea uno nuevo, y selecciona tu cuenta Zelle para el pago.'
                : 'Choose an existing recipient or create a new one, and select your Zelle account for payment.'}
            </p>
          </div>

          {/* Zelle Account Selector - First */}
          <div className="glass-effect p-6 rounded-xl border-2 border-blue-200 bg-blue-50">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Copy className="h-5 w-5 text-blue-600" />
              {language === 'es' ? 'Selecciona Cuenta Zelle' : 'Select Zelle Account'}
            </h2>
            <ZelleAccountSelector
              usageType="products"
              onSelect={(account) => {
                setSelectedZelle(account);
              }}
            />
          </div>

          {/* Recipient Selector - Second */}
          <div className="glass-effect p-6 rounded-xl border-2 border-purple-200 bg-purple-50">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-purple-600" />
              {language === 'es' ? 'Destinatario de la Entrega' : 'Delivery Recipient'}
            </h2>
            <RecipientSelector
              ref={recipientSelectorRef}
              onSelect={(recipientData) => {
                setSelectedRecipientData(recipientData);
                if (recipientData.recipientData) {
                  // Existing recipient selected
                  setRecipientDetails({
                    fullName: recipientData.recipientData.full_name || '',
                    phone: recipientData.recipientData.phone || '',
                    province: recipientData.recipientData.addresses?.[0]?.province || '',
                    municipality: recipientData.recipientData.addresses?.[0]?.municipality || '',
                    address: recipientData.recipientData.addresses?.[0]?.address_line_1 || ''
                  });
                } else if (recipientData.formData) {
                  // New recipient created
                  setRecipientDetails({
                    fullName: recipientData.formData.full_name || '',
                    phone: recipientData.formData.phone || '',
                    province: recipientData.formData.province || '',
                    municipality: recipientData.formData.municipality || '',
                    address: recipientData.formData.address_line_1 || ''
                  });
                }
              }}
              shippingZones={shippingZones}
              municipalities={municipalities}
              showAddressSelection={true}
              showProvinceInForm={true}
            />
          </div>

          {/* Shipping Cost Summary */}
          {recipientDetails.province && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-effect p-6 rounded-xl border-2 border-green-200 bg-green-50"
            >
              <p className="text-sm font-medium text-gray-600 mb-2">
                {language === 'es' ? 'Costo de Envío' : 'Shipping Cost'}
              </p>
              <p className="text-2xl font-bold text-green-600">
                {shippingCost === 0
                  ? (language === 'es' ? '¡Envío Gratis!' : 'Free Shipping!')
                  : `$${shippingCost.toFixed(2)}`
                }
              </p>
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setView('cart')}
              className="flex-1 flex items-center justify-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {language === 'es' ? 'Atrás' : 'Back'}
            </Button>
            <Button
              onClick={handleRecipientSubmit}
              style={getPrimaryButtonStyle(visualSettings)}
              className="flex-1 flex items-center justify-center gap-2"
            >
              {language === 'es' ? 'Continuar al Pago' : 'Continue to Payment'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (view === 'payment') {
    return (
      <div className="container mx-auto max-w-2xl py-8 px-4">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl">
          <h1 className="text-3xl font-bold mb-6" style={getHeadingStyle(visualSettings)}>{t('cart.payment.title')}</h1>

          <div
            className="p-4 rounded-lg mb-6"
            style={getAlertStyle(visualSettings, 'info')}
          >
            <h2 className="font-semibold text-lg mb-2">{t('cart.payment.instructionsTitle')}</h2>
            <p className="text-sm">{t('cart.payment.instructions')}</p>
          </div>

          {selectedZelle ? (
            <div className="mb-6 glass-effect p-4 rounded-lg border-2 border-blue-200 bg-blue-50">
              <h3 className="font-semibold text-blue-900 mb-3">{t('cart.payment.accountInfo')}</h3>
              <div className="space-y-2 text-sm">
                <p><strong>{t('settings.zelle.name')}:</strong> {selectedZelle.account_name || selectedZelle.name}</p>
                <p><strong>Email:</strong> {selectedZelle.email || selectedZelle.zelle_email}</p>
                {(selectedZelle.phone_number || selectedZelle.phone || selectedZelle.telefono) && (
                  <p><strong>{t('common.phone')}:</strong> {selectedZelle.phone_number || selectedZelle.phone || selectedZelle.telefono}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-red-500 mb-6">{language === 'es' ? 'No hay cuenta Zelle disponible.' : 'No Zelle account available.'}</p>
          )}

          {/* Coupon Code Section */}
          <div className="mb-6 glass-effect p-4 rounded-lg border-2 border-yellow-200 bg-yellow-50">
            <h3 className="font-semibold text-yellow-900 mb-3">
              {language === 'es' ? 'Aplicar Cupón de Descuento' : 'Apply Coupon Code'}
            </h3>
            {!appliedOffer ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => {
                      setCouponCode(e.target.value.toUpperCase());
                      setCouponError('');
                    }}
                    placeholder={language === 'es' ? 'Ingresa código de cupón' : 'Enter coupon code'}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    disabled={validatingCoupon}
                  />
                  <Button
                    onClick={handleApplyCoupon}
                    disabled={!couponCode.trim() || validatingCoupon}
                    className="bg-yellow-600 text-white hover:bg-yellow-700"
                  >
                    {validatingCoupon ? (language === 'es' ? 'Validando...' : 'Validating...') : (language === 'es' ? 'Aplicar' : 'Apply')}
                  </Button>
                </div>
                {couponError && (
                  <p className="text-sm text-red-600 font-medium">{couponError}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border-l-4 border-green-500">
                  <span className="text-sm font-medium text-green-700">
                    ✅ {language === 'es' ? 'Cupón aplicado' : 'Coupon applied'}: <strong>{couponCode}</strong>
                  </span>
                  <Button
                    onClick={handleRemoveCoupon}
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                  >
                    {language === 'es' ? 'Remover' : 'Remove'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="mb-6 space-y-4">
            <div className="flex justify-between items-center">
              <p>{t('cart.payment.purchaseId')}: <strong className="font-mono">{purchaseId}</strong></p>
              <Button onClick={() => copyToClipboard(purchaseId)} variant="outline">
                <Copy className="mr-2 h-4 w-4" />{t('cart.payment.copy')}
              </Button>
            </div>

            {/* Price Breakdown */}
            <div className="space-y-2 p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>{language === 'es' ? 'Subtotal' : 'Subtotal'}:</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              {discountBreakdown.category.amount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>
                    {language === 'es' ? 'Descuento categoría' : 'Category discount'} ({userCategory} · {discountBreakdown.category.percent}%):
                  </span>
                  <span>-{currencySymbol}{discountBreakdown.category.amount.toFixed(2)}</span>
                </div>
              )}
              {discountBreakdown.offer.amount > 0 && appliedOffer && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>
                    {language === 'es' ? 'Descuento por oferta' : 'Offer discount'} ({appliedOffer.code} · {appliedOffer.discount_type === 'percentage'
                      ? `${appliedOffer.discount_value}%`
                      : `${currencySymbol}${appliedOffer.discount_value}`
                    }):
                  </span>
                  <span>-{currencySymbol}{discountBreakdown.offer.amount.toFixed(2)}</span>
                </div>
              )}
              {totalDiscountAmount > 0 && (
                <div className="flex justify-between text-sm border-t pt-2 font-semibold text-green-700">
                  <span>{language === 'es' ? 'Subtotal con descuentos' : 'Discounted subtotal'}:</span>
                  <span>${discountedSubtotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t pt-2">
                <span>{language === 'es' ? 'Envío' : 'Shipping'}:</span>
                <span>${shippingCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>{t('cart.payment.amount')}:</span>
                <span style={{ color: visualSettings.successColor || '#10b981' }}>${totalDisplay}</span>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => copyToClipboard(totalDisplay)} variant="outline" size="sm">
                <Copy className="mr-2 h-4 w-4" />{t('cart.payment.copy')}
              </Button>
            </div>
          </div>

          {/* File Upload with Preview Component */}
          <div className="mb-6">
            <FileUploadWithPreview
              label={t('cart.payment.uploadProof') || (language === 'es' ? 'Comprobante de Pago' : 'Payment Proof')}
              accept="image/*,.pdf"
              value={paymentProof}
              preview={paymentProofPreview}
              previewPosition="above"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                // Validate file type
                if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                  toast({
                    title: language === 'es' ? 'Tipo de archivo inválido' : 'Invalid file type',
                    description: language === 'es'
                      ? 'Solo se permiten imágenes JPG, PNG o WebP'
                      : 'Only JPG, PNG or WebP images are allowed',
                    variant: 'destructive'
                  });
                  return;
                }

                // Validate file size
                if (file.size > FILE_SIZE_LIMITS.PAYMENT_PROOF) {
                  toast({
                    title: language === 'es' ? 'Archivo muy grande' : 'File too large',
                    description: language === 'es'
                      ? 'El tamaño máximo es 5MB'
                      : 'Maximum size is 5MB',
                    variant: 'destructive'
                  });
                  return;
                }

                setUploadingProof(true);

                try {
                  // Generate preview
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    setPaymentProofPreview(reader.result);
                    setPaymentProof(file);
                    toast({
                      title: language === 'es' ? '✅ Comprobante cargado' : '✅ Proof uploaded',
                      description: language === 'es'
                        ? 'La imagen se ha cargado correctamente'
                        : 'Image uploaded successfully'
                    });
                  };
                  reader.readAsDataURL(file);
                } catch (error) {
                  console.error('Error uploading payment proof:', error);
                  toast({
                    title: language === 'es' ? 'Error al cargar' : 'Upload error',
                    description: error.message,
                    variant: 'destructive'
                  });
                } finally {
                  setUploadingProof(false);
                }
              }}
              required={true}
            />
          </div>

          {/* WhatsApp Contact Section */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          className={`mb-6 p-4 rounded-lg border-2 ${
              whatsappTarget
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <MessageCircle className={`h-5 w-5 flex-shrink-0 mt-1 ${
                whatsappTarget ? 'text-green-600' : 'text-yellow-600'
              }`} />
              <div className="flex-1">
                <p className={`text-sm font-medium mb-3 ${
                  whatsappTarget ? 'text-gray-700' : 'text-yellow-800'
                }`}>
                  {whatsappTarget
                    ? (language === 'es'
                        ? '¿Tienes dudas sobre el pago? Contáctanos por WhatsApp'
                        : 'Questions about payment? Contact us via WhatsApp')
                    : (language === 'es'
                        ? 'Número de WhatsApp de soporte no configurado'
                        : 'WhatsApp support number not configured')}
                </p>
                {whatsappTarget && (
                  <Button
                    onClick={handleContactSupport}
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    {language === 'es' ? 'Contactar por WhatsApp' : 'Contact via WhatsApp'}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setView('recipient')}
              className="flex-1"
              disabled={processingPayment}
            >
              {language === 'es' ? 'Atrás' : 'Back'}
            </Button>
            <Button
              onClick={handlePrePaymentConfirmation}
              className="flex-1"
              size="lg"
              style={getPrimaryButtonStyle(visualSettings)}
              disabled={!paymentProof || uploadingProof || processingPayment}
            >
              {processingPayment ? (
                language === 'es' ? 'Procesando...' : 'Processing...'
              ) : (
                t('cart.payment.confirm')
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      {/* Alert for Zelle account deactivation */}
      <ZelleAccountAlert
        operationType="order"
        onSelectNewAccount={() => setView('payment')}
      />

      <div className="container mx-auto">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>{t('cart.title')}</h1>
        </motion.div>
        {cart.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            <ShoppingCart className="w-24 h-24 text-gray-300 mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-gray-600 mb-4">{t('cart.empty')}</h2>
            <Button onClick={() => onNavigate('products')} style={getPrimaryButtonStyle(visualSettings)}>{t('cart.browse')}</Button>
          </motion.div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              {cart.map(item => {
                const itemPrice = getItemPrice(item);
                const itemTotal = itemPrice * item.quantity;
                const displayName = language === 'es'
                  ? (item.name_es || item.name || 'Producto')
                  : (item.name_en || item.name || 'Product');
                const displayImage = item.image_url || item.image;
                const isCombo = !!item.products;

                // Calculate converted prices for display
                const exchangeRate = currencyCode === 'USD' ? 1 : (convertedSubtotal !== null ? convertedSubtotal / subtotal : 1);
                const convertedItemPrice = itemPrice * exchangeRate;
                const convertedItemTotal = itemTotal * exchangeRate;

                return (
                  <motion.div key={item.id} layout className="glass-effect p-4 rounded-2xl">
                    <div className="flex items-start gap-4">
                      {/* Product Image */}
                      <div className="w-24 h-24 rounded-lg flex-shrink-0 bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
                        {displayImage ? (
                          <img
                            className="w-full h-full object-cover"
                            alt={displayName}
                            src={displayImage}
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <div className={`w-full h-full flex items-center justify-center ${displayImage ? 'hidden' : ''}`}>
                          <Package className="w-10 h-10 text-gray-300" />
                        </div>
                      </div>

                      {/* Product Info */}
                      <div className="flex-grow min-w-0">
                        <h3 className="font-semibold text-gray-800 mb-1">
                          {displayName}
                          {isCombo && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">COMBO</span>}
                        </h3>
                        <p className="text-sm text-gray-500 mb-2">
                          {language === 'es' ? 'Precio unitario: ' : 'Unit price: '}
                          <span className="font-semibold" style={{ color: visualSettings.accentColor || '#9333ea' }}>
                            {currencySymbol}{convertedItemPrice.toFixed(2)} {currencyCode}
                          </span>
                        </p>
                        <p className="text-base font-bold text-gray-900">
                          {language === 'es' ? 'Subtotal: ' : 'Subtotal: '}{currencySymbol}{convertedItemTotal.toFixed(2)} {currencyCode}
                        </p>
                      </div>

                      {/* Quantity Controls */}
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                          className="h-8 w-8"
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center font-semibold">{item.quantity}</span>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                          className="h-8 w-8"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Remove Button */}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeFromCart(item.id)}
                        className="flex-shrink-0"
                      >
                        <X className="h-5 w-5 text-red-500" />
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
            <div className="lg:col-span-1">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-6 rounded-2xl space-y-6">
                <h2 className="text-2xl font-semibold">{t('cart.summary')}</h2>

                {totalDiscountAmount > 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                    <Tag className="h-5 w-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-green-700">
                        {language === 'es' ? 'Descuento activo' : 'Active discount'} · {discountBreakdown.total.percent.toFixed(2)}%
                      </p>
                      {discountBreakdown.category.amount > 0 && (
                        <p className="text-xs text-green-800">
                          {language === 'es' ? 'Categoría' : 'Category'}: {userCategory} ({discountBreakdown.category.percent}% · -{currencySymbol}{discountBreakdown.category.amount.toFixed(2)})
                        </p>
                      )}
                      {discountBreakdown.offer.amount > 0 && appliedOffer && (
                        <p className="text-xs text-green-800">
                          {language === 'es' ? 'Oferta' : 'Offer'}: {appliedOffer.code} ({appliedOffer.discount_type === 'percentage' ? `${appliedOffer.discount_value}%` : `${currencySymbol}${appliedOffer.discount_value}`} · -{currencySymbol}{discountBreakdown.offer.amount.toFixed(2)})
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Selector de moneda */}
                <CurrencySelector
                  selectedCurrency={selectedCurrency}
                  onCurrencyChange={setSelectedCurrency}
                  label={language === 'es' ? 'Moneda' : 'Currency'}
                  showSymbol
                  className="input-style w-full"
                />

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>{t('cart.subtotal')}</span>
                    <span className="font-semibold">
                      {currencySymbol}
                      {displayValues.subtotal.toFixed(2)} {currencyCode}
                    </span>
                  </div>
                  {discountBreakdown.category.amount > 0 && (
                    <div className="flex justify-between text-sm text-green-700">
                      <span>{language === 'es' ? 'Descuento categoría' : 'Category discount'} ({discountBreakdown.category.percent}%):</span>
                      <span>-{currencySymbol}{displayValues.categoryDiscount.toFixed(2)} {currencyCode}</span>
                    </div>
                  )}
                  {discountBreakdown.offer.amount > 0 && appliedOffer && (
                    <div className="flex justify-between text-sm text-green-700">
                      <span>{language === 'es' ? 'Descuento por oferta' : 'Offer discount'} ({discountBreakdown.offer.percent}%):</span>
                      <span>-{currencySymbol}{displayValues.offerDiscount.toFixed(2)} {currencyCode}</span>
                    </div>
                  )}
                  {totalDiscountAmount > 0 && (
                    <div className="flex justify-between text-sm font-semibold text-green-800 border-t pt-2">
                      <span>{language === 'es' ? 'Subtotal con descuentos' : 'Discounted subtotal'}</span>
                      <span>
                        {currencySymbol}
                        {displayValues.discountedSubtotal.toFixed(2)} {currencyCode}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>{t('cart.shipping')}</span>
                    <span className="text-sm font-semibold">
                      {displayValues.shipping === 0
                        ? (language === 'es' ? 'Gratis' : 'Free')
                        : `${currencySymbol}${displayValues.shipping.toFixed(2)} ${currencyCode}`
                      }
                    </span>
                  </div>
                  <div className="border-t my-2"></div>
                  <div className="flex justify-between text-xl font-bold">
                    <span>{t('cart.total')}</span>
                    <span style={{ color: visualSettings.primaryColor || '#2563eb' }}>
                      {currencySymbol}
                      {displayValues.total.toFixed(2)} {currencyCode}
                    </span>
                  </div>
                </div>

                <Button onClick={handleCheckout} className="w-full" size="lg" style={getPrimaryButtonStyle(visualSettings)}>
                  {t('cart.checkout')}
                </Button>
              </motion.div>
            </div>
          </div>
        )}
      </div>

      {/* Order Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        onClose={() => {
          setShowConfirmationModal(false);
          clearCart();
          onNavigate('user-panel');
        }}
        onViewOrders={() => {
          setShowConfirmationModal(false);
          clearCart();
          onNavigate('user-panel');
        }}
        orderNumber={confirmedOrderInfo?.orderNumber}
        orderType="order"
        total={confirmedOrderInfo?.total}
        currency={confirmedOrderInfo?.currency}
        recipientName={confirmedOrderInfo?.recipientName}
        itemCount={confirmedOrderInfo?.itemCount}
        estimatedDelivery={language === 'es' ? '24-72 horas' : '24-72 hours'}
      />
    </div>
  );
};

export default CartPage;
