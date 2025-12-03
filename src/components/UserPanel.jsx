import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { ShoppingBag, Clock, CheckCircle, XCircle, Package, DollarSign, Loader2, X, Eye, MessageCircle, Star, FileText, Send, ArrowRight, Users, Crown, TrendingDown, Gift } from 'lucide-react';
import { getUserOrders, getOrderById, getAllOrders, validatePayment, rejectPayment } from '@/lib/orderService';
import { getUserTestimonial, createTestimonial, updateTestimonial } from '@/lib/testimonialService';
import { getMyRemittances } from '@/lib/remittanceService';
import { getUserCategory } from '@/lib/userCategorizationService';
import { getHeadingStyle, getTextStyle, getPillStyle, getStatusStyle } from '@/lib/styleUtils';
import { generateWhatsAppURL } from '@/lib/whatsappService';
import { Button } from '@/components/ui/button';
import CategoryBadge from '@/components/CategoryBadge';

const UserPanel = ({ onNavigate }) => {
  const { user, userRole } = useAuth();
  const { t, language } = useLanguage();
  const { visualSettings, businessInfo } = useBusiness();
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
  const [userCategory, setUserCategory] = useState(null);

  const loadUserCategory = async () => {
    if (!user?.id || userRole === 'admin' || userRole === 'super_admin') return;

    try {
      const category = await getUserCategory(user.id);
      if (category) {
        setUserCategory(category);
      }
    } catch (error) {
      console.error('Error loading user category:', error);
    }
  };

  useEffect(() => {
    if (!user) {
      onNavigate('login');
      return;
    }

    loadUserOrders();
    loadUserRemittances();
    loadUserCategory();

    // Load user testimonial only for regular users
    if (userRole !== 'admin' && userRole !== 'super_admin') {
      loadUserTestimonial();
    }
  }, [user, userRole]);

  const loadUserTestimonial = async () => {
    if (!user?.id) return;

    try {
      const result = await getUserTestimonial(user.id);
      if (result.data) {
        setTestimonial(result.data);
        setRating(result.data.rating);
        setComment(result.data.comment || '');
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
      // Admin/super_admin see all pending orders, regular users see their own orders
      if (userRole === 'admin' || userRole === 'super_admin') {
        console.log('[UserPanel] Loading pending orders for admin');
        const orders = await getAllOrders({ payment_status: 'pending' });
        console.log('[UserPanel] Admin orders result:', orders);
        setOrders(orders || []);
      } else {
        console.log('[UserPanel] Loading user orders for regular user');
        const result = await getUserOrders(user.id);
        console.log('[UserPanel] User orders result:', result);
        if (result.success) {
          setOrders(result.orders);
        }
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserRemittances = async () => {
    if (!user?.id) return;

    try {
      const result = await getMyRemittances();
      if (result.success) {
        setRemittances(result.remittances || []);
      }
    } catch (error) {
      console.error('Error loading remittances:', error);
    }
  };

  const handleOrderClick = async (orderId) => {
    setLoadingDetails(true);
    setShowOrderDetails(true);

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
      if (result.success) {
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
      if (result.success) {
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
        {businessInfo?.whatsapp && (
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
                  window.open(generateWhatsAppURL(businessInfo.whatsapp, message), '_blank');
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
          <div className="flex items-center justify-between mb-6">
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
            {userRole !== 'admin' && userRole !== 'super_admin' && businessInfo?.whatsapp && (
              <Button
                size="default"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const message = language === 'es'
                    ? `Hola! Soy ${displayName}. Necesito ayuda con mis pedidos.`
                    : `Hello! I'm ${displayName}. I need help with my orders.`;
                  window.open(generateWhatsAppURL(businessInfo.whatsapp, message), '_blank', 'noopener,noreferrer');
                }}
                title={language === 'es' ? 'Contactar por WhatsApp' : 'Contact via WhatsApp'}
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                {language === 'es' ? 'Contactar' : 'Contact'}
              </Button>
            )}
          </div>

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
                      <div className="text-lg font-bold mb-1" style={{ color: visualSettings.primaryColor }}>
                        ${parseFloat(order.total_amount).toFixed(2)} {order.currencies?.code || 'USD'}
                      </div>
                      <p className="text-xs" style={getTextStyle(visualSettings, 'muted')}>
                        {order.order_items?.length || 0} {language === 'es' ? 'artículos' : 'items'}
                      </p>
                      {order.discount_amount > 0 && (
                        <div className="mt-2 flex items-center justify-end gap-1 text-xs font-semibold text-green-600">
                          <TrendingDown className="h-3 w-3" />
                          {language === 'es' ? 'Descuento' : 'Discount'}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className="px-3 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium"
                        style={getStatusStyle(order.payment_status || order.status, visualSettings)}
                      >
                        {getStatusIcon(order.status, order.payment_status)}
                        <span>{getStatusText(order.status, order.payment_status)}</span>
                      </div>

                      {/* WhatsApp contact button for pending/processing orders (Regular users only) */}
                      {userRole !== 'admin' && userRole !== 'super_admin' && businessInfo?.whatsapp &&
                       (order.payment_status === 'pending' || order.status === 'processing' || order.status === 'pending') && (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            const orderStatus = getStatusText(order.status, order.payment_status);
                            const message = language === 'es'
                              ? `Hola! Soy ${displayName}. Tengo una consulta sobre mi pedido ${order.order_number} (Estado: ${orderStatus}, Total: $${parseFloat(order.total_amount).toFixed(2)} ${order.currencies?.code || 'USD'}).`
                              : `Hello! I'm ${displayName}. I have a question about my order ${order.order_number} (Status: ${orderStatus}, Total: $${parseFloat(order.total_amount).toFixed(2)} ${order.currencies?.code || 'USD'}).`;
                            window.open(generateWhatsAppURL(businessInfo.whatsapp, message), '_blank', 'noopener,noreferrer');
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

                        {/* Discount Section */}
                        {selectedOrder.discount_amount > 0 && (
                          <div className="p-3 rounded-lg" style={{ backgroundColor: visualSettings.primaryColor ? `${visualSettings.primaryColor}15` : '#dcfce7' }}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <TrendingDown className="h-4 w-4" style={{ color: '#16a34a' }} />
                                <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>
                                  {language === 'es' ? 'Descuento' : 'Discount'}
                                </span>
                              </div>
                              <span className="font-semibold" style={{ color: '#16a34a' }}>
                                -${parseFloat(selectedOrder.discount_amount).toFixed(2)}
                              </span>
                            </div>
                            {selectedOrder.offer_code && (
                              <p className="text-xs mt-2" style={{ color: '#16a34a' }}>
                                {language === 'es' ? 'Cupón:' : 'Coupon:'} <code className="font-mono font-bold">{selectedOrder.offer_code}</code>
                              </p>
                            )}
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
                            <span className="text-xl font-bold" style={{ color: visualSettings.primaryColor }}>
                              ${parseFloat(selectedOrder.total_amount).toFixed(2)} {selectedOrder.currencies?.code || 'USD'}
                            </span>
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

                    {/* Admin Action Buttons */}
                    {(userRole === 'admin' || userRole === 'super_admin') && selectedOrder.payment_status === 'pending' && (
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