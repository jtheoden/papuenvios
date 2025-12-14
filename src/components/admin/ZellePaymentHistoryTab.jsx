import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loader, Filter, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import TableDetailModal from '@/components/modals/TableDetailModal';
import { zelleService } from '@/lib/zelleService';
import { useRealtimeZelleTransactions } from '@/hooks/useRealtimeSubscription';

const ZellePaymentHistoryTab = () => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  // Format currency helper
  const formatCurrency = (amount, currencyCode = 'USD') => {
    if (!amount) return '0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode
    }).format(amount);
  };

  // State
  const [transactions, setTransactions] = useState([]);
  const [zelleAccounts, setZelleAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Fetch transactions and accounts on mount
  useEffect(() => {
    fetchTransactions();
    fetchZelleAccounts();
  }, []);

  // Real-time subscription for Zelle transaction updates
  useRealtimeZelleTransactions({
    enabled: true,
    onUpdate: (payload) => {
      console.log('[Realtime] Zelle transaction update:', payload.eventType);
      // Reload transactions when any change occurs
      fetchTransactions();
    }
  });

  const fetchZelleAccounts = async () => {
    try {
      const accounts = await zelleService.getAllZelleAccounts();
      setZelleAccounts(accounts || []);
    } catch (error) {
      console.error('Error loading Zelle accounts:', error);
    }
  };

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const data = await zelleService.getAllZellePaymentHistory();
      setTransactions(data);
    } catch (error) {
      toast({
        title: t('common.error') || 'Error',
        description: language === 'es'
          ? 'Error al cargar el historial de pagos Zelle'
          : 'Failed to load Zelle payment history',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Filter and search transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      // Status filter
      if (statusFilter && transaction.status !== statusFilter) {
        return false;
      }

      // Type filter
      if (typeFilter && transaction.transaction_type !== typeFilter) {
        return false;
      }

      // Account filter
      if (accountFilter && transaction.zelle_account_id !== accountFilter) {
        return false;
      }

      // Search filter - search by user name, email, account name, or transaction ID
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const userName = transaction.user?.full_name?.toLowerCase() || '';
        const userEmail = transaction.user?.email?.toLowerCase() || '';
        const accountName = transaction.account_name?.toLowerCase() || '';
        const transactionId = transaction.id?.toLowerCase() || '';
        const recipientName = (transaction.remittances?.recipient_name || transaction.orders?.recipient_name || '').toLowerCase();

        return (
          userName.includes(query) ||
          userEmail.includes(query) ||
          accountName.includes(query) ||
          transactionId.includes(query) ||
          recipientName.includes(query)
        );
      }

      return true;
    });
  }, [transactions, statusFilter, typeFilter, accountFilter, searchQuery]);

  const financialSummary = useMemo(() => {
    // Always use filtered transactions for calculations
    const dataset = filteredTransactions;
    const totalAmount = dataset.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const validatedAmount = dataset
      .filter(t => t.status === 'validated')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const pendingAmount = dataset
      .filter(t => t.status === 'pending')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    return {
      total: totalAmount,
      validated: validatedAmount,
      pending: pendingAmount,
      count: dataset.length
    };
  }, [filteredTransactions]);

  // Table columns definition
  const columns = [
    {
      key: 'transaction_date',
      label: t('zelleHistory.date') || 'Date',
      width: 'w-32',
      sortable: true,
      render: (value) => {
        if (!value) return '-';
        const date = new Date(value);
        return (
          <span className="text-sm">
            {date.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
          </span>
        );
      }
    },
    {
      key: 'user',
      label: t('zelleHistory.userName') || 'User Name',
      width: 'w-40',
      render: (value, row) => {
        const userName = row.user?.full_name || 'N/A';
        const userEmail = row.user?.email || '';
        return (
          <div>
            <div className="text-sm font-medium">{userName}</div>
            {userEmail && <div className="text-xs text-gray-500">{userEmail}</div>}
          </div>
        );
      }
    },
    {
      key: 'account_name',
      label: t('zelleHistory.account') || 'Zelle Account',
      width: 'w-32',
      render: (value) => <span className="font-medium">{value || 'N/A'}</span>
    },
    {
      key: 'amount',
      label: t('zelleHistory.amount') || 'Amount',
      width: 'w-24',
      render: (value) => (
        <span className="font-mono text-right">{formatCurrency(value)}</span>
      )
    },
    {
      key: 'transaction_type',
      label: t('zelleHistory.type') || 'Type',
      width: 'w-24',
      render: (value) => {
        const typeLabels = {
          remittance: t('zelleHistory.typeRemittance') || 'Remittance',
          product: t('zelleHistory.typeProduct') || 'Product',
          combo: t('zelleHistory.typeCombo') || 'Combo'
        };
        return <span className="text-sm">{typeLabels[value] || value}</span>;
      }
    },
    {
      key: 'status',
      label: t('common.status') || 'Status',
      width: 'w-24',
      render: (value) => {
        const statusColors = {
          pending: 'bg-yellow-100 text-yellow-800',
          validated: 'bg-green-100 text-green-800',
          rejected: 'bg-red-100 text-red-800'
        };
        const statusLabels = {
          pending: t('zelleHistory.statusPending') || 'Pending',
          validated: t('zelleHistory.statusValidated') || 'Validated',
          rejected: t('zelleHistory.statusRejected') || 'Rejected'
        };
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[value] || 'bg-gray-100 text-gray-800'}`}>
            {statusLabels[value] || value}
          </span>
        );
      }
    },
    {
      key: 'recipient',
      label: t('zelleHistory.recipient') || 'Recipient',
      width: 'w-32',
      render: (value, row) => {
        const recipientName = row.remittances?.recipient_name || row.orders?.recipient_name || 'N/A';
        const referenceNumber = row.remittances?.remittance_number || row.orders?.order_number || '';
        return (
          <div>
            <div className="text-sm font-medium">{recipientName}</div>
            {referenceNumber && <div className="text-xs text-gray-500">{referenceNumber}</div>}
          </div>
        );
      }
    }
  ];

  // Modal columns (detailed view)
  const modalColumns = [
    {
      key: 'id',
      label: t('common.id') || 'ID',
      render: (value) => <span className="font-mono text-sm">{value}</span>
    },
    {
      key: 'transaction_date',
      label: t('zelleHistory.date') || 'Date',
      render: (value) => {
        if (!value) return '-';
        const date = new Date(value);
        return (
          <span>
            {date.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')} {date.toLocaleTimeString()}
          </span>
        );
      }
    },
    {
      key: 'user',
      label: t('zelleHistory.userName') || 'User Name',
      render: (value, row) => {
        const userName = row.user?.full_name || 'N/A';
        const userEmail = row.user?.email || '';
        return (
          <div>
            <div className="font-medium">{userName}</div>
            {userEmail && <div className="text-sm text-gray-500">{userEmail}</div>}
          </div>
        );
      }
    },
    {
      key: 'account_name',
      label: t('zelleHistory.account') || 'Zelle Account',
      render: (value) => <span className="font-medium">{value || 'N/A'}</span>
    },
    {
      key: 'amount',
      label: t('zelleHistory.amount') || 'Amount',
      render: (value) => <span className="font-mono font-semibold">{formatCurrency(value)}</span>
    },
    {
      key: 'transaction_type',
      label: t('zelleHistory.type') || 'Type',
      render: (value) => {
        const typeLabels = {
          remittance: t('zelleHistory.typeRemittance') || 'Remittance',
          product: t('zelleHistory.typeProduct') || 'Product',
          combo: t('zelleHistory.typeCombo') || 'Combo'
        };
        return <span>{typeLabels[value] || value}</span>;
      }
    },
    {
      key: 'status',
      label: t('common.status') || 'Status',
      render: (value) => {
        const statusLabels = {
          pending: t('zelleHistory.statusPending') || 'Pending',
          validated: t('zelleHistory.statusValidated') || 'Validated',
          rejected: t('zelleHistory.statusRejected') || 'Rejected'
        };
        return <span className="font-medium">{statusLabels[value] || value}</span>;
      }
    },
    {
      key: 'recipient',
      label: t('zelleHistory.recipient') || 'Recipient',
      render: (value, row) => {
        const recipientName = row.remittances?.recipient_name || row.orders?.recipient_name || 'N/A';
        const referenceNumber = row.remittances?.remittance_number || row.orders?.order_number || '';
        const recipientAmount = row.remittances?.amount_to_deliver || row.orders?.total_amount;
        return (
          <div>
            <div className="font-medium">{recipientName}</div>
            {referenceNumber && <div className="text-sm text-gray-500">{referenceNumber}</div>}
            {recipientAmount && <div className="text-sm text-gray-500">{formatCurrency(recipientAmount)}</div>}
          </div>
        );
      }
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="space-y-4"
    >
      {/* Header with title and action buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold gradient-text">
          {t('zelleHistory.title') || 'Zelle Payment History'}
        </h2>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
          style={{
            backgroundColor: visualSettings.primaryColor || '#3b82f6',
            color: '#ffffff'
          }}
        >
          <Filter size={18} />
          {t('common.filters') || 'Filters'}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass-effect p-4 rounded-xl border border-gray-100">
          <p className="text-sm text-gray-500">{t('zelleHistory.totalVolume') || 'Total volume'}</p>
          <p className="text-2xl font-bold">{formatCurrency(financialSummary.total)}</p>
        </div>
        <div className="glass-effect p-4 rounded-xl border border-gray-100">
          <p className="text-sm text-gray-500">{t('zelleHistory.validatedVolume') || 'Validated'}</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(financialSummary.validated)}</p>
        </div>
        <div className="glass-effect p-4 rounded-xl border border-gray-100">
          <p className="text-sm text-gray-500">{t('zelleHistory.pendingVolume') || 'Pending'}</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(financialSummary.pending)}</p>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="p-4 rounded-lg border border-gray-200 bg-gray-50 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Search Input */}
            <div>
              <label className="block text-sm font-medium mb-2">{t('common.search') || 'Search'}</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common.searchPlaceholder') || 'Search...'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
                style={{ focusRingColor: visualSettings.primaryColor }}
              />
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">{t('common.status') || 'Status'}</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
              >
                <option value="">{t('common.all') || 'All'}</option>
                <option value="pending">{t('zelleHistory.statusPending') || 'Pending'}</option>
                <option value="validated">{t('zelleHistory.statusValidated') || 'Validated'}</option>
                <option value="rejected">{t('zelleHistory.statusRejected') || 'Rejected'}</option>
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">{t('zelleHistory.type') || 'Type'}</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
              >
                <option value="">{t('common.all') || 'All'}</option>
                <option value="remittance">{t('zelleHistory.typeRemittance') || 'Remittance'}</option>
                <option value="product">{t('zelleHistory.typeProduct') || 'Product'}</option>
                <option value="combo">{t('zelleHistory.typeCombo') || 'Combo'}</option>
              </select>
            </div>

            {/* Zelle Account Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">{t('zelleHistory.account') || 'Zelle Account'}</label>
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
              >
                <option value="">{t('common.all') || 'All'}</option>
                {zelleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.account_name || account.email || 'N/A'}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear Filters */}
            <div className="flex items-end">
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('');
                  setTypeFilter('');
                  setAccountFilter('');
                }}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors text-sm font-medium"
              >
                {t('common.clearFilters') || 'Clear Filters'}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Result count */}
      <div className="text-sm text-gray-600">
        {t('common.showing') || 'Showing'} <span className="font-semibold">{filteredTransactions.length}</span> {t('zelleHistory.transactions') || 'transactions'}
      </div>

      {/* Table */}
      <ResponsiveTableWrapper
        data={filteredTransactions}
        columns={columns}
        modalColumns={modalColumns}
        isLoading={isLoading}
        onRowClick={(transaction) => {
          setSelectedTransaction(transaction);
          setShowDetailModal(true);
        }}
      />

      {/* Detail Modal */}
      <TableDetailModal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="zelleHistory.details"
        data={selectedTransaction}
        columns={modalColumns}
      />
    </motion.div>
  );
};

export default ZellePaymentHistoryTab;
