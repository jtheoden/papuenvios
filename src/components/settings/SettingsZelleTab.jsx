/**
 * Settings Zelle Account Management Tab
 * Extracted component for managing Zelle accounts in SettingsPage
 * Provides full CRUD functionality, transaction viewing, and counter management
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, Edit, Eye, RotateCcw, Loader, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { ResponsiveTableWrapper } from '@/components/tables/ResponsiveTableWrapper';
import { TableDetailModal } from '@/components/modals/TableDetailModal';
import { zelleService } from '@/lib/zelleService';
import { getZelleTableColumns, getZelleModalColumns } from './ZelleAccountTableConfig';

const SettingsZelleTab = () => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();

  // Main state
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  // Selected account for modals
  const [selectedAccount, setSelectedAccount] = useState(null);

  // Modal states
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showTransactionsModal, setShowTransactionsModal] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Form and transactions state
  const [resetType, setResetType] = useState('daily');
  const [transactions, setTransactions] = useState([]);
  const [accountStats, setAccountStats] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    account_name: '',
    phone_number: '',
    holder_name: '',
    daily_limit: 0,
    monthly_limit: 0,
    security_limit: 0,
    priority_order: 1,
    notes: '',
    is_active: true,
    for_products: true,
    for_remittances: true
  });

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const data = await zelleService.getAllZelleAccounts();
      setAccounts(data || []);
    } catch (error) {
      console.error('Error loading Zelle accounts:', error);
      toast({
        title: t('zelle.errorLoadingAccounts') || 'Error',
        description: error.message,
        variant: 'destructive'
      });
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  // Get table columns with integrated actions
  const tableColumns = useMemo(() => {
    const baseColumns = getZelleTableColumns(t, formatCurrency);
    return [
      ...baseColumns,
      {
        key: 'actions',
        label: t('common.actions'),
        width: 'w-32',
        render: (_, account) => (
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleViewDetails(account)}
              className="h-8 w-8"
              title={language === 'es' ? 'Ver detalles' : 'View details'}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleEditAccount(account)}
              className="h-8 w-8"
              title={language === 'es' ? 'Editar' : 'Edit'}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              size="icon"
              onClick={() => handleDeleteClick(account)}
              className="h-8 w-8"
              title={language === 'es' ? 'Eliminar' : 'Delete'}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      }
    ];
  }, [t, language]);

  // Form handlers
  const handleCreateAccount = () => {
    setFormData({
      account_name: '',
      phone_number: '',
      holder_name: '',
      daily_limit: 0,
      monthly_limit: 0,
      security_limit: 0,
      priority_order: accounts.length + 1,
      notes: '',
      is_active: true,
      for_products: true,
      for_remittances: true
    });
    setSelectedAccount(null);
    setShowFormModal(true);
  };

  const handleEditAccount = (account) => {
    setSelectedAccount(account);
    setFormData({
      account_name: account.account_name,
      phone_number: account.phone_number,
      holder_name: account.holder_name,
      daily_limit: account.daily_limit,
      monthly_limit: account.monthly_limit,
      security_limit: account.security_limit,
      priority_order: account.priority_order,
      notes: account.notes || '',
      is_active: account.is_active,
      for_products: account.for_products,
      for_remittances: account.for_remittances
    });
    setShowFormModal(true);
  };

  const handleSubmitForm = async () => {
    if (!formData.account_name || !formData.phone_number || !formData.holder_name) {
      toast({
        title: t('zelle.errorRequiredFields') || 'Required fields',
        description: language === 'es'
          ? 'Por favor complete los campos requeridos'
          : 'Please fill in all required fields',
        variant: 'destructive'
      });
      return;
    }

    setActionLoading('form');
    try {
      if (selectedAccount) {
        // Update existing account
        await zelleService.updateZelleAccount(selectedAccount.id, formData);
        toast({
          title: t('zelle.accountUpdated') || 'Success',
          description: language === 'es' ? 'Cuenta actualizada' : 'Account updated'
        });
      } else {
        // Create new account
        await zelleService.createZelleAccount(formData);
        toast({
          title: t('zelle.accountCreated') || 'Success',
          description: language === 'es' ? 'Cuenta creada' : 'Account created'
        });
      }
      setShowFormModal(false);
      loadAccounts();
    } catch (error) {
      console.error('Error saving account:', error);
      toast({
        title: t('zelle.errorSavingAccount') || 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Detail modal handler
  const handleViewDetails = (account) => {
    setSelectedAccount(account);
    setShowDetailModal(true);
  };

  // Transactions modal handler
  const handleViewTransactions = async (account) => {
    setSelectedAccount(account);
    setActionLoading('transactions');
    try {
      const [txns, stats] = await Promise.all([
        zelleService.getZelleAccountTransactions(account.id, {}),
        zelleService.getZelleAccountStats(account.id)
      ]);
      setTransactions(txns || []);
      setAccountStats(stats);
      setShowTransactionsModal(true);
    } catch (error) {
      console.error('Error loading transactions:', error);
      toast({
        title: t('zelle.errorLoadingTransactions') || 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Delete handlers
  const handleDeleteClick = (account) => {
    setSelectedAccount(account);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedAccount) return;
    setActionLoading('delete');
    try {
      await zelleService.deleteZelleAccount(selectedAccount.id);
      toast({
        title: t('zelle.accountDeleted') || 'Success',
        description: language === 'es' ? 'Cuenta eliminada' : 'Account deleted'
      });
      setShowDeleteModal(false);
      loadAccounts();
    } catch (error) {
      console.error('Error deleting account:', error);
      toast({
        title: t('zelle.errorDeletingAccount') || 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Reset counters handler
  const handleResetCounters = async (account) => {
    setSelectedAccount(account);
    setShowResetModal(true);
  };

  const handleConfirmReset = async () => {
    if (!selectedAccount) return;
    setActionLoading('reset');
    try {
      await zelleService.resetZelleCounters(selectedAccount.id, resetType);
      toast({
        title: t('zelle.countersReset') || 'Success',
        description: resetType === 'daily'
          ? (language === 'es' ? 'Contador diario reiniciado' : 'Daily counter reset')
          : (language === 'es' ? 'Contador mensual reiniciado' : 'Monthly counter reset')
      });
      setShowResetModal(false);
      loadAccounts();
    } catch (error) {
      console.error('Error resetting counters:', error);
      toast({
        title: t('zelle.errorResettingCounters') || 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader className="h-8 w-8 animate-spin" style={{ color: visualSettings.primaryColor }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h3 className="text-2xl font-semibold" style={{ color: visualSettings.headingColor || '#1f2937' }}>
            {t('zelle.accounts') || 'Zelle Accounts'}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {language === 'es'
              ? 'Gestiona las cuentas Zelle para pagos de productos y remesas'
              : 'Manage Zelle accounts for product payments and remittances'}
          </p>
        </div>
        <Button
          onClick={handleCreateAccount}
          style={{ backgroundColor: visualSettings.primaryColor || '#2563eb', color: 'white' }}
          className="hover:opacity-90"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('zelle.createAccount') || 'Create Account'}
        </Button>
      </motion.div>

      {/* Accounts Table */}
      {accounts.length > 0 ? (
        <ResponsiveTableWrapper
          columns={tableColumns}
          data={accounts}
          keyField="id"
          emptyMessage={t('zelle.noAccounts') || 'No accounts'}
        />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center"
        >
          <AlertCircle className="h-12 w-12 mx-auto mb-3 text-blue-500" />
          <p className="text-gray-600">
            {language === 'es'
              ? 'No hay cuentas Zelle configuradas. Crea una para comenzar.'
              : 'No Zelle accounts configured. Create one to start.'}
          </p>
        </motion.div>
      )}

      {/* Detail Modal */}
      {selectedAccount && (
        <TableDetailModal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          title={t('zelle.accountDetails') || 'Account Details'}
          columns={getZelleModalColumns(t, formatCurrency)}
          data={selectedAccount}
          actions={[
            {
              label: language === 'es' ? 'Ver Transacciones' : 'View Transactions',
              onClick: () => {
                setShowDetailModal(false);
                handleViewTransactions(selectedAccount);
              }
            },
            {
              label: language === 'es' ? 'Reiniciar Contadores' : 'Reset Counters',
              onClick: () => {
                setShowDetailModal(false);
                handleResetCounters(selectedAccount);
              }
            }
          ]}
        />
      )}

      {/* Form Modal */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b p-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {selectedAccount ? t('zelle.editAccount') : t('zelle.createAccount')} || 'Account'}
              </h2>
              <button
                onClick={() => setShowFormModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('zelle.accountName')} *</label>
                  <input
                    type="text"
                    value={formData.account_name}
                    onChange={(e) => setFormData({...formData, account_name: e.target.value})}
                    placeholder={t('zelle.accountNamePlaceholder') || 'Account name'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('zelle.phoneNumber')} *</label>
                  <input
                    type="tel"
                    value={formData.phone_number}
                    onChange={(e) => setFormData({...formData, phone_number: e.target.value})}
                    placeholder={t('zelle.phoneNumberPlaceholder') || 'Phone number'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('zelle.holderName')} *</label>
                  <input
                    type="text"
                    value={formData.holder_name}
                    onChange={(e) => setFormData({...formData, holder_name: e.target.value})}
                    placeholder={t('zelle.holderNamePlaceholder') || 'Holder name'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('zelle.priority')}</label>
                  <input
                    type="number"
                    value={formData.priority_order}
                    onChange={(e) => setFormData({...formData, priority_order: parseInt(e.target.value)})}
                    min="1"
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('zelle.dailyLimit')} ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.daily_limit}
                    onChange={(e) => setFormData({...formData, daily_limit: parseFloat(e.target.value)})}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('zelle.monthlyLimit')} ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.monthly_limit}
                    onChange={(e) => setFormData({...formData, monthly_limit: parseFloat(e.target.value)})}
                    className="input-style w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('common.notes')}</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder={t('zelle.notesPlaceholder') || 'Additional notes'}
                  rows="3"
                  className="input-style w-full"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                    className="rounded"
                  />
                  <span className="text-sm">{t('common.active')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.for_products}
                    onChange={(e) => setFormData({...formData, for_products: e.target.checked})}
                    className="rounded"
                  />
                  <span className="text-sm">{t('zelle.forProducts')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.for_remittances}
                    onChange={(e) => setFormData({...formData, for_remittances: e.target.checked})}
                    className="rounded"
                  />
                  <span className="text-sm">{t('zelle.forRemittances')}</span>
                </label>
              </div>
            </div>

            <div className="border-t p-6 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowFormModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSubmitForm}
                disabled={actionLoading === 'form'}
                style={{ backgroundColor: visualSettings.primaryColor || '#2563eb', color: 'white' }}
              >
                {actionLoading === 'form' && <Loader className="h-4 w-4 mr-2 animate-spin" />}
                {t('common.save')}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && selectedAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg max-w-md w-full p-6"
          >
            <h2 className="text-lg font-semibold mb-2">{t('zelle.confirmDelete')} || 'Confirm Delete'}</h2>
            <p className="text-gray-600 mb-6">
              {language === 'es'
                ? `¿Estás seguro de que deseas eliminar la cuenta "${selectedAccount.account_name}"? Esta acción no se puede deshacer.`
                : `Are you sure you want to delete the account "${selectedAccount.account_name}"? This action cannot be undone.`}
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={actionLoading === 'delete'}
              >
                {actionLoading === 'delete' && <Loader className="h-4 w-4 mr-2 animate-spin" />}
                {t('common.delete')}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Reset Modal */}
      {showResetModal && selectedAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg max-w-md w-full p-6"
          >
            <h2 className="text-lg font-semibold mb-4">{t('zelle.resetCounters')} || 'Reset Counters'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('zelle.counterType')} || 'Counter Type'}</label>
                <select
                  value={resetType}
                  onChange={(e) => setResetType(e.target.value)}
                  className="input-style w-full"
                >
                  <option value="daily">{t('zelle.resetDaily')} || 'Reset Daily'</option>
                  <option value="monthly">{t('zelle.resetMonthly')} || 'Reset Monthly'</option>
                </select>
              </div>
              <p className="text-sm text-gray-600">
                {language === 'es'
                  ? 'Esto reiniciará el contador seleccionado para esta cuenta. El contador se volverá a llenar automáticamente.'
                  : 'This will reset the selected counter for this account. The counter will refill automatically.'}
              </p>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <Button variant="outline" onClick={() => setShowResetModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleConfirmReset}
                disabled={actionLoading === 'reset'}
                style={{ backgroundColor: visualSettings.primaryColor || '#2563eb', color: 'white' }}
              >
                {actionLoading === 'reset' && <Loader className="h-4 w-4 mr-2 animate-spin" />}
                {t('common.confirm')}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default SettingsZelleTab;
