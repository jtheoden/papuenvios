import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { ShoppingBag, Clock, CheckCircle, XCircle, Package, Users, DollarSign, Loader2, X, Eye } from 'lucide-react';
import { getUserOrders, getOrderById } from '@/lib/orderService';
import { getHeadingStyle, getTextStyle, getCardStyle, getPillStyle, getStatusStyle, getBackgroundStyle } from '@/lib/styleUtils';
import { Button } from '@/components/ui/button';

const UserPanel = ({ onNavigate }) => {
  const { user, userProfile } = useAuth();
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!user) {
      onNavigate('login');
      return;
    }

    loadUserOrders();
  }, [user]);

  const loadUserOrders = async () => {
    if (!user?.id) return;

    setLoading(true);
    try {
      const result = await getUserOrders(user.id);
      if (result.success) {
        setOrders(result.orders);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOrderClick = async (orderId) => {
    setLoadingDetails(true);
    setShowOrderDetails(true);

    try {
      const result = await getOrderById(orderId);
      if (result.success) {
        setSelectedOrder(result.order);
      }
    } catch (error) {
      console.error('Error loading order details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const getStatusIcon = (status, paymentStatus) => {
    if (paymentStatus === 'validated' || status === 'completed') {
      return <CheckCircle className="h-5 w-5" style={{ color: visualSettings.successColor || '#10b981' }} />;
    }
    if (paymentStatus === 'rejected' || status === 'cancelled') {
      return <XCircle className="h-5 w-5" style={{ color: visualSettings.errorColor || '#ef4444' }} />;
    }
    if (paymentStatus === 'pending' || status === 'pending') {
      return <Clock className="h-5 w-5" style={{ color: visualSettings.warningColor || '#f59e0b' }} />;
    }
    return <Clock className="h-5 w-5" style={{ color: visualSettings.textSecondaryColor || '#6b7280' }} />;
  };

  const getStatusText = (status, paymentStatus) => {
    if (paymentStatus === 'validated') {
      return language === 'es' ? 'Validado' : 'Validated';
    }
    if (paymentStatus === 'rejected') {
      return language === 'es' ? 'Rechazado' : 'Rejected';
    }
    if (paymentStatus === 'pending') {
      return language === 'es' ? 'Pendiente' : 'Pending';
    }
    if (status === 'processing') {
      return language === 'es' ? 'En proceso' : 'Processing';
    }
    if (status === 'completed') {
      return language === 'es' ? 'Completado' : 'Completed';
    }
    return language === 'es' ? 'Pendiente' : 'Pending';
  };

  const getItemTypeIcon = (itemType) => {
    switch (itemType) {
      case 'product':
        return <Package className="h-4 w-4" />;
      case 'combo':
        return <ShoppingBag className="h-4 w-4" />;
      case 'remittance':
        return <DollarSign className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  const getItemTypeName = (itemType) => {
    switch (itemType) {
      case 'product':
        return language === 'es' ? 'Producto' : 'Product';
      case 'combo':
        return language === 'es' ? 'Combo' : 'Combo';
      case 'remittance':
        return language === 'es' ? 'Remesa' : 'Remittance';
      default:
        return itemType;
    }
  };

  if (!user) {
    return null;
  }

  const displayName = userProfile?.full_name || user.email?.split('@')[0] || 'Usuario';

  return (
    <div className="min-h-screen py-8 px-4" style={getBackgroundStyle(visualSettings)}>
      <div className="container mx-auto max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>
            {t('userPanel.title')}
          </h1>
          <p className="text-xl" style={getTextStyle(visualSettings, 'secondary')}>
            {language === 'es' ? `Bienvenido, ${displayName}` : `Welcome, ${displayName}`}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-8 rounded-2xl"
          style={getCardStyle(visualSettings)}
        >
          <h2 className="text-2xl font-semibold mb-6 flex items-center" style={getTextStyle(visualSettings, 'primary')}>
            <div
              className="p-2 rounded-lg mr-3"
              style={{
                background: visualSettings.useGradient
                  ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                  : visualSettings.primaryColor || '#2563eb'
              }}
            >
              <ShoppingBag className="h-5 w-5 text-white" />
            </div>
            {t('userPanel.myOrders')}
          </h2>

          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: visualSettings.primaryColor }} />
            </div>
          ) : orders.length > 0 ? (
            <div className="space-y-4">
              {orders.map(order => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 border rounded-lg hover:shadow-md transition-all cursor-pointer"
                  style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                  onClick={() => handleOrderClick(order.id)}
                >
                  <div className="flex flex-wrap justify-between items-center gap-4">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-semibold mb-1" style={getTextStyle(visualSettings, 'primary')}>
                        {order.order_number}
                      </p>
                      <p className="text-sm" style={getTextStyle(visualSettings, 'muted')}>
                        {new Date(order.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </p>
                      {order.shipping_zones && (
                        <p className="text-xs mt-1" style={getTextStyle(visualSettings, 'muted')}>
                          📍 {order.shipping_zones.province_name}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-bold mb-1" style={{ color: visualSettings.primaryColor }}>
                        ${parseFloat(order.total_amount).toFixed(2)} {order.currencies?.code || 'USD'}
                      </div>
                      <p className="text-xs" style={getTextStyle(visualSettings, 'muted')}>
                        {order.order_items?.length || 0} {language === 'es' ? 'artículos' : 'items'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className="px-3 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium"
                        style={getStatusStyle(order.payment_status || order.status, visualSettings)}
                      >
                        {getStatusIcon(order.status, order.payment_status)}
                        <span>{getStatusText(order.status, order.payment_status)}</span>
                      </div>
                      <Button size="sm" variant="ghost">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <ShoppingBag className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg mb-2" style={getTextStyle(visualSettings, 'secondary')}>
                {t('userPanel.noOrders')}
              </p>
              <p className="text-sm" style={getTextStyle(visualSettings, 'muted')}>
                {language === 'es' ? 'Comienza a comprar para ver tus pedidos aquí' : 'Start shopping to see your orders here'}
              </p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Order Details Modal/Tooltip */}
      <AnimatePresence>
        {showOrderDetails && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => {
                setShowOrderDetails(false);
                setSelectedOrder(null);
              }}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 rounded-2xl shadow-2xl"
                style={getCardStyle(visualSettings)}
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-2xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
                      {language === 'es' ? 'Detalles del Pedido' : 'Order Details'}
                    </h3>
                    {selectedOrder && (
                      <p className="text-sm" style={getTextStyle(visualSettings, 'muted')}>
                        {selectedOrder.order_number}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setShowOrderDetails(false);
                      setSelectedOrder(null);
                    }}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>

                {/* Loading State */}
                {loadingDetails ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin" style={{ color: visualSettings.primaryColor }} />
                  </div>
                ) : selectedOrder ? (
                  <div className="space-y-6">
                    {/* Order Info */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium mb-1" style={getTextStyle(visualSettings, 'muted')}>
                          {language === 'es' ? 'Fecha' : 'Date'}
                        </p>
                        <p className="text-sm" style={getTextStyle(visualSettings, 'primary')}>
                          {new Date(selectedOrder.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium mb-1" style={getTextStyle(visualSettings, 'muted')}>
                          {language === 'es' ? 'Estado' : 'Status'}
                        </p>
                        <div
                          className="inline-flex px-2 py-1 rounded-full text-xs font-medium"
                          style={getStatusStyle(selectedOrder.payment_status || selectedOrder.status, visualSettings)}
                        >
                          {getStatusText(selectedOrder.status, selectedOrder.payment_status)}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium mb-1" style={getTextStyle(visualSettings, 'muted')}>
                          {language === 'es' ? 'Provincia' : 'Province'}
                        </p>
                        <p className="text-sm" style={getTextStyle(visualSettings, 'primary')}>
                          {selectedOrder.shipping_zones?.province_name || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium mb-1" style={getTextStyle(visualSettings, 'muted')}>
                          {language === 'es' ? 'Total' : 'Total'}
                        </p>
                        <p className="text-lg font-bold" style={{ color: visualSettings.primaryColor }}>
                          ${parseFloat(selectedOrder.total_amount).toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                        </p>
                      </div>
                    </div>

                    {/* Order Items */}
                    <div>
                      <h4 className="text-lg font-semibold mb-3" style={getTextStyle(visualSettings, 'primary')}>
                        {language === 'es' ? 'Artículos' : 'Items'}
                      </h4>
                      <div className="space-y-3">
                        {selectedOrder.order_items?.map((item, index) => (
                          <div
                            key={index}
                            className="p-3 rounded-lg border"
                            style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                          >
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex items-start gap-3 flex-1">
                                <div
                                  className="p-2 rounded"
                                  style={getPillStyle(visualSettings, 'default')}
                                >
                                  {getItemTypeIcon(item.item_type)}
                                </div>
                                <div className="flex-1">
                                  <p className="font-medium mb-1" style={getTextStyle(visualSettings, 'primary')}>
                                    {language === 'es' ? item.item_name_es : item.item_name_en}
                                  </p>
                                  <div className="flex items-center gap-2 text-xs" style={getTextStyle(visualSettings, 'muted')}>
                                    <span
                                      className="px-2 py-0.5 rounded"
                                      style={getPillStyle(visualSettings, 'info')}
                                    >
                                      {getItemTypeName(item.item_type)}
                                    </span>
                                    <span>
                                      {language === 'es' ? 'Cantidad' : 'Qty'}: {item.quantity}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold" style={getTextStyle(visualSettings, 'primary')}>
                                  ${parseFloat(item.total_price).toFixed(2)}
                                </p>
                                <p className="text-xs" style={getTextStyle(visualSettings, 'muted')}>
                                  ${parseFloat(item.unit_price).toFixed(2)} c/u
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Payment Proof */}
                    {selectedOrder.payment_proof_url && (
                      <div>
                        <h4 className="text-lg font-semibold mb-3" style={getTextStyle(visualSettings, 'primary')}>
                          {language === 'es' ? 'Comprobante de Pago' : 'Payment Proof'}
                        </h4>
                        <img
                          src={selectedOrder.payment_proof_url}
                          alt="Payment proof"
                          className="w-full rounded-lg border"
                          style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                        />
                      </div>
                    )}

                    {/* Rejection Reason */}
                    {selectedOrder.rejection_reason && (
                      <div
                        className="p-4 rounded-lg"
                        style={getStatusStyle('rejected', visualSettings)}
                      >
                        <p className="font-medium mb-1">
                          {language === 'es' ? 'Motivo de Rechazo' : 'Rejection Reason'}
                        </p>
                        <p className="text-sm">{selectedOrder.rejection_reason}</p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UserPanel;