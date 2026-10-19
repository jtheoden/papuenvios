/**
 * ConfirmationModal Component
 * Modal overlay for order/remittance confirmation after successful payment
 * Shows order number, summary, and next steps
 */

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Package, Clock, MessageCircle, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';

const ConfirmationModal = ({
  isOpen,
  onClose,
  onViewOrders,
  orderNumber,
  orderType = 'order', // 'order' | 'remittance'
  total,
  currency = 'USD',
  recipientName,
  itemCount,
  estimatedDelivery = '24-72 horas',
  whatsappUrl = '',
  whatsappNumber = '',
  whatsappLoading = false,
  proofPending = false, // remittance registered but payment proof not uploaded yet
  variant = 'confirmation' // 'confirmation' | 'resend' (re-notify the admin for an existing operation)
}) => {
  const { language } = useLanguage();
  const { visualSettings } = useBusiness();

  const isRemittance = orderType === 'remittance';
  const isProofPending = isRemittance && Boolean(proofPending);

  const texts = {
    es: {
      title: isRemittance ? '¡Remesa Enviada!' : '¡Pedido Confirmado!',
      subtitle: isRemittance
        ? 'Tu remesa ha sido registrada exitosamente'
        : 'Tu pedido ha sido registrado exitosamente',
      orderLabel: isRemittance ? 'Número de Remesa' : 'Número de Pedido',
      recipientLabel: 'Destinatario',
      totalLabel: isRemittance ? 'Monto Enviado' : 'Total del Pedido',
      itemsLabel: isRemittance ? 'Tipo de envío' : 'Productos',
      itemsValue: isRemittance ? 'Transferencia' : `${itemCount} artículo${itemCount !== 1 ? 's' : ''}`,
      nextStepsTitle: '¿Qué sigue?',
      stepWhatsapp: 'Opcional: envíanos el comprobante por WhatsApp con el botón de abajo para acelerar la verificación',
      step1: 'Verificaremos tu comprobante de pago',
      step2: isRemittance
        ? 'Procesaremos tu remesa en las próximas horas'
        : 'Prepararemos tu pedido para envío',
      step3: 'Te notificaremos cuando esté en camino',
      estimatedLabel: 'Tiempo estimado de entrega',
      viewOrdersBtn: isRemittance ? 'Ver Mis Remesas' : 'Ver Mis Pedidos',
      closeBtn: 'Cerrar',
      whatsappHint: '¿Tienes preguntas? Contáctanos por WhatsApp',
      whatsappSendBtn: 'Enviar comprobante por WhatsApp',
      whatsappChatWith: `Se abrirá un chat con ${whatsappNumber}`,
      whatsappPreparing: 'Preparando mensaje de WhatsApp…',
      whatsappNotConfigured: 'WhatsApp del administrador no configurado. Contacta al soporte.',
      whatsappOptionalNote: isRemittance
        ? 'Tu remesa ya quedó registrada. El aviso por WhatsApp es opcional.'
        : 'Tu pedido ya quedó registrado. El aviso por WhatsApp es opcional.'
    },
    en: {
      title: isRemittance ? 'Remittance Sent!' : 'Order Confirmed!',
      subtitle: isRemittance
        ? 'Your remittance has been registered successfully'
        : 'Your order has been registered successfully',
      orderLabel: isRemittance ? 'Remittance Number' : 'Order Number',
      recipientLabel: 'Recipient',
      totalLabel: isRemittance ? 'Amount Sent' : 'Order Total',
      itemsLabel: isRemittance ? 'Transfer type' : 'Products',
      itemsValue: isRemittance ? 'Transfer' : `${itemCount} item${itemCount !== 1 ? 's' : ''}`,
      nextStepsTitle: 'What\'s next?',
      stepWhatsapp: 'Optional: send us the payment proof via WhatsApp using the button below to speed up verification',
      step1: 'We will verify your payment proof',
      step2: isRemittance
        ? 'We will process your remittance in the next hours'
        : 'We will prepare your order for shipping',
      step3: 'We will notify you when it\'s on the way',
      estimatedLabel: 'Estimated delivery time',
      viewOrdersBtn: isRemittance ? 'View My Remittances' : 'View My Orders',
      closeBtn: 'Close',
      whatsappHint: 'Have questions? Contact us on WhatsApp',
      whatsappSendBtn: 'Send proof via WhatsApp',
      whatsappChatWith: `A chat with ${whatsappNumber} will open`,
      whatsappPreparing: 'Preparing WhatsApp message…',
      whatsappNotConfigured: 'Administrator WhatsApp not configured. Contact support.',
      whatsappOptionalNote: isRemittance
        ? 'Your remittance is already registered. The WhatsApp notice is optional.'
        : 'Your order is already registered. The WhatsApp notice is optional.'
    }
  };

  // Overrides for the "upload proof later" variant (remittance only)
  const proofPendingTexts = {
    es: {
      title: '¡Remesa Registrada!',
      subtitle: 'Falta subir tu comprobante de pago',
      stepWhatsapp: 'Opcional: avísanos por WhatsApp que registraste la remesa con el botón de abajo para acelerar la verificación',
      step1: 'Sube tu comprobante de pago desde Mis Remesas',
      step2: 'Procesaremos tu remesa cuando validemos el pago',
      whatsappSendBtn: 'Avisar al administrador por WhatsApp'
    },
    en: {
      title: 'Remittance Registered!',
      subtitle: 'Your payment proof is still pending',
      stepWhatsapp: 'Optional: let us know via WhatsApp that you registered the remittance using the button below to speed up verification',
      step1: 'Upload your payment proof from My Remittances',
      step2: 'We will process your remittance once the payment is validated',
      whatsappSendBtn: 'Notify the administrator via WhatsApp'
    }
  };

  // Overrides for the "resend" variant: nothing was just created, the user only re-notifies
  const resendTexts = {
    es: {
      title: 'Notifica al administrador por WhatsApp',
      subtitle: 'Tu navegador bloqueó la ventana. Abre el chat con el botón de abajo.',
      whatsappSendBtn: 'Abrir WhatsApp'
    },
    en: {
      title: 'Notify the administrator via WhatsApp',
      subtitle: 'Your browser blocked the window. Open the chat with the button below.',
      whatsappSendBtn: 'Open WhatsApp'
    }
  };

  const isResend = variant === 'resend';
  const baseTexts = texts[language] || texts.es;
  const t = {
    ...baseTexts,
    ...(isProofPending ? (proofPendingTexts[language] || proofPendingTexts.es) : {}),
    ...(isResend ? (resendTexts[language] || resendTexts.es) : {})
  };
  const hasWhatsappUrl = Boolean(whatsappUrl);
  const steps = hasWhatsappUrl
    ? [t.stepWhatsapp, t.step1, t.step2, t.step3]
    : [t.step1, t.step2, t.step3];

  // The WhatsApp step is optional: the operation is already registered, so leaving is never blocked
  const handleClose = () => onClose?.();
  const handleViewOrders = () => onViewOrders?.();

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors z-10"
              aria-label={language === 'es' ? 'Cerrar' : 'Close'}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Success header */}
            <div
              className="pt-8 pb-6 px-6 text-center"
              style={{
                background: `linear-gradient(135deg, ${visualSettings.primaryColor || '#2563eb'}15, ${visualSettings.successColor || '#10b981'}15)`
              }}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
                style={{ backgroundColor: `${visualSettings.successColor || '#10b981'}20` }}
              >
                <CheckCircle
                  className="h-10 w-10"
                  style={{ color: visualSettings.successColor || '#10b981' }}
                />
              </motion.div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{t.title}</h2>
              <p className="text-gray-600">{t.subtitle}</p>
            </div>

            {/* Order details */}
            <div className="px-6 py-4 space-y-3">
              {/* Order number - highlighted */}
              <div
                className="p-4 rounded-xl text-center"
                style={{ backgroundColor: `${visualSettings.primaryColor || '#2563eb'}10` }}
              >
                <p className="text-sm text-gray-500 mb-1">{t.orderLabel}</p>
                <p
                  className="text-xl font-bold font-mono"
                  style={{ color: visualSettings.primaryColor || '#2563eb' }}
                >
                  {orderNumber}
                </p>
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-3">
                {recipientName && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">{t.recipientLabel}</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{recipientName}</p>
                  </div>
                )}
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-0.5">{t.totalLabel}</p>
                  <p className="text-sm font-bold text-gray-900">
                    ${typeof total === 'number' ? total.toFixed(2) : total} {currency}
                  </p>
                </div>
                {!isRemittance && itemCount && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">{t.itemsLabel}</p>
                    <p className="text-sm font-medium text-gray-900">{t.itemsValue}</p>
                  </div>
                )}
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-0.5">{t.estimatedLabel}</p>
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {estimatedDelivery}
                  </p>
                </div>
              </div>
            </div>

            {/* Next steps (not applicable when only re-notifying) */}
            {!isResend && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {t.nextStepsTitle}
                </h3>
                <ol className="space-y-2">
                  {steps.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium text-white"
                        style={{ backgroundColor: visualSettings.primaryColor || '#2563eb' }}
                      >
                        {idx + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Actions */}
            <div className="px-6 py-4 space-y-3">
              {/* Optional WhatsApp step: user-gesture link, never popup-blocked */}
              {hasWhatsappUrl ? (
                <div className="space-y-1.5">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="confirmation-whatsapp-link"
                    className="flex items-center justify-center w-full h-12 rounded-md text-base font-medium text-white bg-[#25D366] hover:bg-[#1ebe5d] transition-colors focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2"
                  >
                    <MessageCircle className="mr-2 h-5 w-5" />
                    {t.whatsappSendBtn}
                  </a>
                  <p className="text-xs text-center text-gray-500">{t.whatsappChatWith}</p>
                  {!isResend && (
                    <p className="text-xs text-center text-gray-600" data-testid="confirmation-whatsapp-optional-note">
                      {t.whatsappOptionalNote}
                    </p>
                  )}
                </div>
              ) : whatsappLoading ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    disabled
                    aria-busy="true"
                    className="flex items-center justify-center w-full h-12 rounded-md text-base font-medium text-white bg-[#25D366] opacity-60 cursor-not-allowed"
                  >
                    <MessageCircle className="mr-2 h-5 w-5" />
                    {t.whatsappPreparing}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-center text-amber-700" role="status">{t.whatsappNotConfigured}</p>
              )}

              {/* With a WhatsApp URL the link above is the primary action; this one turns secondary */}
              <Button
                onClick={handleViewOrders}
                variant={hasWhatsappUrl ? 'outline' : 'default'}
                className={`w-full h-12 text-base font-medium ${hasWhatsappUrl ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50' : ''}`}
                style={hasWhatsappUrl ? undefined : {
                  backgroundColor: visualSettings.primaryColor || '#2563eb',
                  color: 'white'
                }}
              >
                {t.viewOrdersBtn}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <button
                onClick={handleClose}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                {t.closeBtn}
              </button>
            </div>

            {/* WhatsApp hint */}
            <div className="px-6 pb-4">
              <p className="text-xs text-center text-gray-400 flex items-center justify-center gap-1">
                <MessageCircle className="h-3.5 w-3.5" />
                {t.whatsappHint}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmationModal;
