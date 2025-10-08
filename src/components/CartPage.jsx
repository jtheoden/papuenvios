import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, X, Plus, Minus, Copy, Upload, CheckCircle, MessageCircle } from 'lucide-react';
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
import { generateWhatsAppURL, notifyAdminNewPayment } from '@/lib/whatsappService';
import { createOrder, uploadPaymentProof } from '@/lib/orderService';

const CartPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { cart, updateCartQuantity, removeFromCart, clearCart, financialSettings, zelleAccounts, visualSettings, businessInfo } = useBusiness();
  const { isAuthenticated, user } = useAuth();
  const [view, setView] = useState('cart'); // cart, recipient, payment
  const [recipientDetails, setRecipientDetails] = useState({
    fullName: '',
    phone: '',
    province: '',
    municipality: '',
    address: ''
  });
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

  // Calculate item price based on type (product or combo)
  const getItemPrice = (item) => {
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
  };

  // Calculate subtotal
  const subtotal = cart.reduce((acc, item) => {
    return acc + getItemPrice(item) * item.quantity;
  }, 0);

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
      if (result.success) {
        // Filter out zones with zero cost (no shipping available)
        const availableZones = result.zones.filter(zone =>
          zone.free_shipping || parseFloat(zone.shipping_cost) > 0
        );
        setShippingZones(availableZones);
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
    setView('payment');
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${text} ${t('cart.payment.copy')}!` });
  };

  const handlePaymentProofUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: language === 'es' ? 'Tipo de archivo inválido' : 'Invalid file type',
        description: language === 'es'
          ? 'Solo se permiten imágenes JPG, PNG o WebP'
          : 'Only JPG, PNG or WebP images are allowed',
        variant: 'destructive'
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
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
        zelleAccountId: zelleAccounts?.[0]?.id || null
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

      // Notify admins via WhatsApp (open in new window)
      if (businessInfo?.whatsapp) {
        const whatsappUrl = notifyAdminNewPayment(
          {
            ...createdOrder,
            currency: currency,
            user_profile: {
              full_name: recipientDetails.fullName,
              email: user.email
            },
            shipping_zone: shippingZone,
            payment_proof_url: uploadResult.url
          },
          language
        );

        // Open WhatsApp notification (optional - admin will get notified)
        // window.open(whatsappUrl, '_blank');
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
      <div className="container mx-auto max-w-2xl py-8 px-4">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl">
          <h1 className="text-3xl font-bold mb-6" style={getHeadingStyle(visualSettings)}>
            {language === 'es' ? 'Datos de Entrega' : 'Delivery Information'}
          </h1>

          <div className="space-y-4">
            {/* Nombre completo */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Nombre completo' : 'Full name'} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder={language === 'es' ? 'Ingrese el nombre completo del destinatario' : 'Enter recipient full name'}
                value={recipientDetails.fullName}
                onChange={e => setRecipientDetails({...recipientDetails, fullName: e.target.value})}
                className="input-style w-full"
                required
              />
            </div>

            {/* Teléfono */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Teléfono' : 'Phone'} <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                placeholder={language === 'es' ? 'Ej: +53 5 234 5678' : 'Ex: +53 5 234 5678'}
                value={recipientDetails.phone}
                onChange={e => setRecipientDetails({...recipientDetails, phone: e.target.value})}
                className="input-style w-full"
                required
              />
            </div>

            {/* Provincia */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Provincia' : 'Province'} <span className="text-red-500">*</span>
              </label>
              <select
                value={recipientDetails.province}
                onChange={e => setRecipientDetails({...recipientDetails, province: e.target.value})}
                className="input-style w-full"
                required
              >
                <option value="">
                  {language === 'es' ? 'Seleccione una provincia' : 'Select a province'}
                </option>
                {shippingZones.map(zone => (
                  <option key={zone.id} value={zone.province_name}>
                    {zone.province_name}
                    {zone.free_shipping
                      ? ` - ${language === 'es' ? 'Envío Gratis' : 'Free Shipping'}`
                      : ` - $${parseFloat(zone.shipping_cost).toFixed(2)}`
                    }
                  </option>
                ))}
              </select>
            </div>

            {/* Municipio */}
            {recipientDetails.province && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  {language === 'es' ? 'Municipio' : 'Municipality'} <span className="text-red-500">*</span>
                </label>
                <select
                  value={recipientDetails.municipality}
                  onChange={e => setRecipientDetails({...recipientDetails, municipality: e.target.value})}
                  className="input-style w-full"
                  required
                >
                  <option value="">
                    {language === 'es' ? 'Seleccione un municipio' : 'Select a municipality'}
                  </option>
                  {municipalities.map(mun => (
                    <option key={mun} value={mun}>
                      {mun}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Dirección */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Dirección completa' : 'Full address'} <span className="text-red-500">*</span>
              </label>
              <textarea
                placeholder={language === 'es' ? 'Calle, número, entre calles, edificio, apartamento, etc.' : 'Street, number, between streets, building, apartment, etc.'}
                value={recipientDetails.address}
                onChange={e => setRecipientDetails({...recipientDetails, address: e.target.value})}
                className="input-style w-full min-h-[100px]"
                required
              />
            </div>

            {/* Resumen de envío */}
            {recipientDetails.province && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium mb-1">
                  {language === 'es' ? 'Costo de envío' : 'Shipping cost'}
                </p>
                <p className="text-lg font-bold" style={{ color: visualSettings.primaryColor }}>
                  {shippingCost === 0
                    ? (language === 'es' ? '¡Envío Gratis!' : 'Free Shipping!')
                    : `$${shippingCost.toFixed(2)}`
                  }
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setView('cart')} className="flex-1">
              {language === 'es' ? 'Atrás' : 'Back'}
            </Button>
            <Button
              onClick={handleRecipientSubmit}
              style={getPrimaryButtonStyle(visualSettings)}
              className="flex-1"
              disabled={!recipientDetails.fullName || !recipientDetails.phone || !recipientDetails.province || !recipientDetails.municipality || !recipientDetails.address}
            >
              {language === 'es' ? 'Continuar al Pago' : 'Continue to Payment'}
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

          {activeZelleAccount ? (
            <div className="mb-6 space-y-2">
              <h3 className="font-semibold">{t('cart.payment.accountInfo')}</h3>
              <p><strong>Email:</strong> {activeZelleAccount.email}</p>
              <p><strong>{t('settings.zelle.name')}:</strong> {activeZelleAccount.name}</p>
            </div>
          ) : (
            <p className="text-red-500">No Zelle account available.</p>
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

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">
              {t('cart.payment.uploadProof')} <span className="text-red-500">*</span>
            </label>

            {!paymentProofPreview ? (
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/jpg,image/webp"
                  onChange={handlePaymentProofUpload}
                  className="hidden"
                  disabled={uploadingProof}
                />
                <div
                  className="flex justify-center px-6 py-8 border-2 border-dashed rounded-lg hover:border-gray-400 transition-colors"
                  style={{ borderColor: visualSettings.borderColor || '#d1d5db' }}
                >
                  <div className="space-y-2 text-center">
                    <Upload
                      className="mx-auto h-12 w-12"
                      style={{ color: uploadingProof ? visualSettings.primaryColor : '#9ca3af' }}
                    />
                    <div className="text-sm">
                      {uploadingProof ? (
                        <p className="font-medium" style={{ color: visualSettings.primaryColor }}>
                          {language === 'es' ? 'Procesando imagen...' : 'Processing image...'}
                        </p>
                      ) : (
                        <>
                          <p className="font-medium" style={{ color: visualSettings.primaryColor }}>
                            {language === 'es' ? 'Haz clic para subir' : 'Click to upload'}
                          </p>
                          <p className="text-gray-500">
                            {language === 'es' ? 'JPG, PNG o WebP (máx. 5MB)' : 'JPG, PNG or WebP (max 5MB)'}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </label>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden border-2" style={{ borderColor: visualSettings.successColor || '#10b981' }}>
                  <img
                    src={paymentProofPreview}
                    alt="Payment proof"
                    className="w-full h-64 object-contain bg-gray-50"
                  />
                  <div
                    className="absolute top-2 right-2 p-2 rounded-full"
                    style={{ backgroundColor: visualSettings.successColor || '#10b981' }}
                  >
                    <CheckCircle className="h-5 w-5 text-white" />
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPaymentProof(null);
                    setPaymentProofPreview(null);
                  }}
                  className="w-full"
                >
                  <X className="mr-2 h-4 w-4" />
                  {language === 'es' ? 'Cambiar imagen' : 'Change image'}
                </Button>
              </div>
            )}
          </div>

          {/* WhatsApp Contact Button */}
          {businessInfo?.whatsapp && (
            <div className="mb-6">
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-sm text-gray-700 mb-3">
                  {language === 'es'
                    ? '¿Tienes dudas sobre el pago? Contáctanos por WhatsApp'
                    : 'Questions about payment? Contact us via WhatsApp'}
                </p>
                <Button
                  variant="outline"
                  className="w-full border-green-600 text-green-600 hover:bg-green-50"
                  onClick={() => {
                    const message = language === 'es'
                      ? `Hola! Tengo una consulta sobre mi pago. Total: ${currencies.find(c => c.code === selectedCurrency)?.symbol || '$'}${convertedTotal !== null ? convertedTotal.toFixed(2) : (subtotal + shippingCost).toFixed(2)} ${selectedCurrency}`
                      : `Hello! I have a question about my payment. Total: ${currencies.find(c => c.code === selectedCurrency)?.symbol || '$'}${convertedTotal !== null ? convertedTotal.toFixed(2) : (subtotal + shippingCost).toFixed(2)} ${selectedCurrency}`;
                    window.open(generateWhatsAppURL(businessInfo.whatsapp, message), '_blank');
                  }}
                >
                  <MessageCircle className="mr-2 h-5 w-5" />
                  {language === 'es' ? 'Contactar por WhatsApp' : 'Contact via WhatsApp'}
                </Button>
              </div>
            </div>
          )}

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
                            ${itemPrice.toFixed(2)}
                          </span>
                        </p>
                        <p className="text-base font-bold text-gray-900">
                          {language === 'es' ? 'Subtotal: ' : 'Subtotal: '}${itemTotal.toFixed(2)}
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