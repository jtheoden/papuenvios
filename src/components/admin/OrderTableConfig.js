/**
 * Order Table Column Configuration
 * Shared configuration for responsive table display in AdminOrdersTab
 */

/**
 * Get table columns for responsive display
 * @param {function} t - Translation function
 * @param {function} formatDate - Date formatter
 * @param {function} formatCurrency - Currency formatter
 * @param {function} renderTypeIcon - Renders order type icon
 * @returns {array} Column configuration array
 */
export const getTableColumns = (t, formatDate, formatCurrency, renderTypeIcon) => [
  {
    key: 'order_number',
    label: t('adminOrders.table.order'),
    width: '100px',
    render: (value) => <span className="font-medium text-gray-900">{value}</span>
  },
  {
    key: 'user_name',
    label: t('adminOrders.table.user'),
    width: '150px',
    render: (value, row) => (
      <div>
        <div className="text-sm text-gray-900 font-medium">{value || 'N/A'}</div>
        <div className="text-xs text-gray-500">{row.user_email || ''}</div>
      </div>
    )
  },
  {
    key: 'created_at',
    label: t('adminOrders.table.date'),
    width: '120px',
    render: (value) => <span className="text-sm text-gray-600">{formatDate(value)}</span>
  },
  {
    key: 'order_type',
    label: t('adminOrders.table.type'),
    width: '100px',
    render: (value) => renderTypeIcon(value)
  },
  {
    key: 'order_items',
    label: t('adminOrders.table.items'),
    width: '80px',
    render: (value) => <span className="text-sm text-gray-600">{value?.length || 0}</span>
  },
  {
    key: 'total_amount',
    label: t('adminOrders.table.total'),
    width: '120px',
    render: (value, row) => <span className="text-sm font-medium">{formatCurrency(value, row.currencies?.code)}</span>
  },
  {
    key: 'payment_status',
    label: t('adminOrders.table.paymentStatus.label'),
    width: '140px',
    render: (value, row) => renderPaymentStatusBadge(value, row)
  },
  {
    key: 'status',
    label: t('adminOrders.table.orderStatus.label'),
    width: '140px',
    render: (value, row) => renderOrderStatusBadge(value, row)
  }
];

/**
 * Get modal columns for detailed order view
 * @param {function} t - Translation function
 * @param {function} formatDate - Date formatter
 * @param {function} formatCurrency - Currency formatter
 * @returns {array} Column configuration for modal
 */
export const getModalColumns = (t, formatDate, formatCurrency) => [
  { key: 'order_number', label: t('adminOrders.detail.order') },
  { key: 'created_at', label: t('adminOrders.table.date'), render: (val) => formatDate(val) },
  { key: 'user_name', label: t('adminOrders.table.user') },
  { key: 'user_email', label: t('adminOrders.detail.email') },
  { key: 'order_type', label: t('adminOrders.table.type') },
  { key: 'payment_method', label: t('adminOrders.detail.paymentMethod') },
  {
    key: 'subtotal',
    label: t('adminOrders.detail.subtotal'),
    render: (val, row) => formatCurrency(val, row.currencies?.code)
  },
  {
    key: 'shipping_cost',
    label: t('adminOrders.detail.shipping'),
    render: (val, row) => formatCurrency(val, row.currencies?.code)
  },
  {
    key: 'discount_amount',
    label: t('adminOrders.detail.discount'),
    render: (val, row) => formatCurrency(val, row.currencies?.code)
  },
  {
    key: 'total_amount',
    label: t('adminOrders.detail.total'),
    render: (val, row) => formatCurrency(val, row.currencies?.code)
  },
  { key: 'shipping_address', label: t('adminOrders.detail.address') },
  { key: 'delivery_instructions', label: t('adminOrders.detail.instructions') },
  { key: 'notes', label: t('adminOrders.detail.notes') },
  { key: 'rejection_reason', label: t('adminOrders.detail.rejectionReason') }
];

/**
 * Render payment status badge
 */
function renderPaymentStatusBadge(status, row) {
  const statusConfig = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
    validated: { bg: 'bg-green-100', text: 'text-green-800', label: 'Validated' },
    failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' }
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

/**
 * Render order status badge
 */
function renderOrderStatusBadge(status, row) {
  const statusConfig = {
    pending: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Pending' },
    processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
    shipped: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Shipped' },
    delivered: { bg: 'bg-green-100', text: 'text-green-800', label: 'Delivered' },
    completed: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Completed' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelled' }
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}
