import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Gift, TrendingDown } from 'lucide-react';

/**
 * Order Details Modal Component
 * Displays complete order information including items, totals, shipping, and payment proof
 * Fully accessible with ARIA attributes and keyboard navigation support
 */
const OrderDetailsModal = ({ order, onClose, formatDate, formatCurrency }) => {
  const modalRef = useRef(null);
  const titleId = `order-modal-title-${order.id}`;

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Return cleanup function
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="presentation"
      onClick={(e) => {
        // Close modal when clicking outside (on the backdrop)
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3
            id={titleId}
            className="text-xl font-bold text-gray-900"
          >
            Detalles de Orden: {order.order_number}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1"
            aria-label="Cerrar modal"
            title="Presione Escape para cerrar"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Order Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Order Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoItem label="Número de Orden" value={order.order_number} />
              <InfoItem label="Fecha" value={formatDate(order.created_at)} />
              <InfoItem label="Usuario" value={order.user_name || 'N/A'} />
              <InfoItem label="Email" value={order.user_email || 'N/A'} />
              <InfoItem label="Tipo de Orden" value={order.order_type} />
              <InfoItem
                label="Estado de Pago"
                value={getStatusText(order.status, order.payment_status, 'es')}
              />
              <InfoItem label="Estado de Orden" value={order.status} />
              <InfoItem label="Método de Pago" value={order.payment_method} />
            </div>

            {/* Order Items */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Items de la Orden</h4>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full" role="table">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        Producto
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        Cantidad
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        Precio Unit.
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200" role="rowgroup">
                    {order.order_items?.map((item, index) => (
                      <tr key={index} role="row">
                        <td className="px-4 py-3 text-sm text-gray-900" role="cell">
                          {item.item_name_es || item.item_name_en}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900" role="cell">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900" role="cell">
                          {formatCurrency(item.unit_price, order.currencies?.code)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900" role="cell">
                          {formatCurrency(item.total_price, order.currencies?.code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Discount Details Section */}
            {order.discount_amount > 0 && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                <div className="flex items-start gap-3">
                  <TrendingDown className="h-5 w-5 text-green-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-green-900 mb-2">Descuento Aplicado</h4>
                    <div className="text-sm text-green-800">
                      {order.offer_code ? (
                        <p>Cupón: <code className="bg-white px-2 py-1 rounded font-mono font-bold text-green-700">{order.offer_code}</code></p>
                      ) : (
                        <p>Descuento por categoría de usuario</p>
                      )}
                      <p className="mt-1">Ahorro: <span className="font-bold">{formatCurrency(order.discount_amount, order.currencies?.code)}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-medium">{formatCurrency(order.subtotal, order.currencies?.code)}</span>
              </div>
              {order.discount_amount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Descuento:</span>
                  <span className="font-medium">-{formatCurrency(order.discount_amount, order.currencies?.code)}</span>
                </div>
              )}
              {order.shipping_cost > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Envío:</span>
                  <span className="font-medium">{formatCurrency(order.shipping_cost, order.currencies?.code)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                <span>Total:</span>
                <span>{formatCurrency(order.total_amount, order.currencies?.code)}</span>
              </div>
            </div>

            {/* Shipping Info */}
            {order.shipping_address && (
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">Información de Envío</h4>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <p><span className="font-medium">Dirección:</span> {order.shipping_address}</p>
                  {order.recipient_info && (
                    <>
                      <p><span className="font-medium">Destinatario:</span> {order.recipient_info.name}</p>
                      <p><span className="font-medium">Teléfono:</span> {order.recipient_info.phone}</p>
                    </>
                  )}
                  {order.delivery_instructions && (
                    <p><span className="font-medium">Instrucciones:</span> {order.delivery_instructions}</p>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {order.notes && (
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">Notas</h4>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4">{order.notes}</p>
              </div>
            )}

            {/* Rejection Reason */}
            {order.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="text-lg font-semibold text-red-900 mb-2">Razón de Rechazo</h4>
                <p className="text-sm text-red-700">{order.rejection_reason}</p>
              </div>
            )}
          </div>

          {/* Right Column - Payment Proof */}
          <div className="lg:col-span-1">
            {order.payment_proof_url ? (
              <div className="sticky top-20 space-y-3">
                <h4 className="text-lg font-semibold text-gray-900">Comprobante de Pago</h4>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-2">
                  <img
                    src={order.payment_proof_url}
                    alt="Comprobante de pago"
                    className="w-full h-auto rounded-lg"
                  />
                </div>
                <a
                  href={order.payment_proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Ver en tamaño completo →
                </a>
              </div>
            ) : (
              <div className="sticky top-20 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800 font-medium">
                  Sin comprobante de pago
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            aria-label="Cerrar detalles de la orden"
          >
            Cerrar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// Helper Components
const InfoItem = ({ label, value }) => (
  <div>
    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</dt>
    <dd className="text-sm text-gray-900">{value}</dd>
  </div>
);

// Helper Functions (moved from AdminOrdersTab)
const PAYMENT_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected'
};

const getStatusText = (status, paymentStatus, language = 'es') => {
  if (paymentStatus === PAYMENT_STATUS.PENDING) {
    return language === 'es' ? 'Pendiente de Pago' : 'Payment Pending';
  }
  if (paymentStatus === PAYMENT_STATUS.REJECTED) {
    return language === 'es' ? 'Pago Rechazado' : 'Payment Rejected';
  }
  if (paymentStatus === PAYMENT_STATUS.CONFIRMED) {
    return language === 'es' ? 'Pago Confirmado' : 'Payment Confirmed';
  }
  return paymentStatus;
};

export default OrderDetailsModal;
