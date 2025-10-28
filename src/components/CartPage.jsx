import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, X, Plus, Minus, Copy, Upload, CheckCircle, MessageCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle, getAlertStyle } from '@/lib/styleUtils';
import { processImage } from '@/lib/imageUtils';
import { getActiveShippingZones, calculateShippingCost } from '@/lib/shippingService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import { getCurrencies, convertCurrency } from '@/lib/currencyService';
import { generateWhatsAppURL, notifyAdminNewPayment, openWhatsAppChat } from '@/lib/whatsappService';
import { createOrder, uploadPaymentProof } from '@/lib/orderService';
import { FILE_SIZE_LIMITS, ALLOWED_IMAGE_TYPES } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import RecipientSelector from '@/components/RecipientSelector';
import ZelleAccountSelector from '@/components/ZelleAccountSelector';
import FileUploadWithPreview from '@/components/FileUploadWithPreview';

const CartPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { cart, updateCartQuantity, removeFromCart, clearCart, financialSettings, zelleAccounts, visualSettings, businessInfo, notificationSettings } = useBusiness();
  const { isAuthenticated, user } = useAuth();

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
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [currencies, setCurrencies] = useState([]);
  const [convertedSubtotal, setConvertedSubtotal] = useState(null);
  const [convertedShipping, setConvertedShipping] = useState(null);
  const [convertedTotal, setConvertedTotal] = useState(null);

  // Calculate item price based on type (product or combo) - memoized with useCallback
  const getItemPrice = useCallback((item) => {
    // Use displayed price if available (price shown when added to cart)
    if (item.displayed_price && item.displayed_currency_code) {
      // If displayed currency matches selected currency, use as-is
      if (item.displayed_currency_code === selectedCurrency) {
        return parseFloat(item.displayed_price);
      }
      // Otherwise need conversion - for now return displayed price
      // TODO: Implement cross-currency conversion in cart
      return parseFloat(item.displayed_price);
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
  }, [selectedCurrency, financialSettings.comboProfit, financialSettings.productProfit]);

  // Calculate subtotal - memoized to avoid recalculation on every render
  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      return acc + getItemPrice(item) * item.quantity;
    }, 0);
  }, [cart, getItemPrice]);

  // Load shipping zones and currencies
  useEffect(() => {
    loadShippingZones();
    loadCurrencies();
  }, []);

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

  // Calculate shipping when province changes or cart changes
  useEffect(() => {
    if (recipientDetails.province) {
      updateShippingCost(recipientDetails.province);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientDetails.province, subtotal]);

  // Convert amounts when currency or totals change
  useEffect(() => {
    convertAmounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCurrency, subtotal, shippingCost]);

  const loadShippingZones = async () => {
    try {
      const result = await getActiveShippingZones();
      console.log('Shipping zones loaded:', result);
      if (result.success) {
        // Filter zones: exclude zones with shipping_cost = 0 UNLESS they are marked as free_shipping
        const availableZones = (result.zones || []).filter(zone => {
          const cost = parseFloat(zone.shipping_cost || 0);
          // Show if: free_shipping is true OR shipping_cost > 0
          return zone.free_shipping === true || cost > 0;
        });
        setShippingZones(availableZones);
        console.log('Zones set:', availableZones.length);
      }
    } catch (error) {
      console.error('Error loading shipping zones:', error);
    }
  };

  const loadCurrencies = async () => {
    try {
      const { data, error } = await getCurrencies();
      if (!error && data) {
        setCurrencies(data);
      }
    } catch (error) {
      console.error('Error loading currencies:', error);
    }
  };

  const convertAmounts = async () => {
    // If selected currency is USD (base currency), no conversion needed
    if (selectedCurrency === 'USD') {
      setConvertedSubtotal(subtotal);
      setConvertedShipping(shippingCost);
      setConvertedTotal(subtotal + shippingCost);
      return;
    }

    try {
      // Convert subtotal
      const { data: convertedSub, error: subError } = await convertCurrency(
        subtotal,
        'USD',
        selectedCurrency
      );

      // Convert shipping cost
      const { data: convertedShip, error: shipError } = await convertCurrency(
        shippingCost,
        'USD',
        selectedCurrency
      );

      if (!subError && !shipError) {
        setConvertedSubtotal(convertedSub);
        setConvertedShipping(convertedShip);
        setConvertedTotal(convertedSub + convertedShip);
      } else {
        // If conversion fails, fallback to original values
        setConvertedSubtotal(subtotal);
        setConvertedShipping(shippingCost);
        setConvertedTotal(subtotal + shippingCost);
      }
    } catch (error) {
      console.error('Error converting currency:', error);
      // Fallback to original values
      setConvertedSubtotal(subtotal);
      setConvertedShipping(shippingCost);
      setConvertedTotal(subtotal + shippingCost);
    }
  };

  const updateShippingCost = async (provinceName) => {
    try {
      const result = await calculateShippingCost(provinceName, subtotal);
      if (result.success) {
        setShippingCost(result.cost);
      }
    } catch (error) {
      console.error('Error calculating shipping:', error);
      setShippingCost(0);
    }
  };

  const total = (subtotal + shippingCost).toFixed(2);
  const purchaseId = `PO-${Date.now()}`;

  const activeZelleAccount = zelleAccounts.find(acc => acc.forProducts && acc.active);

  const handleCheckout = () => {
    if (!isAuthenticated) {
      toast({ title: t('auth.loginRequired'), description: t('auth.loginToCheckout'), variant: 'destructive' });
      return;
    }
    setView('recipient');
  };

  const handleRecipientSubmit = () => {
    if (!selectedRecipientData) {
      toast({
        title: t('common.error'),
        description: language === 'es' ? 'Selecciona un destinatario' : 'Select a recipient',
        variant: 'destructive'
      });
      return;
    }

    if (!selectedZelle) {
      toast({
        title: t('common.error'),
        description: language === 'es' ? 'Selecciona una cuenta Zelle' : 'Select a Zelle account',
        variant: 'destructive'
      });
      return;
    }

    setView('payment');
  };

  const handleContactSupport = () => {
    if (!notificationSettings?.whatsapp) {
      toast({
        title: t('common.error'),
        description: language === 'es'
          ? 'Número de WhatsApp no configurado'
          : 'WhatsApp number not configured',
        variant: 'destructive'
      });
      return;
    }

    const message = language === 'es'
      ? `Hola! Tengo una pregunta sobre mi pedido.\n\nNúmero de pedido: ${purchaseId}`
      : `Hello! I have a question about my order.\n\nOrder number: ${purchaseId}`;

    openWhatsAppChat(notificationSettings.whatsapp, message);
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
      // Get currency ID
      const currency = currencies.find(c => c.code === selectedCurrency);
      if (!currency) {
        throw new Error('Currency not found');
      }

      // Get shipping zone ID
      const shippingZone = shippingZones.find(z => z.province_name === recipientDetails.province);

      // Debug logs
      console.log('Creating order with:', {
        userId: user.id,
        currencyId: currency.id,
        shippingZoneId: shippingZone?.id,
        zelleAccountId: zelleAccounts?.[0]?.id
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

      // Prepare order data
      const orderData = {
        userId: user.id,
        orderType: 'product',
        subtotal: subtotal,
        shippingCost: shippingCost,
        totalAmount: subtotal + shippingCost,
        currencyId: currency.id,
        recipientInfo: JSON.stringify(recipientDetails),
        paymentMethod: 'zelle',
        shippingZoneId: shippingZone?.id || null,
        // TODO: Fix zelle_accounts table to use UUID instead of integer IDs
        zelleAccountId: null
      };

      // Create order
      const orderResult = await createOrder(orderData, orderItems);

      if (!orderResult.success) {
        throw new Error(orderResult.error || 'Error creating order');
      }

      const createdOrder = orderResult.order;

      // Upload payment proof
      const uploadResult = await uploadPaymentProof(paymentProof, createdOrder.id);

      if (!uploadResult.success) {
        console.error('Error uploading payment proof:', uploadResult.error);
        // Continue anyway - order is created
      }

      // Notify admin via WhatsApp using optimized function
      if (notificationSettings?.whatsapp) {
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

        // Use the optimized notification function
        notifyAdminNewPayment(orderForNotification, notificationSettings.whatsapp, language);
      }

      // Trigger server-side email/WhatsApp notification via Supabase Edge Function (if configured)
      try {
        if (notificationSettings?.adminEmail || notificationSettings?.whatsapp) {
          await supabase.functions.invoke('notify-order', {
            body: {
              orderData: {
                orderNumber: createdOrder.order_number,
                customerName: recipientDetails.fullName,
                total: (subtotal + shippingCost).toFixed(2),
                currency: selectedCurrency,
                paymentProofUrl: uploadResult?.url || createdOrder.payment_proof_url || null
              },
              notificationSettings
            }
          });
        }
      } catch (fnErr) {
        console.warn('notify-order function error (non-blocking):', fnErr?.message || fnErr);
      }

      // Success
      toast({
        title: language === 'es' ? '✅ Pedido confirmado' : '✅ Order confirmed',
        description: language === 'es'
          ? `Tu pedido ${createdOrder.order_number} ha sido creado. Recibirás una notificación cuando sea validado.`
          : `Your order ${createdOrder.order_number} has been created. You'll receive a notification when it's validated.`
      });

      // Clear cart and navigate
      clearCart();
      onNavigate('user-panel');

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

          <div className="mb-6 space-y-4">
            <div className="flex justify-between items-center">
              <p>{t('cart.payment.purchaseId')}: <strong className="font-mono">{purchaseId}</strong></p>
              <Button onClick={() => copyToClipboard(purchaseId)} variant="outline">
                <Copy className="mr-2 h-4 w-4" />{t('cart.payment.copy')}
              </Button>
            </div>
            <div className="flex justify-between items-center">
              <p>{t('cart.payment.amount')}: <strong className="text-2xl" style={{ color: visualSettings.successColor || '#10b981' }}>${total}</strong></p>
              <Button onClick={() => copyToClipboard(total)} variant="outline">
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
              notificationSettings?.whatsapp
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <MessageCircle className={`h-5 w-5 flex-shrink-0 mt-1 ${
                notificationSettings?.whatsapp ? 'text-green-600' : 'text-yellow-600'
              }`} />
              <div className="flex-1">
                <p className={`text-sm font-medium mb-3 ${
                  notificationSettings?.whatsapp ? 'text-gray-700' : 'text-yellow-800'
                }`}>
                  {notificationSettings?.whatsapp
                    ? (language === 'es'
                        ? '¿Tienes dudas sobre el pago? Contáctanos por WhatsApp'
                        : 'Questions about payment? Contact us via WhatsApp')
                    : (language === 'es'
                        ? 'Número de WhatsApp de soporte no configurado'
                        : 'WhatsApp support number not configured')}
                </p>
                {notificationSettings?.whatsapp && (
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
              onClick={handleConfirmPayment}
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
                const displayImage = item.image_url || item.image || "https://images.unsplash.com/photo-1635865165118-917ed9e20936";
                const isCombo = !!item.products;

                // Calculate converted prices for display
                const exchangeRate = selectedCurrency === 'USD' ? 1 : (convertedSubtotal !== null ? convertedSubtotal / subtotal : 1);
                const convertedItemPrice = itemPrice * exchangeRate;
                const convertedItemTotal = itemTotal * exchangeRate;
                const currencySymbol = currencies.find(c => c.code === selectedCurrency)?.symbol || '$';

                return (
                  <motion.div key={item.id} layout className="glass-effect p-4 rounded-2xl">
                    <div className="flex items-start gap-4">
                      {/* Product Image */}
                      <img
                        className="w-24 h-24 rounded-lg object-cover flex-shrink-0"
                        alt={displayName}
                        src={displayImage}
                      />

                      {/* Product Info */}
                      <div className="flex-grow min-w-0">
                        <h3 className="font-semibold text-gray-800 mb-1">
                          {displayName}
                          {isCombo && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">COMBO</span>}
                        </h3>
                        <p className="text-sm text-gray-500 mb-2">
                          {language === 'es' ? 'Precio unitario: ' : 'Unit price: '}
                          <span className="font-semibold" style={{ color: visualSettings.accentColor || '#9333ea' }}>
                            {currencySymbol}{convertedItemPrice.toFixed(2)} {selectedCurrency}
                          </span>
                        </p>
                        <p className="text-base font-bold text-gray-900">
                          {language === 'es' ? 'Subtotal: ' : 'Subtotal: '}{currencySymbol}{convertedItemTotal.toFixed(2)} {selectedCurrency}
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

                {/* Selector de moneda */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {language === 'es' ? 'Moneda' : 'Currency'}
                  </label>
                  <select
                    value={selectedCurrency}
                    onChange={e => setSelectedCurrency(e.target.value)}
                    className="input-style w-full"
                  >
                    {currencies.length > 0 ? (
                      currencies.map(curr => (
                        <option key={curr.code} value={curr.code}>
                          {curr.code} - {language === 'es' ? curr.name_es : curr.name_en}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="USD">USD - Dólar Estadounidense</option>
                        <option value="EUR">EUR - Euro</option>
                        <option value="CUP">CUP - Peso Cubano</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>{t('cart.subtotal')}</span>
                    <span className="font-semibold">
                      {currencies.find(c => c.code === selectedCurrency)?.symbol || '$'}
                      {convertedSubtotal !== null ? convertedSubtotal.toFixed(2) : subtotal.toFixed(2)} {selectedCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('cart.shipping')}</span>
                    <span className="text-sm font-semibold">
                      {(convertedShipping !== null ? convertedShipping : shippingCost) === 0
                        ? (language === 'es' ? 'Gratis' : 'Free')
                        : `${currencies.find(c => c.code === selectedCurrency)?.symbol || '$'}${(convertedShipping !== null ? convertedShipping : shippingCost).toFixed(2)} ${selectedCurrency}`
                      }
                    </span>
                  </div>
                  <div className="border-t my-2"></div>
                  <div className="flex justify-between text-xl font-bold">
                    <span>{t('cart.total')}</span>
                    <span style={{ color: visualSettings.primaryColor || '#2563eb' }}>
                      {currencies.find(c => c.code === selectedCurrency)?.symbol || '$'}
                      {convertedTotal !== null ? convertedTotal.toFixed(2) : (subtotal + shippingCost).toFixed(2)} {selectedCurrency}
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
    </div>
  );
};

export default CartPage;