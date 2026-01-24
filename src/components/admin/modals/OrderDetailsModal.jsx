import { useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, TrendingDown, User } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Order Details Modal Component
 * Displays complete order information including items, totals, shipping, and payment proof
 * Fully accessible with ARIA attributes and keyboard navigation support
 * @param {Object} order - The order object to display
 * @param {Function} onClose - Callback to close the modal
 * @param {Function} formatDate - Function to format dates
 * @param {Function} formatCurrency - Function to format currency
 */
const OrderDetailsModal = ({ order, onClose, formatDate, formatCurrency }) => {
  const { t, language } = useLanguage();
  const modalRef = useRef(null);
  const titleId = `order-modal-title-${order?.id}`;

  // Normalize order data - parse recipient_info and combine user data from different sources
  const normalizedOrder = useMemo(() => {
    if (!order) return null;

    // Parse recipient_info if it's a JSON string
    let recipientInfo = order.recipient_info;
    if (typeof recipientInfo === 'string' && recipientInfo) {
      try {
        recipientInfo = JSON.parse(recipientInfo);
      } catch {
        recipientInfo = {};
      }
    }

    return {
      ...order,
      // Normalize user name and email from different sources
      user_name: order.user_name || order.user_profiles?.full_name || 'N/A',
      user_email: order.user_email || order.user_profiles?.email || 'N/A',
      // Parsed recipient info
      recipient_info: recipientInfo || {}
    };
  }, [order]);

  if (!normalizedOrder) return null;

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
            {t('adminOrders.detail.title')}: {normalizedOrder.order_number}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1"
            aria-label={t('tables.closeDetailsAria')}
            title={t('tables.closeDetailsHint')}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Order Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Order Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem label={t('adminOrders.detail.order')} value={normalizedOrder.order_number} />
              <InfoItem label={t('common.date')} value={formatDate(normalizedOrder.created_at)} />
              <InfoItem label={t('activityLog.user')} value={normalizedOrder.user_name} />
              <InfoItem label={t('common.email')} value={normalizedOrder.user_email} />
              <InfoItem label={t('adminOrders.table.type')} value={normalizedOrder.order_type} />
              <InfoItem
                label={t('adminOrders.table.paymentStatus.label')}
                value={getStatusText(normalizedOrder.payment_status, t)}
              />
              <InfoItem label={t('adminOrders.table.orderStatus.label')} value={normalizedOrder.status} />
              <InfoItem label={t('adminOrders.detail.paymentMethod')} value={normalizedOrder.payment_method} />
            </div>

            {/* Recipient Details Section */}
            {normalizedOrder.recipient_info && Object.keys(normalizedOrder.recipient_info).length > 0 && (
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {t('adminOrders.detail.recipient')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">{t('common.name')}:</span>
                    <span className="ml-2 font-medium text-gray-900">{normalizedOrder.recipient_info.fullName || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('common.phone')}:</span>
                    <span className="ml-2 font-medium text-gray-900">{normalizedOrder.recipient_info.phone || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('recipients.provinceLabel')}:</span>
                    <span className="ml-2 font-medium text-gray-900">{normalizedOrder.recipient_info.province || normalizedOrder.shipping_zones?.province_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('recipients.municipalityLabel')}:</span>
                    <span className="ml-2 font-medium text-gray-900">{normalizedOrder.recipient_info.municipality || normalizedOrder.shipping_zones?.municipality_name || 'N/A'}</span>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-gray-500">{t('common.address')}:</span>
                    <span className="ml-2 font-medium text-gray-900">{normalizedOrder.recipient_info.address || normalizedOrder.shipping_address || 'N/A'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Order Items */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">{t('adminOrders.table.items')}</h4>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full" role="table">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        {t('adminOrders.detail.product')}
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        {t('adminOrders.detail.quantity')}
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        {t('adminOrders.detail.unitPrice')}
                      </th>
                      <th
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500"
                        scope="col"
                        role="columnheader"
                      >
                        {t('adminOrders.table.total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200" role="rowgroup">
                    {normalizedOrder.order_items?.map((item, index) => (
                      <tr key={index} role="row">
                        <td className="px-4 py-3 text-sm text-gray-900" role="cell">
                          {language === 'es' ? (item.item_name_es || item.item_name_en) : (item.item_name_en || item.item_name_es)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900" role="cell">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900" role="cell">
                          {formatCurrency(item.unit_price, normalizedOrder.currencies?.code)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900" role="cell">
                          {formatCurrency(item.total_price, normalizedOrder.currencies?.code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Discount Details Section */}
            {normalizedOrder.discount_amount > 0 && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                <div className="flex items-start gap-3">
                  <TrendingDown className="h-5 w-5 text-green-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-green-900 mb-2">
                      {t('adminOrders.detail.discountApplied')}
                    </h4>
                    <div className="text-sm text-green-800">
                      {normalizedOrder.offer_code ? (
                        <p>{t('adminOrders.detail.coupon')}: <code className="bg-white px-2 py-1 rounded font-mono font-bold text-green-700">{normalizedOrder.offer_code}</code></p>
                      ) : (
                        <p>{t('adminOrders.detail.categoryDiscount')}</p>
                      )}
                      <p className="mt-1">{t('adminOrders.detail.savings')}: <span className="font-bold">{formatCurrency(normalizedOrder.discount_amount, normalizedOrder.currencies?.code)}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{t('adminOrders.detail.subtotal')}:</span>
                <span className="font-medium">{formatCurrency(normalizedOrder.subtotal, normalizedOrder.currencies?.code)}</span>
              </div>
              {normalizedOrder.discount_amount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>{t('adminOrders.detail.discount')}:</span>
                  <span className="font-medium">-{formatCurrency(normalizedOrder.discount_amount, normalizedOrder.currencies?.code)}</span>
                </div>
              )}
              {normalizedOrder.shipping_cost > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{t('adminOrders.detail.shipping')}:</span>
                  <span className="font-medium">{formatCurrency(normalizedOrder.shipping_cost, normalizedOrder.currencies?.code)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                <span>{t('adminOrders.detail.total')}:</span>
                <span>{formatCurrency(normalizedOrder.total_amount, normalizedOrder.currencies?.code)}</span>
              </div>
            </div>

            {/* Shipping Info */}
            {normalizedOrder.shipping_address && (
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">
                  {t('adminOrders.detail.shippingInfo')}
                </h4>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <p><span className="font-medium">{t('adminOrders.detail.address')}:</span> {normalizedOrder.shipping_address}</p>
                  {normalizedOrder.recipient_info && normalizedOrder.recipient_info.fullName && (
                    <>
                      <p><span className="font-medium">{t('adminOrders.detail.recipient')}:</span> {normalizedOrder.recipient_info.fullName}</p>
                      <p><span className="font-medium">{t('adminOrders.detail.phone')}:</span> {normalizedOrder.recipient_info.phone}</p>
                    </>
                  )}
                  {normalizedOrder.delivery_instructions && (
                    <p><span className="font-medium">{t('adminOrders.detail.instructions')}:</span> {normalizedOrder.delivery_instructions}</p>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {normalizedOrder.notes && (
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">
                  {t('adminOrders.detail.notes')}
                </h4>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4">{normalizedOrder.notes}</p>
              </div>
            )}

            {/* Rejection Reason */}
            {normalizedOrder.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="text-lg font-semibold text-red-900 mb-2">
                  {t('adminOrders.detail.rejectionReason')}
                </h4>
                <p className="text-sm text-red-700">{normalizedOrder.rejection_reason}</p>
              </div>
            )}
          </div>

          {/* Right Column - Payment Proof */}
          <div className="lg:col-span-1">
            {normalizedOrder.payment_proof_url ? (
              <div className="sticky top-20 space-y-3">
                <h4 className="text-lg font-semibold text-gray-900">
                  {t('adminOrders.detail.paymentProof')}
                </h4>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-2">
                  <img
                    src={normalizedOrder.payment_proof_url}
                    alt={t('adminOrders.detail.paymentProof')}
                    className="w-full h-auto rounded-lg"
                  />
                </div>
                <a
                  href={normalizedOrder.payment_proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {t('adminOrders.detail.viewFullSize')} →
                </a>
              </div>
            ) : (
              <div className="sticky top-20 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800 font-medium">
                  {t('adminOrders.detail.noPaymentProof')}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            aria-label={t('adminOrders.detail.closeOrderDetails')}
          >
            {t('adminOrders.detail.close')}
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

const getStatusText = (paymentStatus, t) => {
  if (paymentStatus === PAYMENT_STATUS.PENDING) {
    return t('adminOrders.table.paymentStatus.pending');
  }
  if (paymentStatus === PAYMENT_STATUS.REJECTED) {
    return t('adminOrders.table.paymentStatus.rejected');
  }
  if (paymentStatus === PAYMENT_STATUS.CONFIRMED) {
    return t('adminOrders.table.paymentStatus.confirmed');
  }
  return paymentStatus;
};

export default OrderDetailsModal;
