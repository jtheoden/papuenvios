/**
 * Zelle Account Table Configuration
 * Defines column layouts for responsive table display and detail modals
 * Used by SettingsZelleTab for both desktop and mobile views
 */

import StatusBadge from '@/components/ui/StatusBadge';

/**
 * Get table columns for Zelle accounts list view
 * @param {Function} t - Translation function from useLanguage()
 * @param {Function} formatCurrency - Function to format currency values
 * @returns {Array} Column definitions for ResponsiveTableWrapper
 */
export const getZelleTableColumns = (t, formatCurrency) => [
  {
    key: 'account_name',
    label: t('zelle.accountName'),
    width: 'w-32',
    sortable: true,
    render: (value) => <span className="font-medium">{value}</span>
  },
  {
    key: 'holder_name',
    label: t('zelle.holderName'),
    width: 'w-32',
    sortable: true,
    render: (value) => <span>{value}</span>
  },
  {
    key: 'phone_number',
    label: t('zelle.phoneNumber'),
    width: 'w-28',
    render: (value) => <span className="font-mono text-sm">{value}</span>
  },
  {
    key: 'is_active',
    label: t('common.status'),
    width: 'w-20',
    render: (value) => (
      <StatusBadge
        status={value ? 'success' : 'error'}
        label={value ? t('common.active') : t('common.inactive')}
        size="sm"
        showIcon={true}
      />
    )
  },
  {
    key: 'daily_limit',
    label: t('zelle.dailyLimit'),
    width: 'w-24',
    render: (value) => <span className="font-mono text-right">{formatCurrency(value)}</span>
  },
  {
    key: 'current_daily_amount',
    label: t('zelle.currentDaily'),
    width: 'w-24',
    render: (value, row) => {
      const percentage = row.daily_limit > 0 ? (value / row.daily_limit) * 100 : 0;
      const isCritical = percentage > 90;
      const isWarning = percentage > 70;
      return (
        <div className="space-y-1">
          <div className="font-mono text-right text-sm">{formatCurrency(value)}</div>
          <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-colors ${
                isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>
      );
    }
  },
  {
    key: 'monthly_limit',
    label: t('zelle.monthlyLimit'),
    width: 'w-24',
    render: (value) => <span className="font-mono text-right">{formatCurrency(value)}</span>
  },
  {
    key: 'current_monthly_amount',
    label: t('zelle.currentMonthly'),
    width: 'w-24',
    render: (value, row) => {
      const percentage = row.monthly_limit > 0 ? (value / row.monthly_limit) * 100 : 0;
      const isCritical = percentage > 90;
      const isWarning = percentage > 70;
      return (
        <div className="space-y-1">
          <div className="font-mono text-right text-sm">{formatCurrency(value)}</div>
          <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-colors ${
                isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>
      );
    }
  },
  {
    key: 'priority_order',
    label: t('zelle.priority'),
    width: 'w-16',
    render: (value) => (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs">
        {value}
      </span>
    )
  }
];

/**
 * Get columns for detail modal view
 * Shows more detailed information for a single account
 * @param {Function} t - Translation function
 * @param {Function} formatCurrency - Currency formatting function
 * @returns {Array} Column definitions for modal detail view
 */
export const getZelleModalColumns = (t, formatCurrency) => [
  {
    key: 'account_name',
    label: t('zelle.accountName'),
    render: (value) => <span className="font-medium">{value}</span>
  },
  {
    key: 'holder_name',
    label: t('zelle.holderName'),
    render: (value) => <span>{value}</span>
  },
  {
    key: 'phone_number',
    label: t('zelle.phoneNumber'),
    render: (value) => <span className="font-mono">{value}</span>
  },
  {
    key: 'daily_limit',
    label: t('zelle.dailyLimit'),
    render: (value) => <span className="font-mono">{formatCurrency(value)}</span>
  },
  {
    key: 'current_daily_amount',
    label: t('zelle.currentDaily'),
    render: (value) => <span className="font-mono">{formatCurrency(value)}</span>
  },
  {
    key: 'monthly_limit',
    label: t('zelle.monthlyLimit'),
    render: (value) => <span className="font-mono">{formatCurrency(value)}</span>
  },
  {
    key: 'current_monthly_amount',
    label: t('zelle.currentMonthly'),
    render: (value) => <span className="font-mono">{formatCurrency(value)}</span>
  },
  {
    key: 'priority_order',
    label: t('zelle.priority'),
    render: (value) => <span className="font-semibold">{value}</span>
  },
  {
    key: 'is_active',
    label: t('common.status'),
    render: (value) => (
      <StatusBadge
        status={value ? 'success' : 'error'}
        label={value ? t('common.active') : t('common.inactive')}
        size="sm"
      />
    )
  },
  {
    key: 'for_products',
    label: t('zelle.forProducts'),
    render: (value) => (
      <StatusBadge
        status={value ? 'success' : 'error'}
        label={value ? t('common.active') : t('common.inactive')}
        size="sm"
      />
    )
  },
  {
    key: 'for_remittances',
    label: t('zelle.forRemittances'),
    render: (value) => (
      <StatusBadge
        status={value ? 'success' : 'error'}
        label={value ? t('common.active') : t('common.inactive')}
        size="sm"
      />
    )
  },
  {
    key: 'notes',
    label: t('common.notes'),
    render: (value) => <span className="text-sm text-gray-600">{value || '-'}</span>
  }
];

/**
 * Helper function to get status badge based on account usage
 * @param {number} current - Current amount used
 * @param {number} limit - Maximum limit
 * @returns {string} Status: 'success', 'warning', or 'error'
 */
export const getAccountUsageStatus = (current, limit) => {
  if (limit === 0) return 'info';
  const percentage = (current / limit) * 100;
  if (percentage > 90) return 'error';
  if (percentage > 70) return 'warning';
  return 'success';
};
