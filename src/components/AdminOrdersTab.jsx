/**
 * Admin Orders Tab Component
 * Complete orders management with advanced filtering
 * Filters: Date range, Status, Payment Status, User, Product, Order Type
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  ShoppingBag,
  DollarSign,
  Filter,
  Search,
  Calendar,
  User,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  Truck,
  Camera,
  Check,
  Ban,
  Image as ImageIcon
} from 'lucide-react';
import {
  getAllOrders,
  startProcessingOrder,
  markOrderAsShipped,
  markOrderAsDelivered,
  completeOrder,
  getDaysInProcessing,
  cancelOrder
} from '@/lib/orderService';
import { ORDER_STATUS, PAYMENT_STATUS, ITEM_TYPES } from '@/lib/constants';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';

// Helper functions
const getStatusText = (status, paymentStatus, language = 'es') => {
  if (paymentStatus === PAYMENT_STATUS.VALIDATED) {
    return language === 'es' ? 'Validado' : 'Validated';
  }
  if (paymentStatus === PAYMENT_STATUS.REJECTED) {
    return language === 'es' ? 'Rechazado' : 'Rejected';
  }
  if (paymentStatus === PAYMENT_STATUS.PENDING) {
    return language === 'es' ? 'Pendiente' : 'Pending';
  }
  if (status === ORDER_STATUS.PROCESSING) {
    return language === 'es' ? 'En proceso' : 'Processing';
  }
  if (status === ORDER_STATUS.COMPLETED) {
    return language === 'es' ? 'Completado' : 'Completed';
  }
  return language === 'es' ? 'Pendiente' : 'Pending';
};

const getStatusIcon = (status, paymentStatus) => {
  if (paymentStatus === PAYMENT_STATUS.VALIDATED || status === ORDER_STATUS.COMPLETED) {
    return <CheckCircle className="h-4 w-4" />;
  }
  if (paymentStatus === PAYMENT_STATUS.REJECTED || status === ORDER_STATUS.CANCELLED) {
    return <XCircle className="h-4 w-4" />;
  }
  return <Clock className="h-4 w-4" />;
};

const AdminOrdersTab = () => {
  const { t } = useLanguage();
  const { user } = useAuth();

  // State
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // Track which order is being processed

  // Filter state
  const [filters, setFilters] = useState({
    searchQuery: '',           // Search by order number, user name, or product name
    combined_status: '',       // Unified status filter (payment + order status)
    order_type: '',            // Order type filter
    startDate: '',             // Start date for range
    endDate: '',               // End date for range
    userId: '',                // Filter by specific user (future enhancement)
    productId: ''              // Filter by specific product (future enhancement)
  });

  const [showFilters, setShowFilters] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);

  // Delivery proof modal state
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryProofFile, setDeliveryProofFile] = useState(null);
  const [deliveryProofPreview, setDeliveryProofPreview] = useState(null);

  // Custom modal states
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });
  const [inputModal, setInputModal] = useState({ show: false, title: '', message: '', defaultValue: '', onConfirm: null });
  const [toastMessage, setToastMessage] = useState(null);

  // Load orders
  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    setError(null);

    try {
      // Convert combined_status to API filters
      const apiFilters = {};

      if (filters.combined_status) {
        switch (filters.combined_status) {
          case 'payment_pending':
            apiFilters.payment_status = PAYMENT_STATUS.PENDING;
            break;
          case 'payment_validated':
            apiFilters.payment_status = PAYMENT_STATUS.VALIDATED;
            apiFilters.status = ORDER_STATUS.PENDING;
            break;
          case 'processing':
            apiFilters.status = ORDER_STATUS.PROCESSING;
            break;
          case 'shipped':
            apiFilters.status = ORDER_STATUS.SHIPPED;
            break;
          case 'delivered':
            apiFilters.status = ORDER_STATUS.DELIVERED;
            break;
          case 'completed':
            apiFilters.status = ORDER_STATUS.COMPLETED;
            break;
          case 'cancelled':
            apiFilters.status = ORDER_STATUS.CANCELLED;
            break;
          case 'rejected':
            apiFilters.payment_status = PAYMENT_STATUS.REJECTED;
            break;
        }
      }

      if (filters.order_type) apiFilters.order_type = filters.order_type;

      const result = await getAllOrders(apiFilters);

      if (result.success) {
        setOrders(result.orders || []);
      } else {
        setError(result.error || 'Error loading orders');
      }
    } catch (err) {
      console.error('Error loading orders:', err);
      setError('Error loading orders');
    } finally {
      setLoading(false);
    }
  };

  // Apply client-side filters (search, date range, user, product)
  const filteredOrders = useMemo(() => {
    let filtered = [...orders];

    // Search filter (order number, user name, product names)
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(order => {
        const orderNumber = order.order_number?.toLowerCase() || '';
        const userName = order.user_name?.toLowerCase() || '';
        const userEmail = order.user_email?.toLowerCase() || '';

        // Search in product names
        const productNames = order.order_items?.map(item =>
          (item.item_name_es || '').toLowerCase()
        ).join(' ') || '';

        return orderNumber.includes(query) ||
               userName.includes(query) ||
               userEmail.includes(query) ||
               productNames.includes(query);
      });
    }

    // Date range filter
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      startDate.setHours(0, 0, 0, 0);
      filtered = filtered.filter(order => {
        const orderDate = new Date(order.created_at);
        return orderDate >= startDate;
      });
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(order => {
        const orderDate = new Date(order.created_at);
        return orderDate <= endDate;
      });
    }

    // User ID filter (if needed in future)
    if (filters.userId) {
      filtered = filtered.filter(order => order.user_id === filters.userId);
    }

    // Product ID filter (if needed in future)
    if (filters.productId) {
      filtered = filtered.filter(order => {
        return order.order_items?.some(item => item.item_id === filters.productId);
      });
    }

    return filtered;
  }, [orders, filters]);

  // Statistics
  const stats = useMemo(() => {
    return {
      total: filteredOrders.length,
      pending: filteredOrders.filter(o => o.payment_status === PAYMENT_STATUS.PENDING).length,
      validated: filteredOrders.filter(o => o.payment_status === PAYMENT_STATUS.VALIDATED).length,
      rejected: filteredOrders.filter(o => o.payment_status === PAYMENT_STATUS.REJECTED).length,
      completed: filteredOrders.filter(o => o.status === ORDER_STATUS.COMPLETED).length,
      totalRevenue: filteredOrders
        .filter(o => o.payment_status === PAYMENT_STATUS.VALIDATED)
        .reduce((sum, o) => sum + (o.total_amount || 0), 0)
    };
  }, [filteredOrders]);

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      searchQuery: '',
      combined_status: '',
      order_type: '',
      startDate: '',
      endDate: '',
      userId: '',
      productId: ''
    });
    loadOrders(); // Reload without filters
  };

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));

    // If it's an API filter (status, payment_status, order_type), reload
    if (['status', 'payment_status', 'order_type'].includes(key)) {
      // Debounce could be added here
    }
  };

  // Apply API filters (reload data)
  const applyApiFilters = () => {
    loadOrders();
  };

  // View order details
  const viewOrderDetails = (order) => {
    setSelectedOrder(order);
    setShowOrderModal(true);
  };

  // Handler: Start Processing Order
  const handleStartProcessing = async (order) => {
    showConfirm(
      t('adminOrders.modals.startTitle'),
      t('adminOrders.messages.confirmStart').replace('{orderNumber}', order.order_number),
      async () => {
        setActionLoading(order.id);
        try {
          const result = await startProcessingOrder(order.id, user.id);
          if (result.success) {
            showToast(t('adminOrders.messages.startSuccess'), 'success');
            loadOrders(); // Refresh orders
          } else {
            showToast(`${t('adminOrders.messages.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error starting processing:', err);
          showToast(t('adminOrders.messages.error'), 'error');
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  // Handler: Mark Order as Shipped
  const handleMarkAsShipped = async (order) => {
    showInput(
      t('adminOrders.modals.trackingTitle'),
      t('adminOrders.messages.enterTracking').replace('{orderNumber}', order.order_number),
      '',
      async (trackingInfo) => {
        setActionLoading(order.id);
        try {
          const result = await markOrderAsShipped(order.id, user.id, trackingInfo);
          if (result.success) {
            showToast(t('adminOrders.messages.shipSuccess'), 'success');
            loadOrders(); // Refresh orders
          } else {
            showToast(`${t('adminOrders.messages.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error marking as shipped:', err);
          showToast(t('adminOrders.messages.error'), 'error');
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  // Handler: Upload Delivery Proof
  const handleUploadDeliveryProof = (order) => {
    setSelectedOrder(order);
    setShowDeliveryModal(true);
  };

  const handleDeliveryProofFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      showToast(t('adminOrders.messages.invalidImage'), 'error');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast(t('adminOrders.messages.imageTooLarge'), 'error');
      return;
    }

    setDeliveryProofFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setDeliveryProofPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitDeliveryProof = async () => {
    if (!deliveryProofFile || !selectedOrder) {
      showToast(t('adminOrders.messages.selectImage'), 'error');
      return;
    }

    setActionLoading(selectedOrder.id);
    try {
      const result = await markOrderAsDelivered(selectedOrder.id, deliveryProofFile, user.id);
      if (result.success) {
        showToast(t('adminOrders.messages.deliverSuccess'), 'success');
        setShowDeliveryModal(false);
        setDeliveryProofFile(null);
        setDeliveryProofPreview(null);
        setSelectedOrder(null);
        loadOrders(); // Refresh orders
      } else {
        showToast(`${t('adminOrders.messages.error')}: ${result.error}`, 'error');
      }
    } catch (err) {
      console.error('Error uploading delivery proof:', err);
      showToast(t('adminOrders.messages.error'), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Handler: Complete Order
  const handleCompleteOrder = async (order) => {
    showConfirm(
      t('adminOrders.modals.completeTitle'),
      t('adminOrders.messages.confirmComplete').replace('{orderNumber}', order.order_number),
      async () => {
        setActionLoading(order.id);
        try {
          const result = await completeOrder(order.id);
          if (result.success) {
            showToast(t('adminOrders.messages.completeSuccess'), 'success');
            loadOrders(); // Refresh orders
          } else {
            showToast(`${t('adminOrders.messages.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error completing order:', err);
          showToast(t('adminOrders.messages.error'), 'error');
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  // Handler: Cancel Order
  const handleCancelOrder = async (order) => {
    showInput(
      t('adminOrders.modals.cancelReasonTitle'),
      t('adminOrders.messages.enterCancelReason').replace('{orderNumber}', order.order_number),
      '',
      async (reason) => {
        if (!reason || reason.trim() === '') {
          showToast(t('adminOrders.messages.cancelReasonRequired'), 'error');
          return;
        }

        showConfirm(
          t('adminOrders.modals.cancelTitle'),
          t('adminOrders.messages.confirmCancel'),
          async () => {
            setActionLoading(order.id);
            try {
              const result = await cancelOrder(order.id, user.id, reason);
              if (result.success) {
                showToast(t('adminOrders.messages.cancelSuccess'), 'success');
                loadOrders(); // Refresh orders
              } else {
                showToast(`${t('adminOrders.messages.error')}: ${result.error}`, 'error');
              }
            } catch (err) {
              console.error('Error cancelling order:', err);
              showToast(t('adminOrders.messages.error'), 'error');
            } finally {
              setActionLoading(null);
            }
          }
        );
      }
    );
  };

  // Helper functions for custom modals
  const showConfirm = (title, message, onConfirm) => {
    setConfirmModal({ show: true, title, message, onConfirm });
  };

  const hideConfirm = () => {
    setConfirmModal({ show: false, title: '', message: '', onConfirm: null });
  };

  const showInput = (title, message, defaultValue, onConfirm) => {
    setInputModal({ show: true, title, message, defaultValue, onConfirm });
  };

  const hideInput = () => {
    setInputModal({ show: false, title: '', message: '', defaultValue: '', onConfirm: null });
  };

  const showToast = (message, type = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format currency
  const formatCurrency = (amount, currencyCode = 'USD') => {
    if (!amount) return '0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {t('adminOrders.title')}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {t('adminOrders.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              showFilters
                ? 'bg-blue-50 border-blue-500 text-blue-700'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            {t('adminOrders.filters.title').replace(' de Búsqueda', '')}
            {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <button
            onClick={loadOrders}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('dashboard.refresh')}
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          label={t('adminOrders.stats.total')}
          value={stats.total}
          icon={FileText}
          color="blue"
        />
        <StatCard
          label={t('adminOrders.stats.pending')}
          value={stats.pending}
          icon={Clock}
          color="yellow"
        />
        <StatCard
          label={t('adminOrders.stats.validated')}
          value={stats.validated}
          icon={CheckCircle}
          color="green"
        />
        <StatCard
          label={t('adminOrders.stats.rejected')}
          value={stats.rejected}
          icon={XCircle}
          color="red"
        />
        <StatCard
          label={t('adminOrders.stats.completed')}
          value={stats.completed}
          icon={Package}
          color="purple"
        />
        <StatCard
          label={t('adminOrders.stats.revenue')}
          value={formatCurrency(stats.totalRevenue)}
          icon={DollarSign}
          color="green"
          isAmount
        />
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{t('adminOrders.filters.title')}</h3>
              <button
                onClick={clearFilters}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
              >
                <X className="h-4 w-4" />
                {t('adminOrders.filters.clear')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Search className="h-4 w-4 inline mr-2" />
                  {t('adminOrders.filters.search')}
                </label>
                <input
                  type="text"
                  placeholder={t('adminOrders.filters.searchPlaceholder')}
                  value={filters.searchQuery}
                  onChange={(e) => handleFilterChange('searchQuery', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Combined Status Filter */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('adminOrders.filters.status')}
                </label>
                <select
                  value={filters.combined_status}
                  onChange={(e) => handleFilterChange('combined_status', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('adminOrders.filters.allStatuses')}</option>
                  <option value="payment_pending">🟡 {t('adminOrders.table.paymentStatus.pending')}</option>
                  <option value="payment_validated">✅ {t('adminOrders.table.paymentStatus.validated')}</option>
                  <option value="processing">🔵 {t('adminOrders.table.orderStatus.processing')}</option>
                  <option value="shipped">🟣 {t('adminOrders.table.orderStatus.shipped')}</option>
                  <option value="delivered">🟢 {t('adminOrders.table.orderStatus.delivered')}</option>
                  <option value="completed">✅ {t('adminOrders.table.orderStatus.completed')}</option>
                  <option value="cancelled">❌ {t('adminOrders.table.orderStatus.cancelled')}</option>
                  <option value="rejected">🔴 {t('adminOrders.table.paymentStatus.rejected')}</option>
                </select>
              </div>

              {/* Order Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('adminOrders.filters.orderType')}
                </label>
                <select
                  value={filters.order_type}
                  onChange={(e) => handleFilterChange('order_type', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('adminOrders.filters.allTypes')}</option>
                  <option value="product">{t('adminOrders.types.products')}</option>
                  <option value="remittance">{t('adminOrders.types.remittance')}</option>
                  <option value="mixed">{t('adminOrders.types.mixed')}</option>
                </select>
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Calendar className="h-4 w-4 inline mr-2" />
                  {t('adminOrders.filters.startDate')}
                </label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Calendar className="h-4 w-4 inline mr-2" />
                  {t('adminOrders.filters.endDate')}
                </label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                onClick={applyApiFilters}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('adminOrders.filters.apply')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Orders Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-red-600">
            <XCircle className="h-12 w-12 mb-4" />
            <p>{error}</p>
            <button
              onClick={loadOrders}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {t('adminOrders.messages.retry')}
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Package className="h-12 w-12 mb-4" />
            <p>{t('adminOrders.messages.noOrders')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.order')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.user')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.date')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.type')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.items')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.total')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.paymentStatus.label')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.orderStatus.label')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('adminOrders.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredOrders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onViewDetails={viewOrderDetails}
                    onStartProcessing={handleStartProcessing}
                    onMarkAsShipped={handleMarkAsShipped}
                    onUploadDeliveryProof={handleUploadDeliveryProof}
                    onCompleteOrder={handleCompleteOrder}
                    onCancelOrder={handleCancelOrder}
                    formatDate={formatDate}
                    formatCurrency={formatCurrency}
                    actionLoading={actionLoading}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {showOrderModal && selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          onClose={() => {
            setShowOrderModal(false);
            setSelectedOrder(null);
          }}
          formatDate={formatDate}
          formatCurrency={formatCurrency}
        />
      )}

      {/* Delivery Proof Upload Modal */}
      {showDeliveryModal && selectedOrder && (
        <DeliveryProofModal
          order={selectedOrder}
          onClose={() => {
            setShowDeliveryModal(false);
            setSelectedOrder(null);
            setDeliveryProofFile(null);
            setDeliveryProofPreview(null);
          }}
          onFileChange={handleDeliveryProofFileChange}
          onSubmit={handleSubmitDeliveryProof}
          preview={deliveryProofPreview}
          loading={actionLoading === selectedOrder.id}
          t={t}
        />
      )}

      {/* Custom Confirm Modal */}
      <CustomConfirmModal
        show={confirmModal.show}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={() => {
          if (confirmModal.onConfirm) confirmModal.onConfirm();
          hideConfirm();
        }}
        onCancel={hideConfirm}
        t={t}
      />

      {/* Custom Input Modal */}
      <CustomInputModal
        show={inputModal.show}
        title={inputModal.title}
        message={inputModal.message}
        defaultValue={inputModal.defaultValue}
        onConfirm={(value) => {
          if (inputModal.onConfirm) inputModal.onConfirm(value);
          hideInput();
        }}
        onCancel={hideInput}
        t={t}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <ToastNotification
          message={toastMessage.message}
          type={toastMessage.type}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  );
};

