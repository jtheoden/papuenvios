import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useModal } from '@/contexts/ModalContext';
import { ShoppingBag, Clock, CheckCircle, XCircle, Package, DollarSign, Loader2, X, Eye, MessageCircle, Star, FileText, Send, ArrowRight, Users, Crown, TrendingDown, Gift, Truck, Upload, EyeOff, Filter, ChevronDown } from 'lucide-react';
import { getUserOrders, getOrderById, getAllOrders, validatePayment, rejectPayment, cancelOrderByUser, uploadPaymentProof, markOrderAsDispatched, markOrderAsDelivered, completeOrder, reopenOrder, ORDER_STATUS, PAYMENT_STATUS } from '@/lib/orderService';
import { getUserTestimonial, createTestimonial, updateTestimonial } from '@/lib/testimonialService';
import { getMyRemittances } from '@/lib/remittanceService';
import { getHeadingStyle, getTextStyle, getPillStyle, getStatusStyle } from '@/lib/styleUtils';
import { generateWhatsAppURL } from '@/lib/whatsappService';
import { getActiveWhatsappRecipient } from '@/lib/notificationSettingsService';
import { Button } from '@/components/ui/button';
import CategoryBadge from '@/components/CategoryBadge';
import { derivePercentFromAmount } from '@/lib/discountDisplayService';
import { useUserDiscounts } from '@/hooks/useUserDiscounts';
import { useRealtimeRemittances, useRealtimeOrders } from '@/hooks/useRealtimeSubscription';

// Constante de paginación fuera del componente para evitar recreación
const ORDERS_PER_PAGE = 20;

