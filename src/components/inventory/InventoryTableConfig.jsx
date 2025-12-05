import React from 'react';

/**
 * Inventory Table Column Configuration
 * Shared configuration for responsive inventory table display
 */

/**
 * Get table columns for responsive inventory display
 * @param {function} t - Translation function
 * @param {string} language - Current language (es/en)
 * @returns {array} Column configuration array
 */
export const getInventoryTableColumns = (t, language) => [
  {
    key: 'product_name',
    label: t('vendor.inventory.product'),
    width: '180px',
    render: (value, row) => (
      <div>
        <div className="text-sm font-medium text-gray-900 line-clamp-2">{value}</div>
        {row.sku && <div className="text-xs text-gray-500">SKU: {row.sku}</div>}
      </div>
    )
  },
  {
    key: 'category',
    label: t('vendor.inventory.category'),
    width: '120px',
    render: (value) => <span className="text-sm text-gray-600">{value}</span>
  },
  {
    key: 'available_quantity',
    label: t('vendor.inventory.stock'),
    width: '100px',
    render: (value, row) => renderStockDisplay(value, row)
  },
  {
    key: 'base_price',
    label: t('vendor.inventory.price'),
    width: '120px',
    render: (value, row) => (
      <span className="text-sm font-medium">
        {row.currency_code} {Number(value).toFixed(2)}
      </span>
    )
  },
  {
    key: 'expiry_date',
    label: t('vendor.inventory.expiryDate'),
    width: '140px',
    render: (value) => renderExpiryDisplay(value)
  },
  {
    key: 'batch_number',
    label: t('vendor.inventory.batchNumber'),
    width: '140px',
    render: (value) => <span className="text-sm text-gray-600">{value || '-'}</span>
  }
];

/**
 * Get modal columns for detailed inventory view
 * @param {function} t - Translation function
 * @returns {array} Column configuration for modal
 */
export const getInventoryModalColumns = (t) => [
  { key: 'product_name', label: t('vendor.inventory.product') },
  { key: 'sku', label: t('vendor.inventory.sku') },
  { key: 'category', label: t('vendor.inventory.category') },
  { key: 'batch_number', label: t('vendor.inventory.batchNumber') },
  { key: 'quantity', label: t('vendor.inventory.totalStock') },
  { key: 'reserved_quantity', label: t('vendor.inventory.reservedStock') },
  { key: 'available_quantity', label: t('vendor.inventory.availableStock') },
  { key: 'cost_per_unit', label: t('vendor.inventory.costPerUnit') },
  { key: 'base_price', label: t('vendor.inventory.basePrice') },
  { key: 'profit_margin', label: t('vendor.inventory.profitMargin'), render: (val) => `${val}%` },
  { key: 'currency_code', label: t('vendor.inventory.currency') },
  { key: 'received_date', label: t('vendor.inventory.receivedDate') },
  { key: 'expiry_date', label: t('vendor.inventory.expiryDate') },
  { key: 'supplier_reference', label: t('vendor.inventory.supplierReference') },
  { key: 'notes', label: t('common.notes') }
];

/**
 * Render stock display with status indicator
 */
function renderStockDisplay(available, row) {
  const quantity = available || 0;
  const minAlert = row.min_stock_alert || 10;
  const total = row.quantity || 0;

  let statusClass = 'text-green-700 bg-green-50';
  let statusText = 'OK';

  if (quantity === 0) {
    statusClass = 'text-red-700 bg-red-50';
    statusText = 'Out of Stock';
  } else if (quantity <= minAlert) {
    statusClass = 'text-orange-700 bg-orange-50';
    statusText = 'Low Stock';
  }

  return (
    <div className={`px-2 py-1 rounded text-xs font-medium ${statusClass}`}>
      <div>{quantity} / {total}</div>
      <div className="text-xs">{statusText}</div>
    </div>
  );
}

/**
 * Render expiry date display with status
 */
function renderExpiryDisplay(expiryDate) {
  if (!expiryDate) {
    return <span className="text-sm text-gray-500">-</span>;
  }

  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  let statusClass = 'text-green-700 bg-green-50';
  if (daysLeft < 0) {
    statusClass = 'text-red-700 bg-red-50';
  } else if (daysLeft <= 30) {
    statusClass = 'text-orange-700 bg-orange-50';
  } else if (daysLeft <= 90) {
    statusClass = 'text-yellow-700 bg-yellow-50';
  }

  const dateStr = expiry.toLocaleDateString();

  return (
    <div className={`px-2 py-1 rounded text-xs font-medium ${statusClass}`}>
      <div>{dateStr}</div>
      {daysLeft < 0 ? (
        <div>Expired</div>
      ) : (
        <div>{daysLeft}d left</div>
      )}
    </div>
  );
}

/**
 * Stock status badge for quick visual reference
 */
export function getStockStatusColor(available, minAlert = 10) {
  if (available === 0) return 'red';
  if (available <= minAlert) return 'orange';
  return 'green';
}

/**
 * Expiry status badge for quick visual reference
 */
export function getExpiryStatusColor(expiryDate) {
  if (!expiryDate) return 'gray';

  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) return 'red';
  if (daysLeft <= 30) return 'orange';
  if (daysLeft <= 90) return 'yellow';
  return 'green';
}
