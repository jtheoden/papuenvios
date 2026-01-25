/**
 * Admin Orders Tab Component
 * Complete orders management with advanced filtering and responsive tables
 * Filters: Date range, Status, Payment Status, User, Product, Order Type
 * Uses: ResponsiveTableWrapper, OrderTableConfig, OrderActionButtons
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
  markOrderAsDispatched,
  markOrderAsDelivered,
  completeOrder,
  validatePayment,
  rejectPayment,
  getDaysInProcessing,
  cancelOrder
} from '@/lib/orderService';
import { ORDER_STATUS, PAYMENT_STATUS, ITEM_TYPES } from '@/lib/constants';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useRealtimeOrders } from '@/hooks/useRealtimeSubscription';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import OrderActionButtons from '@/components/admin/OrderActionButtons';
import { getTableColumns, getModalColumns } from '@/components/admin/OrderTableConfig';
import {
  OrderDetailsModal,
  DeliveryProofModal,
  ConfirmDialog,
  InputDialog
} from '@/components/admin/modals';
import ToastNotification from '@/components/ToastNotification';

// Helper functions
const getStatusText = (status, paymentStatus, t) => {
  if (paymentStatus === PAYMENT_STATUS.VALIDATED) {
    return t('adminOrders.stats.validated');
  }
  if (paymentStatus === PAYMENT_STATUS.REJECTED) {
    return t('adminOrders.stats.rejected');
  }
  if (paymentStatus === PAYMENT_STATUS.PROOF_UPLOADED) {
    return t('adminOrders.stats.proofUploaded');
  }
  if (paymentStatus === PAYMENT_STATUS.PENDING) {
    return t('adminOrders.stats.pending');
  }
  if (status === ORDER_STATUS.PROCESSING) {
    return t('adminOrders.table.orderStatus.processing');
  }
  if (status === ORDER_STATUS.COMPLETED) {
    return t('adminOrders.stats.completed');
  }
  return t('adminOrders.stats.pending');
};

const getStatusIcon = (status, paymentStatus) => {
  if (paymentStatus === PAYMENT_STATUS.VALIDATED || status === ORDER_STATUS.COMPLETED) {
    return <CheckCircle className="h-4 w-4" />;
  }
  if (paymentStatus === PAYMENT_STATUS.REJECTED || status === ORDER_STATUS.CANCELLED) {
    return <XCircle className="h-4 w-4" />;
  }
  if (paymentStatus === PAYMENT_STATUS.PROOF_UPLOADED) {
    return <FileText className="h-4 w-4" />;
  }
  return <Clock className="h-4 w-4" />;
};

const AdminOrdersTab = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { visualSettings } = useBusiness();

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

  const operationSucceeded = (result) => result && !result.error;

  // Load orders
  useEffect(() => {
    loadOrders();
  }, []);

  // Req 8: Auto-select order from URL parameter ?id=X
  useEffect(() => {
    if (orders.length === 0) return;

    const urlParams = new URLSearchParams(window.location.search);
    const targetId = urlParams.get('id');

    if (targetId) {
      const target = orders.find(o =>
        o.id === targetId || o.order_number === targetId
      );

      if (target) {
        setSelectedOrder(target);
        setShowOrderModal(true);

        // Clean up URL parameter after navigation
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, [orders]);

  // Real-time subscription for order updates
  useRealtimeOrders({
    enabled: true,
    onUpdate: (payload) => {
      console.log('[Realtime] Order update:', payload.eventType);
      // Reload orders when any change occurs
      loadOrders();
    }
  });

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
          case 'dispatched':
            apiFilters.status = ORDER_STATUS.DISPATCHED;
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

      const orders = await getAllOrders(apiFilters);
      setOrders(orders || []);
    } catch (err) {
      console.error('Error loading orders:', err);
      setError(err?.message || 'Error loading orders');
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

  const handleValidatePayment = async (order) => {
    showConfirm(
      t('adminOrders.modals.validateTitle'),
      t('adminOrders.messages.confirmValidate').replace('{orderNumber}', order.order_number),
      async () => {
        setActionLoading(order.id);
        try {
          const result = await validatePayment(order.id, user.id);
          if (operationSucceeded(result)) {
            showToast(t('adminOrders.messages.validateSuccess'), 'success');
            loadOrders();
          } else {
            showToast(`${t('common.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error validating payment:', err);
          showToast(t('common.error'), 'error');
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  const handleRejectPayment = async (order) => {
    showInput(
      t('adminOrders.modals.rejectTitle'),
      t('adminOrders.messages.enterRejectReason').replace('{orderNumber}', order.order_number),
      '',
      async (reason) => {
        if (!reason || reason.trim() === '') {
          showToast(t('adminOrders.messages.rejectReasonRequired'), 'error');
          return;
        }

        setActionLoading(order.id);
        try {
          const result = await rejectPayment(order.id, user.id, reason.trim());
          if (operationSucceeded(result)) {
            showToast(t('adminOrders.messages.rejectSuccess'), 'success');
            loadOrders();
          } else {
            showToast(`${t('common.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error rejecting payment:', err);
          showToast(t('common.error'), 'error');
        } finally {
          setActionLoading(null);
        }
      }
    );
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
          if (operationSucceeded(result)) {
            showToast(t('adminOrders.messages.startSuccess'), 'success');
            loadOrders(); // Refresh orders
          } else {
            showToast(`${t('common.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error starting processing:', err);
          showToast(t('common.error'), 'error');
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  // Handler: Mark Order as Dispatched
  const handleMarkAsDispatched = async (order) => {
    showInput(
      t('adminOrders.modals.trackingTitle'),
      t('adminOrders.messages.enterTracking').replace('{orderNumber}', order.order_number),
      '',
      async (trackingInfo) => {
        setActionLoading(order.id);
        try {
          const result = await markOrderAsDispatched(order.id, user.id, trackingInfo);
          if (operationSucceeded(result)) {
            showToast(t('adminOrders.messages.dispatchSuccess'), 'success');
            loadOrders(); // Refresh orders
          } else {
            showToast(`${t('common.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error marking as dispatched:', err);
          showToast(t('common.error'), 'error');
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

    // Validate order status - only allow uploading proof for dispatched orders
    if (selectedOrder.status !== 'dispatched') {
      showToast(t('adminOrders.messages.onlyDispatchedOrders'), 'error');
      return;
    }

    setActionLoading(selectedOrder.id);
    try {
      const result = await markOrderAsDelivered(selectedOrder.id, deliveryProofFile, user.id);
      if (operationSucceeded(result)) {
        showToast(t('adminOrders.messages.deliverSuccess'), 'success');
        setShowDeliveryModal(false);
        setDeliveryProofFile(null);
        setDeliveryProofPreview(null);
        setSelectedOrder(null);
        loadOrders(); // Refresh orders
      } else {
        showToast(`${t('common.error')}: ${result.error}`, 'error');
      }
    } catch (err) {
      console.error('Error uploading delivery proof:', err);
      showToast(t('common.error'), 'error');
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
          if (operationSucceeded(result)) {
            showToast(t('adminOrders.messages.completeSuccess'), 'success');
            loadOrders(); // Refresh orders
          } else {
            showToast(`${t('common.error')}: ${result.error}`, 'error');
          }
        } catch (err) {
          console.error('Error completing order:', err);
          showToast(t('common.error'), 'error');
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
              if (operationSucceeded(result)) {
                showToast(t('adminOrders.messages.cancelSuccess'), 'success');
                loadOrders(); // Refresh orders
              } else {
                showToast(`${t('common.error')}: ${result.error}`, 'error');
              }
            } catch (err) {
              console.error('Error cancelling order:', err);
              showToast(t('common.error'), 'error');
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

  // Render order type icon
  const renderTypeIcon = (type) => {
    switch (type) {
      case 'product':
        return <Package className="h-3 w-3" />;
      case 'remittance':
        return <DollarSign className="h-3 w-3" />;
      default:
        return <ShoppingBag className="h-3 w-3" />;
    }
  };

  // Get columns with actions for responsive table
  const columnsWithActions = useMemo(() => {
    const baseColumns = getTableColumns(t, formatDate, formatCurrency, renderTypeIcon);
    // Add actions column at the end
    return [
      ...baseColumns,
      {
        key: 'actions',
        label: t('common.actions'),
        width: '120px',
        render: (value, order) => (
          <OrderActionButtons
            order={order}
            onView={() => viewOrderDetails(order)}
            onValidatePayment={() => handleValidatePayment(order)}
            onRejectPayment={() => handleRejectPayment(order)}
            onStartProcessing={() => handleStartProcessing(order)}
            onMarkAsDispatched={() => handleMarkAsDispatched(order)}
            onUploadDeliveryProof={() => handleUploadDeliveryProof(order)}
            onCompleteOrder={() => handleCompleteOrder(order)}
            onCancelOrder={() => handleCancelOrder(order)}
            actionLoading={actionLoading === order.id}
          />
        )
      }
    ];
  }, [
    t,
    actionLoading,
    viewOrderDetails,
    handleValidatePayment,
    handleRejectPayment,
    handleStartProcessing,
    handleMarkAsDispatched,
    handleUploadDeliveryProof,
    handleCompleteOrder,
    handleCancelOrder,
    formatDate,
    formatCurrency,
    renderTypeIcon
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
            {t('adminOrders.title')}
          </h2>
          <p className="text-sm text-gray-600 mt-1 hidden sm:block">
            {t('adminOrders.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 rounded-lg border transition-colors"
            style={showFilters
              ? { backgroundColor: `${visualSettings?.primaryColor || '#2563eb'}15`, borderColor: visualSettings?.primaryColor || '#2563eb', color: visualSettings?.primaryColor || '#2563eb' }
              : { backgroundColor: '#ffffff', borderColor: '#d1d5db', color: '#374151' }
            }
            title={t('adminOrders.filters.title')}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">{t('adminOrders.filters.title').replace(' de Búsqueda', '')}</span>
            {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <button
            onClick={loadOrders}
            disabled={loading}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={getPrimaryButtonStyle(visualSettings)}
            title={t('dashboard.refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('dashboard.refresh')}</span>
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <option value="payment_pending">{t('adminOrders.table.paymentStatus.pending')}</option>
                  <option value="payment_validated">{t('adminOrders.table.paymentStatus.validated')}</option>
                  <option value="processing">{t('adminOrders.table.orderStatus.processing')}</option>
                  <option value="dispatched">{t('adminOrders.table.orderStatus.dispatched')}</option>
                  <option value="delivered">{t('adminOrders.table.orderStatus.delivered')}</option>
                  <option value="completed">{t('adminOrders.table.orderStatus.completed')}</option>
                  <option value="cancelled">{t('adminOrders.table.orderStatus.cancelled')}</option>
                  <option value="rejected">{t('adminOrders.table.paymentStatus.rejected')}</option>
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
                className="px-6 py-2 rounded-lg transition-colors"
                style={getPrimaryButtonStyle(visualSettings)}
              >
                {t('adminOrders.filters.apply')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Orders Table - Responsive */}
      <ResponsiveTableWrapper
        data={filteredOrders}
        columns={columnsWithActions}
        onRowClick={viewOrderDetails}
        isLoading={loading}
        modalTitle={t('adminOrders.detail.title')}
        modalColumns={getModalColumns(t, formatDate, formatCurrency)}
        emptyMessage={filteredOrders.length === 0 && !loading ? t('adminOrders.messages.noOrders') : undefined}
      />

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

      {/* Confirm Dialog */}
      <ConfirmDialog
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

      {/* Input Dialog */}
      <InputDialog
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


// Modal components extracted to /components/admin/modals/ and imported above

export default AdminOrdersTab;
