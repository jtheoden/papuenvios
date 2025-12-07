import React from 'react';
import { AlertCircle, AlertTriangle, AlertOctagon, CheckCircle } from 'lucide-react';

/**
 * Product Table Column Configuration
 * Shared configuration for responsive table display in VendorInventoryTab
 */

/**
 * Get table columns for responsive display
 * @param {function} t - Translation function
 * @param {function} language - Current language (es/en)
 * @param {array} currencies - Available currencies
 * @returns {array} Column configuration array
 */
export const getTableColumns = (t, language, currencies) => [
  {
    key: language === 'es' ? 'name_es' : 'name_en',
    label: t('vendor.inventory.product'),
    width: '200px',
    render: (value, row) => {
      const isOutOfStock = row.stock === 0;
      const productName = language === 'es'
        ? (row.name_es || row.name_en)
        : (row.name_en || row.name_es);
      return (
        <div className={isOutOfStock ? 'line-through text-gray-400' : 'font-medium text-gray-900'}>
          {productName || 'Sin nombre'}
        </div>
      );
    }
  },
  {
    key: 'category',
    label: language === 'es' ? 'Categoría' : 'Category',
    width: '150px',
    render: (value) => (
      <span className="text-sm text-gray-600">
        {value ? (language === 'es' ? value.name_es : value.name_en) : 'Sin categoría'}
      </span>
    )
  },
  {
    key: 'base_currency_id',
    label: language === 'es' ? 'Moneda' : 'Currency',
    width: '100px',
    render: (value) => {
      const currency = currencies.find(c => c.id === value);
      return (
        <span className="text-xs bg-gray-200 px-2 py-1 rounded">
          {currency?.code || 'USD'}
        </span>
      );
    }
  },
  {
    key: 'stock',
    label: t('vendor.inventory.stock'),
    width: '120px',
    render: (value, row) => {
      const stock = value !== undefined ? value : 0;
      const minStock = row.min_stock_alert || 10;
      const isOutOfStock = stock === 0;
      const isLowStock = stock > 0 && stock <= minStock;

      return (
        <div className="flex items-center gap-2">
          <span className={isOutOfStock ? 'line-through text-gray-400' : ''}>
            {stock}
          </span>
          {isOutOfStock && (
            <AlertCircle
              className="h-4 w-4 text-red-600"
              title={language === 'es' ? 'Sin stock' : 'Out of stock'}
            />
          )}
          {isLowStock && (
            <AlertTriangle
              className="h-4 w-4 text-orange-500"
              title={language === 'es' ? 'Stock bajo' : 'Low stock'}
            />
          )}
        </div>
      );
    }
  },
  {
    key: 'final_price',
    label: t('vendor.inventory.price'),
    width: '120px',
    render: (value, row) => {
      const currency = currencies.find(c => c.id === row.base_currency_id);
      const price = value || row.base_price || '0.00';
      return (
        <span className="text-sm font-medium">
          {currency?.symbol || '$'}
          {Number(price).toFixed(2)}
        </span>
      );
    }
  },
  {
    key: 'expiry_date',
    label: t('vendor.inventory.expiryDate'),
    width: '150px',
    render: (value, row) => {
      const expiryDate = value || row.expiryDate;
      const expiryStatus = getExpiryStatus(expiryDate, language);

      if (!expiryDate) {
        return <span className="text-sm text-gray-600">N/A</span>;
      }

      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            {new Date(expiryDate).toLocaleDateString()}
          </span>
          {expiryStatus?.icon && (
            <expiryStatus.icon
              className={`h-4 w-4 ${expiryStatus.iconColor}`}
              title={expiryStatus.tooltip}
            />
          )}
        </div>
      );
    }
  }
];

/**
 * Get modal columns for detailed product view
 * @param {function} t - Translation function
 * @param {function} language - Current language (es/en)
 * @param {array} currencies - Available currencies
 * @returns {array} Column configuration for modal
 */
export const getModalColumns = (t, language, currencies) => [
  {
    key: language === 'es' ? 'name_es' : 'name_en',
    label: t('vendor.inventory.product'),
    render: (value, row) => {
      const productName = language === 'es'
        ? (row.name_es || row.name_en)
        : (row.name_en || row.name_es);
      return productName || 'Sin nombre';
    }
  },
  {
    key: 'category',
    label: language === 'es' ? 'Categoría' : 'Category',
    render: (value) => value ? (language === 'es' ? value.name_es : value.name_en) : 'Sin categoría'
  },
  {
    key: 'stock',
    label: t('vendor.inventory.stock'),
    render: (value) => value !== undefined ? value : 0
  },
  {
    key: 'base_currency_id',
    label: language === 'es' ? 'Moneda' : 'Currency',
    render: (value) => {
      const currency = currencies.find(c => c.id === value);
      return currency?.code || 'USD';
    }
  },
  {
    key: 'base_price',
    label: t('vendor.inventory.basePrice'),
    render: (value, row) => {
      const currency = currencies.find(c => c.id === row.base_currency_id);
      return `${currency?.symbol || '$'}${Number(value || 0).toFixed(2)}`;
    }
  },
  {
    key: 'final_price',
    label: t('vendor.inventory.finalPrice'),
    render: (value, row) => {
      const currency = currencies.find(c => c.id === row.base_currency_id);
      return `${currency?.symbol || '$'}${Number(value || 0).toFixed(2)}`;
    }
  },
  {
    key: 'min_stock_alert',
    label: language === 'es' ? 'Stock Mínimo' : 'Min Stock',
    render: (value) => value || 10
  },
  {
    key: 'expiry_date',
    label: t('vendor.inventory.expiryDate'),
    render: (value, row) => {
      const expiryDate = value || row.expiryDate;
      return expiryDate ? new Date(expiryDate).toLocaleDateString() : 'N/A';
    }
  },
  {
    key: language === 'es' ? 'description_es' : 'description_en',
    label: t('vendor.addProduct.description'),
    render: (value, row) => {
      const description = language === 'es'
        ? (row.description_es || row.description)
        : (row.description_en || row.description_es || row.description);
      return description || 'N/A';
    }
  }
];

/**
 * Get expiry status information with icon and colors
 * @param {string} expiryDate - Date string in ISO format
 * @param {string} language - Current language
 * @returns {object|null} Status object or null if no expiry date
 */
function getExpiryStatus(expiryDate, language) {
  if (!expiryDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const daysUntilExpiry = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return {
      status: 'expired',
      icon: AlertOctagon,
      iconColor: 'text-red-600',
      color: 'bg-red-50',
      tooltip: language === 'es' ? 'Expirado' : 'Expired'
    };
  }

  if (daysUntilExpiry <= 7) {
    return {
      status: 'critical',
      icon: AlertTriangle,
      iconColor: 'text-orange-500',
      color: 'bg-orange-50',
      days: daysUntilExpiry,
      tooltip: language === 'es' ? `${daysUntilExpiry} días restantes` : `${daysUntilExpiry} days left`
    };
  }

  if (daysUntilExpiry <= 30) {
    return {
      status: 'warning',
      icon: AlertCircle,
      iconColor: 'text-yellow-600',
      color: 'bg-yellow-50',
      days: daysUntilExpiry,
      tooltip: language === 'es' ? `${daysUntilExpiry} días restantes` : `${daysUntilExpiry} days left`
    };
  }

  return {
    status: 'valid',
    icon: CheckCircle,
    iconColor: 'text-green-600',
    color: 'bg-green-50',
    days: daysUntilExpiry,
    tooltip: language === 'es' ? `${daysUntilExpiry} días restantes` : `${daysUntilExpiry} days left`
  };
}