// Stat Card Component
const StatCard = ({ label, value, icon: Icon, color, isAmount }) => {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200'
  };

  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className={`text-2xl font-bold ${isAmount ? 'text-lg' : ''}`}>
        {value}
      </div>
    </div>
  );
};

// Order Row Component
const OrderRow = ({
  order,
  onViewDetails,
  onStartProcessing,
  onMarkAsShipped,
  onUploadDeliveryProof,
  onCompleteOrder,
  onCancelOrder,
  formatDate,
  formatCurrency,
  actionLoading,
  t
}) => {
  // Calculate days in processing
  const daysInProcessing = order.status === ORDER_STATUS.PROCESSING ? getDaysInProcessing(order) : null;

  // Determine action button based on order state
  const renderActionButton = () => {
    const isLoading = actionLoading === order.id;

    // Payment validated and pending - ready to start processing
    if (order.payment_status === PAYMENT_STATUS.VALIDATED && order.status === ORDER_STATUS.PENDING) {
      return (
        <button
          onClick={() => onStartProcessing(order)}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="h-3 w-3" />
          {isLoading ? t('adminOrders.actions.processing') : t('adminOrders.actions.start')}
        </button>
      );
    }

    // Processing - mark as shipped
    if (order.status === ORDER_STATUS.PROCESSING) {
      return (
        <button
          onClick={() => onMarkAsShipped(order)}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Truck className="h-3 w-3" />
          {isLoading ? t('adminOrders.actions.processing') : t('adminOrders.actions.ship')}
        </button>
      );
    }

    // Shipped - upload delivery proof
    if (order.status === ORDER_STATUS.SHIPPED) {
      return (
        <button
          onClick={() => onUploadDeliveryProof(order)}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Camera className="h-3 w-3" />
          {isLoading ? t('adminOrders.actions.loading') : t('adminOrders.actions.proof')}
        </button>
      );
    }

    // Delivered - complete order (or auto-complete)
    if (order.status === ORDER_STATUS.DELIVERED) {
      return (
        <button
          onClick={() => onCompleteOrder(order)}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="h-3 w-3" />
          {isLoading ? t('adminOrders.actions.completing') : t('adminOrders.actions.complete')}
        </button>
      );
    }

    // Completed or Cancelled - no action
    if (order.status === ORDER_STATUS.COMPLETED || order.status === ORDER_STATUS.CANCELLED) {
      return (
        <span className="text-xs text-gray-500 italic">
          {order.status === ORDER_STATUS.COMPLETED ? t('adminOrders.table.orderStatus.completed') : t('adminOrders.table.orderStatus.cancelled')}
        </span>
      );
    }

    // Default - view only
    return <span className="text-xs text-gray-400">-</span>;
  };

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-gray-900">{order.order_number}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">{order.user_name || 'N/A'}</div>
        <div className="text-xs text-gray-500">{order.user_email || ''}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">{formatDate(order.created_at)}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          {order.order_type === 'product' ? <Package className="h-3 w-3" /> :
           order.order_type === 'remittance' ? <DollarSign className="h-3 w-3" /> :
           <ShoppingBag className="h-3 w-3" />}
          {order.order_type === 'product' ? t('adminOrders.types.products') :
           order.order_type === 'remittance' ? t('adminOrders.types.remittance') : t('adminOrders.types.mixed')}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">{order.order_items?.length || 0} items</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-semibold text-gray-900">
          {formatCurrency(order.total_amount, order.currencies?.code)}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
          order.payment_status === PAYMENT_STATUS.VALIDATED
            ? 'bg-green-100 text-green-700'
            : order.payment_status === PAYMENT_STATUS.REJECTED
            ? 'bg-red-100 text-red-700'
            : 'bg-yellow-100 text-yellow-700'
        }`}>
          {getStatusIcon(order.status, order.payment_status)}
          {getStatusText(order.status, order.payment_status, 'es')}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            order.status === ORDER_STATUS.COMPLETED
              ? 'bg-green-100 text-green-700'
              : order.status === ORDER_STATUS.CANCELLED
              ? 'bg-red-100 text-red-700'
              : order.status === ORDER_STATUS.SHIPPED
              ? 'bg-purple-100 text-purple-700'
              : order.status === ORDER_STATUS.DELIVERED
              ? 'bg-teal-100 text-teal-700'
              : 'bg-blue-100 text-blue-700'
          }`}>
            {order.status}
          </span>
          {daysInProcessing !== null && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
              daysInProcessing > 5
                ? 'bg-red-100 text-red-700'
                : daysInProcessing > 3
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              <Clock className="h-3 w-3" />
              {daysInProcessing} {daysInProcessing === 1 ? t('adminOrders.days.singular') : t('adminOrders.days.plural')}
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onViewDetails(order)}
            className="text-blue-600 hover:text-blue-900 inline-flex items-center gap-1"
            title={t('adminOrders.actions.view')}
          >
            <Eye className="h-4 w-4" />
          </button>
          {renderActionButton()}
          {/* Cancel button for non-completed orders */}
          {order.status !== ORDER_STATUS.COMPLETED && order.status !== ORDER_STATUS.CANCELLED && (
            <button
              onClick={() => onCancelOrder(order)}
              disabled={actionLoading === order.id}
              className="text-red-600 hover:text-red-900 disabled:opacity-50"
              title={t('adminOrders.actions.cancel')}
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// Order Details Modal Component
const OrderDetailsModal = ({ order, onClose, formatDate, formatCurrency }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">
            Detalles de Orden: {order.order_number}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
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
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Producto</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Cantidad</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Precio Unit.</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {order.order_items?.map((item, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {item.item_name_es || item.item_name_en}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.quantity}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatCurrency(item.unit_price, order.currencies?.code)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {formatCurrency(item.total_price, order.currencies?.code)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">{formatCurrency(order.subtotal, order.currencies?.code)}</span>
            </div>
            {order.shipping_cost > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Envío:</span>
                <span className="font-medium">{formatCurrency(order.shipping_cost, order.currencies?.code)}</span>
              </div>
            )}
            {order.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Descuento:</span>
                <span className="font-medium">-{formatCurrency(order.discount_amount, order.currencies?.code)}</span>
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

          {/* Payment Proof */}
          {order.payment_proof_url && (
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Comprobante de Pago</h4>
              <img
                src={order.payment_proof_url}
                alt="Comprobante de pago"
                className="max-w-full h-auto rounded-lg border border-gray-200"
              />
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

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// Info Item Component
const InfoItem = ({ label, value }) => (
  <div>
    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</dt>
    <dd className="text-sm text-gray-900 font-medium">{value}</dd>
  </div>
);

// Delivery Proof Modal Component
const DeliveryProofModal = ({ order, onClose, onFileChange, onSubmit, preview, loading, t }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full"
      >
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <h3 className="text-xl font-bold text-gray-900">
            📸 {t('adminOrders.deliveryModal.title')}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={loading}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900">
              <strong>{t('adminOrders.deliveryModal.orderLabel')}</strong> {order.order_number}
            </p>
            <p className="text-sm text-blue-900">
              <strong>{t('adminOrders.deliveryModal.customerLabel')}</strong> {order.user_name}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('adminOrders.deliveryModal.selectPhoto')}
            </label>
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                {preview ? (
                  <img
                    src={preview}
                    alt="Preview"
                    className="max-h-44 rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <ImageIcon className="h-12 w-12 text-gray-400 mb-3" />
                    <p className="mb-2 text-sm text-gray-500">
                      <span className="font-semibold">{t('adminOrders.deliveryModal.clickToUpload')}</span> {t('adminOrders.deliveryModal.dragHere')}
                    </p>
                    <p className="text-xs text-gray-500">{t('adminOrders.deliveryModal.fileTypes')}</p>
                  </div>
                )}
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={onFileChange}
                  disabled={loading}
                />
              </label>
            </div>
          </div>

          {preview && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-700">
                ✅ {t('adminOrders.deliveryModal.imageLoaded')}
              </p>
            </div>
          )}

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-xs text-yellow-800">
              <strong>{t('adminOrders.deliveryModal.note')}</strong> {t('adminOrders.deliveryModal.noteText')}
            </p>
          </div>
        </div>

        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
          >
            {t('adminOrders.deliveryModal.cancel')}
          </button>
          <button
            onClick={onSubmit}
            disabled={loading || !preview}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('adminOrders.deliveryModal.uploading')}
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                {t('adminOrders.deliveryModal.submit')}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// Custom Confirm Modal Component
const CustomConfirmModal = ({ show, title, message, onConfirm, onCancel, t }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 rounded-t-lg">
          <h3 className="text-xl font-bold text-white">{title}</h3>
        </div>

        <div className="p-6">
          <p className="text-gray-700 text-base">{message}</p>
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            {t('adminOrders.modals.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {t('adminOrders.modals.confirm')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// Custom Input Modal Component
const CustomInputModal = ({ show, title, message, defaultValue, onConfirm, onCancel, t }) => {
  const [inputValue, setInputValue] = useState(defaultValue || '');

  useEffect(() => {
    if (show) {
      setInputValue(defaultValue || '');
    }
  }, [show, defaultValue]);

  if (!show) return null;

  const handleSubmit = () => {
    onConfirm(inputValue);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
      >
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4 rounded-t-lg">
          <h3 className="text-xl font-bold text-white">{title}</h3>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-gray-700 text-base">{message}</p>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            autoFocus
          />
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            {t('adminOrders.modals.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            {t('adminOrders.modals.submit')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// Toast Notification Component
const ToastNotification = ({ message, type, onClose }) => {
  if (!message) return null;

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500'
  };

  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️'
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="fixed top-4 right-4 z-50 max-w-md"
    >
      <div className={`${colors[type]} text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3`}>
        <span className="text-2xl">{icons[type]}</span>
        <p className="flex-1 font-medium">{message}</p>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-200 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </motion.div>
  );
};

export default AdminOrdersTab;
