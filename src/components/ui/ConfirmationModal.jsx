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
  estimatedDelivery = '24-72 horas'
}) => {
  const { language } = useLanguage();
  const { visualSettings } = useBusiness();

  const isRemittance = orderType === 'remittance';

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
      step1: 'Verificaremos tu comprobante de pago',
      step2: isRemittance
        ? 'Procesaremos tu remesa en las próximas horas'
        : 'Prepararemos tu pedido para envío',
      step3: 'Te notificaremos cuando esté en camino',
      estimatedLabel: 'Tiempo estimado de entrega',
      viewOrdersBtn: isRemittance ? 'Ver Mis Remesas' : 'Ver Mis Pedidos',
      closeBtn: 'Cerrar',
      whatsappHint: '¿Tienes preguntas? Contáctanos por WhatsApp'
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
      step1: 'We will verify your payment proof',
      step2: isRemittance
        ? 'We will process your remittance in the next hours'
        : 'We will prepare your order for shipping',
      step3: 'We will notify you when it\'s on the way',
      estimatedLabel: 'Estimated delivery time',
      viewOrdersBtn: isRemittance ? 'View My Remittances' : 'View My Orders',
      closeBtn: 'Close',
      whatsappHint: 'Have questions? Contact us on WhatsApp'
    }
  };

  const t = texts[language] || texts.es;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && onClose?.()}
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
              onClick={onClose}
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

            {/* Next steps */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t.nextStepsTitle}
              </h3>
              <ol className="space-y-2">
                {[t.step1, t.step2, t.step3].map((step, idx) => (
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

            {/* Actions */}
            <div className="px-6 py-4 space-y-3">
              <Button
                onClick={onViewOrders}
                className="w-full h-12 text-base font-medium"
                style={{
                  backgroundColor: visualSettings.primaryColor || '#2563eb',
                  color: 'white'
                }}
              >
                {t.viewOrdersBtn}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <button
                onClick={onClose}
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