const UserPanel = ({ onNavigate }) => {
  const { user, userRole, userCategory } = useAuth();
  const { t, language } = useLanguage();
  const { visualSettings, notificationSettings } = useBusiness();
  // Use notification settings for WhatsApp contact (from DB, not hardcoded)
  const whatsappContact = getActiveWhatsappRecipient(notificationSettings);
  const { showModal } = useModal();
  const { categoryDiscountPercent } = useUserDiscounts();
  const isRegularUser = userRole === 'user';
  const [orders, setOrders] = useState([]);
  const [remittances, setRemittances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [testimonial, setTestimonial] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [savingTestimonial, setSavingTestimonial] = useState(false);
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionOrderId, setActionOrderId] = useState(null);
  const [trackingInfo, setTrackingInfo] = useState('');
  const [deliveryProofFile, setDeliveryProofFile] = useState(null);
  const [retryProofFile, setRetryProofFile] = useState(null);
  const [processingAction, setProcessingAction] = useState(false);
  const [hideCompletedOrders, setHideCompletedOrders] = useState(true); // Ocultar pedidos finalizados/cancelados por defecto

  // Paginación de órdenes
  const [visibleOrdersCount, setVisibleOrdersCount] = useState(ORDERS_PER_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const ordersContainerRef = useRef(null);
  const selectedOrderSubtotal = selectedOrder ? (parseFloat(selectedOrder.subtotal) || 0) : 0;
  const selectedOrderTotal = selectedOrder ? (parseFloat(selectedOrder.total_amount) || 0) : 0;
  const selectedOrderDiscountTotal = selectedOrder ? (parseFloat(selectedOrder.discount_amount) || 0) : 0;
  const selectedOrderShipping = selectedOrder ? (parseFloat(selectedOrder.shipping_cost) || 0) : 0;
  const selectedOrderCategoryPercent = selectedOrder
    ? (selectedOrder?.user_category_discount?.enabled === false
      ? 0
      : selectedOrder?.user_category_discount?.discount_percentage ?? (isRegularUser ? categoryDiscountPercent : 0))
    : 0;
  const selectedOrderCategoryDiscountAmount = selectedOrderCategoryPercent > 0
    ? parseFloat(((selectedOrderSubtotal * selectedOrderCategoryPercent) / 100).toFixed(2))
    : 0;
  const selectedOrderCouponDiscountAmount = Math.max(
    selectedOrderDiscountTotal - selectedOrderCategoryDiscountAmount,
    0
  );
  const selectedOrderBaseTotal = selectedOrderSubtotal + selectedOrderShipping;
  const selectedOrderTotalAfterCategory = Math.max(selectedOrderBaseTotal - selectedOrderCategoryDiscountAmount, 0);

  // Parse recipient_info for selected order
  const selectedOrderRecipientInfo = useMemo(() => {
    if (!selectedOrder?.recipient_info) return null;
    if (typeof selectedOrder.recipient_info === 'string') {
      try {
        return JSON.parse(selectedOrder.recipient_info);
      } catch {
        return null;
      }
    }
    return selectedOrder.recipient_info;
  }, [selectedOrder]);

  // Órdenes filtradas según el estado del toggle
  const filteredOrders = useMemo(() => {
    if (userRole === 'admin' || userRole === 'super_admin') return orders;
    if (!hideCompletedOrders) return orders;
    return orders.filter(order => !['completed', 'cancelled'].includes(order.status));
  }, [orders, hideCompletedOrders, userRole]);

  // Órdenes paginadas (slice de las filtradas)
  const paginatedOrders = useMemo(() => {
    return filteredOrders.slice(0, visibleOrdersCount);
  }, [filteredOrders, visibleOrdersCount]);

  // Verifica si hay más órdenes por cargar
  const hasMoreOrders = filteredOrders.length > visibleOrdersCount;

  // Handler para cargar más órdenes
  const handleLoadMoreOrders = useCallback(() => {
    setLoadingMore(true);
    // Simular pequeño delay para mejor UX
    setTimeout(() => {
      setVisibleOrdersCount(prev => prev + ORDERS_PER_PAGE);
      setLoadingMore(false);
    }, 300);
  }, []);

  // Resetear paginación cuando cambia el filtro
  useEffect(() => {
    setVisibleOrdersCount(ORDERS_PER_PAGE);
  }, [hideCompletedOrders]);

  const loadUserRemittances = useCallback(async () => {
    if (!user?.id) return;

    try {
      const result = await getMyRemittances();
      if (result.success) {
        setRemittances(result.remittances || []);
      }
    } catch (error) {
      console.error('Error loading remittances:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      onNavigate('login');
      return;
    }

    loadUserOrders();
    loadUserRemittances();

    // Load user testimonial only for regular users
    if (userRole !== 'admin' && userRole !== 'super_admin') {
      loadUserTestimonial();
    }
  }, [user, userRole, loadUserRemittances]);

  const loadUserTestimonial = async () => {
    if (!user?.id) return;

    try {
      const testimonial = await getUserTestimonial(user.id);
      if (testimonial) {
        setTestimonial(testimonial);
        setRating(testimonial.rating);
        setComment(testimonial.comment || '');
      }
    } catch (error) {
      console.error('Error loading testimonial:', error);
    }
  };

  const loadUserOrders = async () => {
    if (!user?.id) return;

    console.log('[UserPanel] Loading orders for role:', userRole);
    setLoading(true);
    try {
      // Admin/super_admin see orders needing attention (pending payment, proof uploaded, or rejected)
      // Regular users see their own orders
      if (userRole === 'admin' || userRole === 'super_admin') {
        console.log('[UserPanel] Loading orders needing admin attention');
        // Fetch all orders with pending status (regardless of payment_status)
        // This includes: proof_uploaded (needs validation), pending (waiting for proof), rejected (needs retry)
        const orders = await getAllOrders();
        console.log('[UserPanel] Admin orders result:', orders);
        setOrders(orders || []);
      } else {
        console.log('[UserPanel] Loading user orders for regular user');
        const userOrders = await getUserOrders(user.id);
        console.log('[UserPanel] User orders result:', userOrders);
        setOrders(userOrders || []);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useRealtimeRemittances({
    enabled: userRole === 'user' && !!user?.id,
    filter: user ? `user_id=eq.${user.id}` : null,
    onUpdate: loadUserRemittances
  });

  // Suscripción real-time para órdenes - actualiza automáticamente cuando cambia el estado
  useRealtimeOrders({
    enabled: !!user?.id,
    onUpdate: (payload) => {
      console.log('[UserPanel] Order realtime update:', payload.eventType);
      // Recargar órdenes cuando haya cualquier cambio
      loadUserOrders();
      // Si el modal de detalles está abierto y es la orden que cambió, actualizarla
      if (selectedOrder?.id === payload.new?.id || selectedOrder?.id === payload.old?.id) {
        getOrderById(selectedOrder.id).then(order => {
          if (order) setSelectedOrder(order);
        }).catch(console.error);
      }
    }
  });

  const handleOrderClick = async (orderId) => {
    setLoadingDetails(true);
    setShowOrderDetails(true);
    setTrackingInfo('');
    setDeliveryProofFile(null);
    setRetryProofFile(null);

    try {
      const order = await getOrderById(orderId);
      console.log('[UserPanel] Order details loaded:', order);
      setSelectedOrder(order);
      console.log('[UserPanel] Selected order payment_status:', order?.payment_status);
      console.log('[UserPanel] Payment proof URL:', order?.payment_proof_url);
      console.log('[UserPanel] Current userRole:', userRole);
    } catch (error) {
      console.error('Error loading order details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleValidatePayment = async (orderId) => {
    setActionOrderId(orderId);
    setShowValidateModal(true);
  };

  const confirmValidatePayment = async () => {
    setLoadingDetails(true);
    setShowValidateModal(false);
    try {
      const result = await validatePayment(actionOrderId, user.id);
      if (result && !result.error) {
        await loadUserOrders();
        setShowOrderDetails(false);
        setSelectedOrder(null);
      }
    } catch (error) {
      console.error('Error validating payment:', error);
    } finally {
      setLoadingDetails(false);
      setActionOrderId(null);
    }
  };

  const handleRejectPayment = async (orderId) => {
    setActionOrderId(orderId);
    setRejectionReason('');
    setShowRejectModal(true);
  };

  const confirmRejectPayment = async () => {
    if (!rejectionReason.trim()) return;

    setLoadingDetails(true);
    setShowRejectModal(false);
    try {
      const result = await rejectPayment(actionOrderId, user.id, rejectionReason);
      if (result && !result.error) {
        await loadUserOrders();
        setShowOrderDetails(false);
        setSelectedOrder(null);
      }
    } catch (error) {
      console.error('Error rejecting payment:', error);
    } finally {
      setLoadingDetails(false);
      setActionOrderId(null);
      setRejectionReason('');
    }
  };

  const handleCancelOrderUser = async (orderId) => {
    if (!orderId) return;
    setProcessingAction(true);
    try {
      await cancelOrderByUser(orderId, user.id, 'cancelled_by_user');
      await loadUserOrders();
      setShowOrderDetails(false);
      setSelectedOrder(null);
    } catch (error) {
      console.error('Error cancelling order:', error);
    } finally {
      setProcessingAction(false);
    }
  };

  const handleReopenOrder = async (orderId) => {
    if (!orderId) return;

    // Confirm with user using modal
    const confirmed = await showModal({
      title: t('userPanel.reopenOrderTitle'),
      message: t('userPanel.reopenOrderMessage'),
      type: 'info',
      confirmText: t('userPanel.reopenOrder'),
      cancelText: t('common.cancel')
    });

    if (!confirmed) return;

    setProcessingAction(true);
    try {
      await reopenOrder(orderId, user.id);

      // Show success message
      await showModal({
        title: t('common.success'),
        message: t('userPanel.reopenOrderSuccess'),
        type: 'success',
        confirmText: t('common.ok'),
        cancelText: null
      });

      await loadUserOrders();
      // Refresh order details if viewing
      if (selectedOrder?.id === orderId) {
        const refreshed = await getOrderById(orderId);
        setSelectedOrder(refreshed);
      }
    } catch (error) {
      console.error('Error reopening order:', error);
      await showModal({
        title: t('common.error'),
        message: error.message || t('userPanel.reopenOrderError'),
        type: 'danger',
        confirmText: t('common.ok'),
        cancelText: null
      });
    } finally {
      setProcessingAction(false);
    }
  };

  const handleMarkDispatched = async () => {
    if (!selectedOrder?.id) return;
    setProcessingAction(true);
    try {
      await markOrderAsDispatched(selectedOrder.id, user.id, trackingInfo.trim());
      await loadUserOrders();
      const refreshed = await getOrderById(selectedOrder.id);
      setSelectedOrder(refreshed);
    } catch (error) {
      console.error('Error marking order as dispatched:', error);
    } finally {
      setProcessingAction(false);
    }
  };

  const handleMarkDelivered = async () => {
    if (!selectedOrder?.id || !deliveryProofFile) return;
    setProcessingAction(true);
    try {
      await markOrderAsDelivered(selectedOrder.id, deliveryProofFile, user.id);
      await loadUserOrders();
      const refreshed = await getOrderById(selectedOrder.id);
      setSelectedOrder(refreshed);
    } catch (error) {
      console.error('Error marking order as delivered:', error);
    } finally {
      setProcessingAction(false);
    }
  };

  const handleCompleteOrder = async () => {
    if (!selectedOrder?.id) return;
    setProcessingAction(true);
    try {
      await completeOrder(selectedOrder.id, 'Order completed after delivery proof');
      await loadUserOrders();
      const refreshed = await getOrderById(selectedOrder.id);
      setSelectedOrder(refreshed);
    } catch (error) {
      console.error('Error completing order:', error);
    } finally {
      setProcessingAction(false);
    }
  };

  const handleRetryPaymentProof = async () => {
    if (!selectedOrder?.id || !retryProofFile) return;
    setProcessingAction(true);
    try {
      await uploadPaymentProof(retryProofFile, selectedOrder.id, user.id);
      await loadUserOrders();
      const refreshed = await getOrderById(selectedOrder.id);
      setSelectedOrder(refreshed);
    } catch (error) {
      console.error('Error uploading new payment proof:', error);
    } finally {
      setProcessingAction(false);
    }
  };

  const handleSaveTestimonial = async () => {
    if (rating === 0) {
      alert(language === 'es'
        ? 'Por favor selecciona una calificación'
        : 'Please select a rating');
      return;
    }

    setSavingTestimonial(true);
    try {
      const testimonialData = {
        user_id: user.id,
        rating,
        comment: comment.trim()
      };

      let result;
      if (testimonial) {
        // Update existing
        result = await updateTestimonial(testimonial.id, { rating, comment: comment.trim() });
      } else {
        // Create new
        result = await createTestimonial(testimonialData);
      }

      if (result.data) {
        setTestimonial(result.data);
        alert(language === 'es'
          ? '¡Gracias por tu testimonio! Será revisado por nuestro equipo.'
          : 'Thank you for your testimonial! It will be reviewed by our team.');
      }
    } catch (error) {
      console.error('Error saving testimonial:', error);
      alert(language === 'es'
        ? 'Error al guardar el testimonio'
        : 'Error saving testimonial');
    } finally {
      setSavingTestimonial(false);
    }
  };

  const getStatusIcon = (status, paymentStatus) => {
    if (paymentStatus === 'validated' || status === 'completed') {
      return <CheckCircle className="h-5 w-5" style={{ color: visualSettings.successColor || '#10b981' }} />;
    }
    if (status === 'dispatched') {
      return <Truck className="h-5 w-5" style={{ color: visualSettings.primaryColor || '#2563eb' }} />;
    }
    if (status === 'delivered') {
      return <Package className="h-5 w-5" style={{ color: visualSettings.primaryColor || '#2563eb' }} />;
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
    if (status === 'dispatched') {
      return language === 'es' ? 'Despachado' : 'Dispatched';
    }
    if (status === 'delivered') {
      return language === 'es' ? 'Entregado' : 'Delivered';
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

  const getOrderStatusLabel = (status) => {
    const labels = {
      [ORDER_STATUS.PENDING]: language === 'es' ? 'Pendiente' : 'Pending',
      [ORDER_STATUS.PROCESSING]: language === 'es' ? 'En proceso' : 'Processing',
      [ORDER_STATUS.DISPATCHED]: language === 'es' ? 'Despachado' : 'Dispatched',
      [ORDER_STATUS.DELIVERED]: language === 'es' ? 'Entregado' : 'Delivered',
      [ORDER_STATUS.COMPLETED]: language === 'es' ? 'Completado' : 'Completed',
      [ORDER_STATUS.CANCELLED]: language === 'es' ? 'Cancelado' : 'Cancelled'
    };

    return labels[status] || (language === 'es' ? 'Desconocido' : 'Unknown');
  };

  const getPaymentStatusLabel = (paymentStatus) => {
    const labels = {
      [PAYMENT_STATUS.PENDING]: language === 'es' ? 'Pago pendiente' : 'Payment pending',
      [PAYMENT_STATUS.PROOF_UPLOADED]: language === 'es' ? 'Comprobante cargado' : 'Proof uploaded',
      [PAYMENT_STATUS.VALIDATED]: language === 'es' ? 'Pago validado' : 'Payment validated',
      [PAYMENT_STATUS.REJECTED]: language === 'es' ? 'Pago rechazado' : 'Payment rejected'
    };

    return labels[paymentStatus] || (language === 'es' ? 'Desconocido' : 'Unknown');
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

  const displayName = user?.profile?.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || 'Usuario';

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>
            {t('userPanel.title')}
          </h1>
          <div className="flex flex-col items-center gap-3">
            <p className="text-xl" style={getTextStyle(visualSettings, 'secondary')}>
              {language === 'es' ? `Bienvenido, ${displayName}` : `Welcome, ${displayName}`}
            </p>
            {userCategory && userRole !== 'admin' && userRole !== 'super_admin' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="inline-flex items-center gap-2"
              >
                <span className="text-sm font-medium" style={getTextStyle(visualSettings, 'secondary')}>
                  {t('userPanel.categoryLabel')}
                </span>
                <CategoryBadge categoryName={userCategory.category_name} />
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* WhatsApp Support Button */}
        {whatsappContact && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <div
              className="p-4 rounded-xl border flex items-center justify-between bg-white"
              style={{
                borderColor: '#10b981'
              }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-full">
                  <MessageCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium" style={getTextStyle(visualSettings, 'primary')}>
                    {language === 'es' ? '¿Necesitas ayuda?' : 'Need help?'}
                  </p>
                  <p className="text-sm" style={getTextStyle(visualSettings, 'muted')}>
                    {language === 'es'
                      ? 'Ante dudas contactar a soporte vía WhatsApp'
                      : 'Contact support via WhatsApp for any questions'}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => {
                  const message = language === 'es'
                    ? `Hola! Soy ${displayName}. Necesito ayuda con mi cuenta.`
                    : `Hello! I'm ${displayName}. I need help with my account.`;
                  window.open(generateWhatsAppURL(whatsappContact, message), '_blank');
                }}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                {language === 'es' ? 'Contactar' : 'Contact'}
              </Button>
            </div>
          </motion.div>
        )}

        {/* Remittances Summary Card - Only for regular users */}
        {userRole !== 'admin' && userRole !== 'super_admin' && remittances.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            <div className="p-6 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm font-medium">{t('remittances.user.remittanceNumber')}</p>
                  <p className="text-3xl font-bold mt-1">{remittances.length}</p>
                </div>
                <div className="p-3 bg-white/20 rounded-lg">
                  <Send className="h-6 w-6" />
                </div>
              </div>
            </div>

            <div className="p-6 rounded-xl bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium">{t('remittances.status.completed')}</p>
                  <p className="text-3xl font-bold mt-1">
                    {remittances.filter(r => r.status === 'completed').length}
                  </p>
                </div>
                <div className="p-3 bg-white/20 rounded-lg">
                  <CheckCircle className="h-6 w-6" />
                </div>
              </div>
            </div>

            <div className="p-6 rounded-xl bg-gradient-to-br from-yellow-500 to-yellow-600 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-yellow-100 text-sm font-medium">{t('remittances.status.processing')}</p>
                  <p className="text-3xl font-bold mt-1">
                    {remittances.filter(r => ['payment_validated', 'processing', 'delivered'].includes(r.status)).length}
                  </p>
                </div>
                <div className="p-3 bg-white/20 rounded-lg">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Navigation Cards - Destinatarios and Remesas */}
        {userRole !== 'admin' && userRole !== 'super_admin' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {/* Mis Destinatarios Card */}
            <button
              onClick={() => onNavigate('recipients')}
              className="p-6 rounded-xl border-2 transition-all hover:shadow-lg hover:border-blue-400 text-left bg-white"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-lg bg-blue-100">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <ArrowRight className="h-5 w-5" style={{ color: visualSettings.primaryColor }} />
              </div>
              <h3 className="font-semibold text-lg mb-1" style={getTextStyle(visualSettings, 'primary')}>
                {language === 'es' ? 'Mis Destinatarios' : 'My Recipients'}
              </h3>
              <p className="text-sm" style={getTextStyle(visualSettings, 'secondary')}>
                {language === 'es' ? 'Administra tus contactos de entrega' : 'Manage your delivery contacts'}
              </p>
            </button>

            {/* Mis Remesas Card */}
            <button
              onClick={() => onNavigate('my-remittances')}
              className="p-6 rounded-xl border-2 transition-all hover:shadow-lg hover:border-green-400 text-left bg-white"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-lg bg-green-100">
                  <Send className="h-6 w-6 text-green-600" />
                </div>
                <ArrowRight className="h-5 w-5" style={{ color: visualSettings.secondaryColor }} />
              </div>
              <h3 className="font-semibold text-lg mb-1" style={getTextStyle(visualSettings, 'primary')}>
                {language === 'es' ? 'Mis Remesas' : 'My Remittances'}
              </h3>
              <p className="text-sm" style={getTextStyle(visualSettings, 'secondary')}>
                {language === 'es' ? 'Consulta el estado de tus envíos' : 'Check your remittance status'}
              </p>
            </button>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-8 rounded-2xl bg-white shadow-lg border border-gray-200"
        >
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold flex items-center" style={getTextStyle(visualSettings, 'primary')}>
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
                {(userRole === 'admin' || userRole === 'super_admin')
                  ? (language === 'es' ? 'Pedidos Pendientes' : 'Pending Orders')
                  : t('userPanel.myOrders')
                }
              </h2>

              {/* WhatsApp Contact Button (Regular users only) - Top Right */}
              {userRole !== 'admin' && userRole !== 'super_admin' && whatsappContact && (
                <Button
                  size="default"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    const message = language === 'es'
                      ? `Hola! Soy ${displayName}. Necesito ayuda con mis pedidos.`
                      : `Hello! I'm ${displayName}. I need help with my orders.`;
                    window.open(generateWhatsAppURL(whatsappContact, message), '_blank', 'noopener,noreferrer');
                  }}
                  title={language === 'es' ? 'Contactar por WhatsApp' : 'Contact via WhatsApp'}
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  {language === 'es' ? 'Contactar' : 'Contact'}
                </Button>
              )}
            </div>

            {/* Toggle para ocultar/mostrar pedidos finalizados - Solo para usuarios regulares */}
            {userRole !== 'admin' && userRole !== 'super_admin' && orders.length > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" style={{ color: visualSettings.primaryColor }} />
                  <span className="text-sm font-medium" style={getTextStyle(visualSettings, 'secondary')}>
                    {language === 'es' ? 'Filtrar pedidos' : 'Filter orders'}
                  </span>
                </div>
                <button
                  onClick={() => setHideCompletedOrders(!hideCompletedOrders)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    hideCompletedOrders
                      ? 'bg-blue-100 text-blue-700 border border-blue-300'
                      : 'bg-gray-200 text-gray-600 border border-gray-300'
                  }`}
                >
                  {hideCompletedOrders ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      {language === 'es' ? 'Ocultos: Completados/Cancelados' : 'Hidden: Completed/Cancelled'}
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      {language === 'es' ? 'Mostrando todos' : 'Showing all'}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: visualSettings.primaryColor }} />
            </div>
          ) : filteredOrders.length > 0 ? (
            <div className="space-y-4" ref={ordersContainerRef}>
              {/* Contador de órdenes */}
              <div className="flex items-center justify-between text-sm" style={getTextStyle(visualSettings, 'muted')}>
                <span>
                  {language === 'es'
                    ? `Mostrando ${paginatedOrders.length} de ${filteredOrders.length} pedidos`
                    : `Showing ${paginatedOrders.length} of ${filteredOrders.length} orders`}
                </span>
                {orders.length !== filteredOrders.length && (
                  <span className="text-xs">
                    ({orders.length} {language === 'es' ? 'total' : 'total'})
                  </span>
                )}
              </div>

              {paginatedOrders.map(order => {
                const orderSubtotal = parseFloat(order.subtotal) || 0;
                const orderTotal = parseFloat(order.total_amount) || 0;
                const orderDiscountTotal = parseFloat(order.discount_amount) || 0;
                const categoryPercent = order?.user_category_discount?.enabled === false
                  ? 0
                  : order?.user_category_discount?.discount_percentage ?? (isRegularUser ? categoryDiscountPercent : 0);
                const categoryDiscountAmount = categoryPercent > 0
                  ? parseFloat(((orderSubtotal * categoryPercent) / 100).toFixed(2))
                  : 0;
                const couponDiscountAmount = Math.max(orderDiscountTotal - categoryDiscountAmount, 0);
                const effectiveSubtotal = orderSubtotal || (orderTotal + orderDiscountTotal);
                const showDiscountStrike = orderDiscountTotal > 0 && effectiveSubtotal > 0;

                return (
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
                      {/* Show user info for admin */}
                      {(userRole === 'admin' || userRole === 'super_admin') && order.user_profiles && (
                        <p className="text-sm font-medium mb-1" style={getTextStyle(visualSettings, 'secondary')}>
                          👤 {order.user_profiles.full_name || order.user_profiles.email}
                        </p>
                      )}
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
                      {showDiscountStrike && (
                        <div className="text-xs line-through" style={getTextStyle(visualSettings, 'muted')}>
                          ${effectiveSubtotal.toFixed(2)} {order.currencies?.code || 'USD'}
                        </div>
                      )}
                      <div className="text-lg font-bold mb-1" style={{ color: visualSettings.primaryColor }}>
                        ${orderTotal.toFixed(2)} {order.currencies?.code || 'USD'}
                      </div>
                      <p className="text-xs" style={getTextStyle(visualSettings, 'muted')}>
                        {order.order_items?.length || 0} {language === 'es' ? 'artículos' : 'items'}
                      </p>
                      {orderDiscountTotal > 0 && (
                        <div className="mt-2 space-y-1 text-xs font-semibold text-green-600">
                          <div className="flex items-center justify-end gap-1">
                            <TrendingDown className="h-3 w-3" />
                            {language === 'es' ? 'Descuento total' : 'Total discount'} · -${orderDiscountTotal.toFixed(2)} ({derivePercentFromAmount(effectiveSubtotal, orderDiscountTotal).toFixed(1)}%)
                          </div>
                          {categoryDiscountAmount > 0 && (
                            <div className="flex items-center justify-end gap-1 text-[11px] text-emerald-700">
                              <Crown className="h-3 w-3" />
                              {language === 'es' ? 'Categoría' : 'Category'} · -${categoryDiscountAmount.toFixed(2)} ({categoryPercent.toFixed(1)}%)
                            </div>
                          )}
                          {couponDiscountAmount > 0 && (
                            <div className="flex items-center justify-end gap-1 text-[11px] text-emerald-700">
                              <Gift className="h-3 w-3" />
                              {language === 'es' ? 'Cupón' : 'Coupon'} · -${couponDiscountAmount.toFixed(2)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {/* Badges de estado en dos filas para usuarios regulares */}
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        {/* Estado del Pedido */}
                        <div
                          className="px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-medium"
                          style={getStatusStyle(order.status, visualSettings)}
                          title={language === 'es' ? 'Estado del pedido' : 'Order status'}
                        >
                          {order.status === 'completed' && <CheckCircle className="h-3.5 w-3.5" />}
                          {order.status === 'cancelled' && <XCircle className="h-3.5 w-3.5" />}
                          {order.status === 'dispatched' && <Truck className="h-3.5 w-3.5" />}
                          {order.status === 'delivered' && <Package className="h-3.5 w-3.5" />}
                          {order.status === 'processing' && <Clock className="h-3.5 w-3.5" />}
                          {order.status === 'pending' && <Clock className="h-3.5 w-3.5" />}
                          <span>{getOrderStatusLabel(order.status)}</span>
                        </div>

                        {/* Estado del Pago */}
                        <div
                          className="px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-medium"
                          style={getStatusStyle(order.payment_status, visualSettings)}
                          title={language === 'es' ? 'Estado del pago' : 'Payment status'}
                        >
                          <DollarSign className="h-3.5 w-3.5" />
                          <span>{getPaymentStatusLabel(order.payment_status)}</span>
                        </div>
                      </div>

                      {/* Botones de acción */}
                      <div className="flex items-center gap-1">
                        {/* WhatsApp contact button for pending/processing orders (Regular users only) */}
                        {userRole !== 'admin' && userRole !== 'super_admin' && whatsappContact &&
                         (order.payment_status === 'pending' || order.status === 'processing' || order.status === 'pending') && (
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              const orderStatus = getOrderStatusLabel(order.status);
                              const paymentStatus = getPaymentStatusLabel(order.payment_status);
                              const message = language === 'es'
                                ? `Hola! Soy ${displayName}. Tengo una consulta sobre mi pedido ${order.order_number} (Pedido: ${orderStatus}, Pago: ${paymentStatus}, Total: $${parseFloat(order.total_amount).toFixed(2)} ${order.currencies?.code || 'USD'}).`
                                : `Hello! I'm ${displayName}. I have a question about my order ${order.order_number} (Order: ${orderStatus}, Payment: ${paymentStatus}, Total: $${parseFloat(order.total_amount).toFixed(2)} ${order.currencies?.code || 'USD'}).`;
                              window.open(generateWhatsAppURL(whatsappContact, message), '_blank', 'noopener,noreferrer');
                            }}
                            title={language === 'es' ? 'Consultar sobre este pedido' : 'Ask about this order'}
                          >
                            <MessageCircle className="h-3 w-3" />
                          </Button>
                        )}

                        <Button size="sm" variant="ghost">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
                );
              })}

              {/* Botón Cargar Más */}
              {hasMoreOrders && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-2 pt-4"
                >
                  <Button
                    onClick={handleLoadMoreOrders}
                    disabled={loadingMore}
                    variant="outline"
                    className="w-full max-w-xs"
                    style={{
                      borderColor: visualSettings.primaryColor,
                      color: visualSettings.primaryColor
                    }}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {language === 'es' ? 'Cargando...' : 'Loading...'}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-2" />
                        {language === 'es'
                          ? `Cargar más (${filteredOrders.length - visibleOrdersCount} restantes)`
                          : `Load more (${filteredOrders.length - visibleOrdersCount} remaining)`}
                      </>
                    )}
                  </Button>
                  <span className="text-xs" style={getTextStyle(visualSettings, 'muted')}>
                    {language === 'es'
                      ? `Página ${Math.ceil(visibleOrdersCount / ORDERS_PER_PAGE)} de ${Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}`
                      : `Page ${Math.ceil(visibleOrdersCount / ORDERS_PER_PAGE)} of ${Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}`}
                  </span>
                </motion.div>
              )}
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

        {/* Testimonials Form (Regular users only) */}
        {userRole !== 'admin' && userRole !== 'super_admin' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-8 rounded-2xl mt-6 bg-white shadow-lg border border-gray-200"
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
                <Star className="h-5 w-5 text-white" />
              </div>
              {language === 'es' ? 'Califica tu Experiencia' : 'Rate Your Experience'}
            </h2>

            <div className="space-y-4">
              {/* Rating Stars */}
              <div>
                <label className="block text-sm font-medium mb-2" style={getTextStyle(visualSettings, 'primary')}>
                  {language === 'es' ? 'Calificación' : 'Rating'}
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="transition-transform hover:scale-110"
                    >
                      <Star
                        className="h-8 w-8"
                        fill={star <= rating ? (visualSettings.primaryColor || '#2563eb') : 'none'}
                        stroke={star <= rating ? (visualSettings.primaryColor || '#2563eb') : '#d1d5db'}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment */}
              <div>
                <label className="block text-sm font-medium mb-2" style={getTextStyle(visualSettings, 'primary')}>
                  {language === 'es' ? 'Comentario (opcional)' : 'Comment (optional)'}
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={language === 'es'
                    ? 'Comparte tu experiencia con nosotros...'
                    : 'Share your experience with us...'}
                  rows={4}
                  className="w-full px-4 py-2 rounded-lg border resize-none"
                  style={{
                    borderColor: visualSettings.borderColor || '#e5e7eb',
                    backgroundColor: visualSettings.inputBgColor || '#ffffff',
                    color: visualSettings.textPrimaryColor || '#1f2937'
                  }}
                />
              </div>

              {/* Status message */}
              {testimonial && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: testimonial.is_visible
                      ? `${visualSettings.successColor || '#10b981'}20`
                      : `${visualSettings.warningColor || '#f59e0b'}20`,
                    color: testimonial.is_visible
                      ? visualSettings.successColor || '#10b981'
                      : visualSettings.warningColor || '#f59e0b'
                  }}
                >
                  {testimonial.is_visible
                    ? (language === 'es' ? '✓ Tu testimonio ha sido publicado' : '✓ Your testimonial has been published')
                    : (language === 'es' ? '⏳ Tu testimonio está pendiente de aprobación' : '⏳ Your testimonial is pending approval')
                  }
                </div>
              )}

              {/* Submit button */}
              <Button
                onClick={handleSaveTestimonial}
                disabled={savingTestimonial || rating === 0}
                className="w-full"
                style={{
                  background: visualSettings.useGradient
                    ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                    : visualSettings.primaryColor || '#2563eb',
                  color: '#ffffff'
                }}
              >
                {savingTestimonial ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {language === 'es' ? 'Guardando...' : 'Saving...'}
                  </>
                ) : (
                  <>
                    <Star className="h-4 w-4 mr-2" />
                    {testimonial
                      ? (language === 'es' ? 'Actualizar Testimonio' : 'Update Testimonial')
                      : (language === 'es' ? 'Enviar Testimonio' : 'Submit Testimonial')
                    }
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
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
                className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 rounded-2xl shadow-2xl bg-white border border-gray-200"
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
                    {/* User Info (Admin only) */}
                    {(userRole === 'admin' || userRole === 'super_admin') && selectedOrder.user_profiles && (
                      <div className="p-4 rounded-lg border" style={{ borderColor: visualSettings.borderColor || '#e5e7eb', backgroundColor: `${visualSettings.primaryColor}10` }}>
                        <h4 className="text-sm font-semibold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                          {language === 'es' ? 'Datos del Cliente' : 'Customer Information'}
                        </h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="font-medium" style={getTextStyle(visualSettings, 'muted')}>
                              {language === 'es' ? 'Nombre:' : 'Name:'}
                            </span>{' '}
                            <span style={getTextStyle(visualSettings, 'primary')}>
                              {selectedOrder.user_profiles.full_name || 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium" style={getTextStyle(visualSettings, 'muted')}>
                              Email:
                            </span>{' '}
                            <span style={getTextStyle(visualSettings, 'primary')}>
                              {selectedOrder.user_profiles.email || 'N/A'}
                            </span>
                          </div>
                          {selectedOrder.shipping_phone && (
                            <div>
                              <span className="font-medium" style={getTextStyle(visualSettings, 'muted')}>
                                {language === 'es' ? 'Teléfono:' : 'Phone:'}
                              </span>{' '}
                              <span style={getTextStyle(visualSettings, 'primary')}>
                                {selectedOrder.shipping_phone}
                              </span>
                            </div>
                          )}
                          {selectedOrder.shipping_address && (
                            <div className="col-span-2">
                              <span className="font-medium" style={getTextStyle(visualSettings, 'muted')}>
                                {language === 'es' ? 'Dirección:' : 'Address:'}
                              </span>{' '}
                              <span style={getTextStyle(visualSettings, 'primary')}>
                                {selectedOrder.shipping_address}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Order Info */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                          {language === 'es' ? 'Estado de la orden' : 'Order status'}
                        </p>
                        <div
                          className="inline-flex px-2 py-1 rounded-full text-xs font-medium"
                          style={getStatusStyle(selectedOrder.status, visualSettings)}
                        >
                          {getOrderStatusLabel(selectedOrder.status)}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium mb-1" style={getTextStyle(visualSettings, 'muted')}>
                          {language === 'es' ? 'Estado del pago' : 'Payment status'}
                        </p>
                        <div
                          className="inline-flex px-2 py-1 rounded-full text-xs font-medium"
                          style={getStatusStyle(selectedOrder.payment_status, visualSettings)}
                        >
                          {getPaymentStatusLabel(selectedOrder.payment_status)}
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
                        <div className="text-right">
                          {isRegularUser && categoryDiscountPercent > 0 ? (
                            <>
                              <div className="text-xs line-through" style={getTextStyle(visualSettings, 'muted')}>
                                ${selectedOrderBaseTotal.toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                              </div>
                              <p className="text-lg font-bold" style={{ color: visualSettings.primaryColor }}>
                                {selectedOrderTotalAfterCategory.toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                              </p>
                            </>
                          ) : (
                            <p className="text-lg font-bold" style={{ color: visualSettings.primaryColor }}>
                              ${parseFloat(selectedOrder.total_amount).toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recipient Details - For regular users */}
                    {isRegularUser && selectedOrderRecipientInfo && (
                      <div className="p-4 rounded-lg border" style={{ borderColor: visualSettings.borderColor || '#e5e7eb', backgroundColor: `${visualSettings.primaryColor}08` }}>
                        <h4 className="text-sm font-semibold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                          {t('adminOrders.detail.recipient')}
                        </h4>
                        <div className="space-y-1 text-sm">
                          <p style={getTextStyle(visualSettings, 'primary')}>
                            <span className="font-medium">{t('common.name')}:</span> {selectedOrderRecipientInfo.fullName || 'N/A'}
                          </p>
                          <p style={getTextStyle(visualSettings, 'primary')}>
                            <span className="font-medium">{t('common.address')}:</span> {selectedOrderRecipientInfo.address || selectedOrder.shipping_address || 'N/A'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Items & Payment Proof - 2 Column Layout */}
                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Left Column: Order Items & Cost */}
                      <div className="space-y-4">

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
                            <div className="flex items-start gap-3">
                              {/* Product Image Placeholder */}
                              <div className="w-16 h-16 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
                                <div className="w-full h-full flex items-center justify-center">
                                  {getItemTypeIcon(item.item_type)}
                                </div>
                              </div>

                              {/* Item Details */}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium mb-1" style={getTextStyle(visualSettings, 'primary')}>
                                  {language === 'es' ? item.item_name_es : item.item_name_en}
                                </p>
                                <div className="flex items-center gap-2 text-xs mb-1" style={getTextStyle(visualSettings, 'muted')}>
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
                                <p className="text-xs" style={getTextStyle(visualSettings, 'muted')}>
                                  ${parseFloat(item.unit_price).toFixed(2)} × {item.quantity}
                                </p>
                              </div>

                              {/* Item Total */}
                              <div className="text-right flex-shrink-0">
                                <p className="text-base font-bold" style={getTextStyle(visualSettings, 'primary')}>
                                  ${parseFloat(item.total_price).toFixed(2)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Cost Breakdown */}
                    <div className="border-t pt-4" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span style={getTextStyle(visualSettings, 'secondary')}>
                            {language === 'es' ? 'Subtotal' : 'Subtotal'}
                          </span>
                          <span className="font-semibold" style={getTextStyle(visualSettings, 'primary')}>
                            ${parseFloat(selectedOrder.subtotal).toFixed(2)}
                          </span>
                        </div>

                        {/* Discount Section - Enhanced for Admins */}
                        {selectedOrderDiscountTotal > 0 && (
                          <div className="p-3 rounded-lg" style={{ backgroundColor: visualSettings.primaryColor ? `${visualSettings.primaryColor}15` : '#dcfce7' }}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <TrendingDown className="h-4 w-4" style={{ color: '#16a34a' }} />
                                <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>
                                  {language === 'es' ? 'Descuento' : 'Discount'} ({derivePercentFromAmount(selectedOrderSubtotal, selectedOrderDiscountTotal).toFixed(1)}%)
                                </span>
                              </div>
                              <span className="font-semibold" style={{ color: '#16a34a' }}>
                                -${selectedOrderDiscountTotal.toFixed(2)}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs font-semibold" style={{ color: '#059669' }}>
                              {selectedOrderCategoryDiscountAmount > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="flex items-center gap-1">
                                    <Crown className="h-3 w-3" />
                                    {language === 'es' ? 'Descuento por categoría' : 'Category discount'} ({selectedOrderCategoryPercent.toFixed(1)}%)
                                  </span>
                                  <span>- ${selectedOrderCategoryDiscountAmount.toFixed(2)}</span>
                                </div>
                              )}
                              {selectedOrderCouponDiscountAmount > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="flex items-center gap-1">
                                    <Gift className="h-3 w-3" />
                                    {language === 'es' ? 'Cupón aplicado' : 'Coupon applied'}
                                  </span>
                                  <span>- ${selectedOrderCouponDiscountAmount.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                            {selectedOrder.offer_info && (
                              <div className="mt-2 pt-2 border-t border-green-200">
                                <p className="text-xs font-medium" style={{ color: '#16a34a' }}>
                                  {language === 'es' ? 'Cupón aplicado:' : 'Coupon applied:'} <code className="font-mono font-bold">{selectedOrder.offer_info.code}</code>
                                </p>
                                {selectedOrder.offer_info.description && (
                                  <p className="text-xs mt-1" style={{ color: '#059669' }}>
                                    {selectedOrder.offer_info.description}
                                  </p>
                                )}
                                <p className="text-xs mt-1" style={{ color: '#059669' }}>
                                  {selectedOrder.offer_info.discount_type === 'percentage'
                                    ? `${selectedOrder.offer_info.discount_value}% ${language === 'es' ? 'de descuento' : 'discount'}`
                                    : `$${selectedOrder.offer_info.discount_value} ${language === 'es' ? 'de descuento' : 'discount'}`
                                  }
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Category Discount Section - Show for Admins */}
                        {(userRole === 'admin' || userRole === 'super_admin') && selectedOrder.user_category_discount && selectedOrder.user_category_discount.enabled && (
                          <div className="p-3 rounded-lg" style={{ backgroundColor: visualSettings.accentColor ? `${visualSettings.accentColor}12` : '#f3e8ff' }}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Crown className="h-4 w-4" style={{ color: '#9333ea' }} />
                                <span className="text-sm font-semibold" style={{ color: '#9333ea' }}>
                                  {language === 'es' ? 'Descuento de Categoría' : 'Category Discount'}
                                </span>
                              </div>
                              <span className="font-semibold" style={{ color: '#9333ea' }}>
                                {selectedOrder.user_category_discount.discount_percentage}%
                              </span>
                            </div>
                            <div className="mt-2 pt-2 border-t border-purple-200">
                              <p className="text-xs font-medium" style={{ color: '#7c3aed' }}>
                                {language === 'es' ? 'Categoría:' : 'Category:'} <span className="font-bold uppercase">{selectedOrder.user_category_discount.category_name}</span>
                              </p>
                              {selectedOrder.user_category_discount.discount_description && (
                                <p className="text-xs mt-1" style={{ color: '#7c3aed' }}>
                                  {selectedOrder.user_category_discount.discount_description}
                                </p>
                              )}
                              <p className="text-xs mt-1 font-semibold" style={{ color: '#7c3aed' }}>
                                {language === 'es' ? 'Ahorro:' : 'Savings:'} -${((parseFloat(selectedOrder.subtotal) * selectedOrder.user_category_discount.discount_percentage) / 100).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between text-sm">
                          <span style={getTextStyle(visualSettings, 'secondary')}>
                            {language === 'es' ? 'Envío' : 'Shipping'}
                          </span>
                          <span className="font-semibold" style={getTextStyle(visualSettings, 'primary')}>
                            {parseFloat(selectedOrder.shipping_cost) === 0
                              ? (language === 'es' ? 'Gratis' : 'Free')
                              : `$${parseFloat(selectedOrder.shipping_cost).toFixed(2)}`
                            }
                          </span>
                        </div>
                        <div className="border-t pt-2 mt-2" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                          <div className="flex justify-between">
                            <span className="text-lg font-bold" style={getTextStyle(visualSettings, 'primary')}>
                              {language === 'es' ? 'Total' : 'Total'}
                            </span>
                            <div className="text-right">
                              {selectedOrderDiscountTotal > 0 && selectedOrderSubtotal > 0 && (
                                <div className="text-xs line-through" style={getTextStyle(visualSettings, 'muted')}>
                                  ${selectedOrderSubtotal.toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                                </div>
                              )}
                              <span className="text-xl font-bold" style={{ color: visualSettings.primaryColor }}>
                                ${selectedOrderTotal.toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                      </div>

                      {/* Right Column: Payment Proof */}
                      <div>
                        {selectedOrder.payment_proof_url ? (
                          <div className="sticky top-4">
                            <h4 className="text-lg font-semibold mb-3" style={getTextStyle(visualSettings, 'primary')}>
                              {language === 'es' ? 'Comprobante de Pago' : 'Payment Proof'}
                            </h4>
                            <div
                              className="rounded-lg border overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                              style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                              onClick={() => window.open(selectedOrder.payment_proof_url, '_blank')}
                            >
                              <img
                                src={selectedOrder.payment_proof_url}
                                alt="Payment proof"
                                className="w-full h-auto object-contain max-h-[600px] bg-gray-50"
                                onError={(e) => {
                                  console.error('[UserPanel] Error loading payment proof image:', selectedOrder.payment_proof_url);
                                  e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="%23f3f4f6" width="400" height="300"/><text x="50%" y="50%" font-family="Arial" font-size="16" fill="%236b7280" text-anchor="middle">Error al cargar imagen</text></svg>';
                                }}
                              />
                            </div>
                            <p className="text-xs text-center mt-2" style={getTextStyle(visualSettings, 'muted')}>
                              {language === 'es' ? 'Click para ver en tamaño completo' : 'Click to view full size'}
                            </p>
                          </div>
                        ) : (
                          <div className="sticky top-4 p-6 rounded-lg border-2 border-dashed text-center" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                            <p className="text-sm" style={getTextStyle(visualSettings, 'muted')}>
                              {language === 'es' ? 'Sin comprobante de pago' : 'No payment proof'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

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

                    {/* User actions: cancel pending order */}
                    {isRegularUser && selectedOrder.status === 'pending' && selectedOrder.payment_status === 'pending' && (
                      <div className="flex gap-3 pt-4 border-t" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                        <Button
                          onClick={() => handleCancelOrderUser(selectedOrder.id)}
                          disabled={processingAction}
                          variant="destructive"
                          className="flex-1"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          {language === 'es' ? 'Cancelar pedido' : 'Cancel order'}
                        </Button>
                      </div>
                    )}

                    {/* User actions: retry payment proof after rejection */}
                    {isRegularUser && selectedOrder.payment_status === 'rejected' && selectedOrder.status === 'pending' && (
                      <div className="mt-4 p-4 rounded-lg border" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                        <p className="font-semibold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                          {language === 'es' ? 'Subir nuevo comprobante de pago' : 'Upload new payment proof'}
                        </p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setRetryProofFile(e.target.files?.[0] || null)}
                          className="mb-3"
                        />
                        <Button
                          onClick={handleRetryPaymentProof}
                          disabled={processingAction || !retryProofFile}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {processingAction ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                          {language === 'es' ? 'Reintentar pago' : 'Retry payment'}
                        </Button>
                      </div>
                    )}

                    {/* User actions: reopen cancelled order */}
                    {isRegularUser && selectedOrder.status === 'cancelled' && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 p-5 rounded-xl border-2 shadow-sm"
                        style={{
                          borderColor: visualSettings.primaryColor || '#3b82f6',
                          backgroundColor: `${visualSettings.primaryColor}10` || '#eff6ff'
                        }}
                      >
                        <div className="flex items-start gap-3 mb-4">
                          <div
                            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: `${visualSettings.primaryColor}20` || '#dbeafe' }}
                          >
                            <XCircle className="h-5 w-5 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <p className="font-bold text-red-600 mb-1.5 text-base">
                              {t('userPanel.orderCancelled')}
                            </p>
                            <p className="text-sm leading-relaxed" style={getTextStyle(visualSettings, 'secondary')}>
                              {t('userPanel.orderCancelledMessage')}
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => handleReopenOrder(selectedOrder.id)}
                          disabled={processingAction}
                          className="w-full font-semibold transition-all hover:shadow-md"
                          style={{
                            backgroundColor: visualSettings.primaryColor || '#3b82f6',
                            opacity: processingAction ? 0.7 : 1
                          }}
                        >
                          {processingAction ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Package className="h-4 w-4 mr-2" />
                          )}
                          {t('userPanel.reopenOrderButton')}
                        </Button>
                      </motion.div>
                    )}

                    {/* Admin Action Buttons */}
                    {(userRole === 'admin' || userRole === 'super_admin') && ['pending', 'proof_uploaded'].includes(selectedOrder.payment_status) && (
                      <div className="flex gap-3 pt-4 border-t" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                        <Button
                          onClick={() => handleValidatePayment(selectedOrder.id)}
                          disabled={loadingDetails}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          {language === 'es' ? 'Validar Pago' : 'Validate Payment'}
                        </Button>
                        <Button
                          onClick={() => handleRejectPayment(selectedOrder.id)}
                          disabled={loadingDetails}
                          variant="destructive"
                          className="flex-1"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          {language === 'es' ? 'Rechazar' : 'Reject'}
                        </Button>
                      </div>
                    )}

                    {(userRole === 'admin' || userRole === 'super_admin') && selectedOrder.status === 'processing' && (
                      <div className="mt-4 p-4 rounded-lg border" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                        <p className="font-semibold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                          {language === 'es' ? 'Marcar como despachado' : 'Mark as dispatched'}
                        </p>
                        <input
                          value={trackingInfo}
                          onChange={(e) => setTrackingInfo(e.target.value)}
                          placeholder={language === 'es' ? 'Información de tracking (opcional)' : 'Tracking info (optional)'}
                          className="w-full p-3 border rounded-lg mb-3"
                          style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
                        />
                        <Button
                          onClick={handleMarkDispatched}
                          disabled={processingAction}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {processingAction ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Truck className="h-4 w-4 mr-2" />}
                          {language === 'es' ? 'Despachar pedido' : 'Dispatch order'}
                        </Button>
                      </div>
                    )}

                    {(userRole === 'admin' || userRole === 'super_admin') && selectedOrder.status === 'dispatched' && (
                      <div className="mt-4 p-4 rounded-lg border" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                        <p className="font-semibold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                          {language === 'es' ? 'Confirmar entrega' : 'Confirm delivery'}
                        </p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setDeliveryProofFile(e.target.files?.[0] || null)}
                          className="mb-3"
                        />
                        <Button
                          onClick={handleMarkDelivered}
                          disabled={processingAction || !deliveryProofFile}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          {processingAction ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                          {language === 'es' ? 'Marcar como entregado' : 'Mark delivered'}
                        </Button>
                      </div>
                    )}

                    {(userRole === 'admin' || userRole === 'super_admin') && selectedOrder.status === 'delivered' && (
                      <div className="mt-4 p-4 rounded-lg border" style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}>
                        <p className="font-semibold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                          {language === 'es' ? 'Completar pedido' : 'Complete order'}
                        </p>
                        <Button
                          onClick={handleCompleteOrder}
                          disabled={processingAction}
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                          {processingAction ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                          {language === 'es' ? 'Completar' : 'Complete'}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Validate Payment Modal */}
      <AnimatePresence>
        {showValidateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowValidateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                  {language === 'es' ? '¿Validar Pago?' : 'Validate Payment?'}
                </h3>
                <p className="text-gray-600">
                  {language === 'es'
                    ? 'Esto aprobará el pedido y actualizará el inventario'
                    : 'This will approve the order and update inventory'}
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => setShowValidateModal(false)}
                  variant="outline"
                  className="flex-1"
                  disabled={loadingDetails}
                >
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </Button>
                <Button
                  onClick={confirmValidatePayment}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  disabled={loadingDetails}
                >
                  {loadingDetails ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  {language === 'es' ? 'Confirmar' : 'Confirm'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject Payment Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowRejectModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
                <h3 className="text-2xl font-bold mb-2" style={getTextStyle(visualSettings, 'primary')}>
                  {language === 'es' ? 'Rechazar Pago' : 'Reject Payment'}
                </h3>
                <p className="text-gray-600 mb-4">
                  {language === 'es'
                    ? 'Por favor indica el motivo del rechazo'
                    : 'Please indicate the reason for rejection'}
                </p>
              </div>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder={language === 'es' ? 'Motivo del rechazo...' : 'Rejection reason...'}
                className="w-full p-3 border rounded-lg mb-4 min-h-[100px] focus:ring-2 focus:ring-red-500 focus:border-transparent"
                style={{ borderColor: visualSettings.borderColor || '#e5e7eb' }}
              />
              <div className="flex gap-3">
                <Button
                  onClick={() => setShowRejectModal(false)}
                  variant="outline"
                  className="flex-1"
                  disabled={loadingDetails}
                >
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </Button>
                <Button
                  onClick={confirmRejectPayment}
                  variant="destructive"
                  className="flex-1"
                  disabled={loadingDetails || !rejectionReason.trim()}
                >
                  {loadingDetails ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                  {language === 'es' ? 'Rechazar' : 'Reject'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UserPanel;