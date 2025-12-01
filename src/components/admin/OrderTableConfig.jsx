import React from 'react';
import StatusBadge from '@/components/ui/StatusBadge';

/**
 * Order Table Column Configuration
 * Shared configuration for responsive table display in AdminOrdersTab
 * Now uses accessible StatusBadge component instead of plain badges
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
 * Uses accessible StatusBadge component with proper icons
 */
function renderPaymentStatusBadge(status, row) {
  const statusMap = {
    pending: 'pending',
    validated: 'success',
    rejected: 'error',
    confirmed: 'success',
    failed: 'error'
  };

  const statusType = statusMap[status] || 'pending';
  const labelMap = {
    pending: 'Pendiente',
    validated: 'Validado',
    rejected: 'Rechazado',
    confirmed: 'Confirmado',
    failed: 'Fallido'
  };

  return (
    <StatusBadge
      status={statusType}
      label={labelMap[status] || status}
      size="sm"
    />
  );
}

/**
 * Render order status badge
 * Uses accessible StatusBadge component with proper icons and semantic meaning
 */
function renderOrderStatusBadge(status, row) {
  const statusMap = {
    pending: 'pending',
    processing: 'pending',
    shipped: 'info',
    delivered: 'success',
    completed: 'success',
    cancelled: 'error'
  };

  const statusType = statusMap[status] || 'pending';
  const labelMap = {
    pending: 'Pendiente',
    processing: 'En proceso',
    shipped: 'Enviado',
    delivered: 'Entregado',
    completed: 'Completado',
    cancelled: 'Cancelado'
  };

  return (
    <StatusBadge
      status={statusType}
      label={labelMap[status] || status}
      size="sm"
    />
  );
}
