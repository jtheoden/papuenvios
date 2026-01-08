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
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import TableDetailModal from '@/components/modals/TableDetailModal';
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

  // Form state (field names match Supabase zelle_accounts table structure)
  const [formData, setFormData] = useState({
    account_name: '',
    phone: '',
    account_holder: '',
    email: '',
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
      const [data, usageSummary] = await Promise.all([
        zelleService.getAllZelleAccounts(),
        zelleService.getZelleAccountUsageSummary()
      ]);

      const enriched = (data || []).map((account) => {
        const usage = usageSummary?.[account.id] || {};
        return {
          ...account,
          current_daily_amount: usage.dailyAmount ?? account.current_daily_amount ?? 0,
          current_monthly_amount: usage.monthlyAmount ?? account.current_monthly_amount ?? 0
        };
      });

      setAccounts(enriched);
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
      phone: '',
      account_holder: '',
      email: '',
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
      phone: account.phone,
      account_holder: account.account_holder,
      email: account.email || '',
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
    if (!formData.account_name || !formData.phone || !formData.account_holder || !formData.email) {
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
      const result = await zelleService.deleteZelleAccount(selectedAccount.id);

      if (result.deactivated) {
        // Soft delete - account was deactivated
        toast({
          title: language === 'es' ? 'Cuenta Desactivada' : 'Account Deactivated',
          description: language === 'es'
            ? `La cuenta fue desactivada. Se preservó el historial (${result.message})`
            : result.message
        });
      } else {
        // Hard delete - account was permanently removed
        toast({
          title: t('zelle.accountDeleted') || 'Success',
          description: language === 'es' ? 'Cuenta eliminada permanentemente' : 'Account permanently deleted'
        });
      }

      setShowDeleteModal(false);
      loadAccounts();
    } catch (error) {
      console.error('Error deleting account:', error);

      // Check if it's a dependency error (409 Conflict)
      const isDependencyError = error.statusCode === 409 || error.message?.includes('active dependencies');

      toast({
        title: isDependencyError
          ? (language === 'es' ? 'No se puede eliminar' : 'Cannot Delete')
          : (t('zelle.errorDeletingAccount') || 'Error'),
        description: isDependencyError
          ? (language === 'es'
              ? 'Esta cuenta tiene transacciones, órdenes o remesas activas. Complete o cancele estas operaciones primero, o desactive la cuenta desde el toggle de estado.'
              : error.message)
          : error.message,
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
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div>
          <h3 className="text-xl sm:text-2xl font-semibold" style={{ color: visualSettings.headingColor || '#1f2937' }}>
            {t('zelle.accounts') || 'Zelle Accounts'}
          </h3>
          <p className="text-sm text-gray-600 mt-1 hidden sm:block">
            {language === 'es'
              ? 'Gestiona las cuentas Zelle para pagos de productos y remesas'
              : 'Manage Zelle accounts for product payments and remittances'}
          </p>
        </div>
        <Button
          onClick={handleCreateAccount}
          style={{ backgroundColor: visualSettings.primaryColor || '#2563eb', color: 'white' }}
          className="hover:opacity-90 h-9 px-3"
          title={t('zelle.createAccount') || 'Create Account'}
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{t('zelle.createAccount') || 'Create Account'}</span>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b p-4 sm:p-6 flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-semibold truncate pr-4">
                {selectedAccount ? t('zelle.editAccount') : t('zelle.createAccount')}
              </h2>
              <button
                onClick={() => setShowFormModal(false)}
                className="text-gray-500 hover:text-gray-700 shrink-0 p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 truncate">{t('zelle.accountName')} *</label>
                  <input
                    type="text"
                    value={formData.account_name}
                    onChange={(e) => setFormData({...formData, account_name: e.target.value})}
                    placeholder={t('zelle.accountNamePlaceholder') || 'Account name'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 truncate">{t('zelle.phoneNumber')} *</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    placeholder={t('zelle.phoneNumberPlaceholder') || 'Phone number'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 truncate">{t('zelle.holderName')} *</label>
                  <input
                    type="text"
                    value={formData.account_holder}
                    onChange={(e) => setFormData({...formData, account_holder: e.target.value})}
                    placeholder={t('zelle.holderNamePlaceholder') || 'Holder name'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 truncate">{t('common.email')} *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    placeholder={t('zelle.emailPlaceholder') || 'account@example.com'}
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 truncate">{t('zelle.priority')}</label>
                  <input
                    type="number"
                    value={formData.priority_order}
                    onChange={(e) => setFormData({...formData, priority_order: e.target.value === '' ? 0 : parseInt(e.target.value) || 0})}
                    min="1"
                    className="input-style w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 truncate">{t('zelle.dailyLimit')} ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.daily_limit}
                    onChange={(e) => setFormData({...formData, daily_limit: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0})}
                    className="input-style w-full"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1 truncate">{t('zelle.monthlyLimit')} ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.monthly_limit}
                    onChange={(e) => setFormData({...formData, monthly_limit: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0})}
                    className="input-style w-full sm:w-1/2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('common.notes')}</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder={t('zelle.notesPlaceholder') || 'Additional notes'}
                  rows="2"
                  className="input-style w-full"
                />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-2">
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

            <div className="border-t p-4 sm:p-6 flex gap-2 sm:gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowFormModal(false)} className="h-9 px-3">
                <span className="hidden sm:inline">{t('common.cancel')}</span>
                <span className="sm:hidden">✕</span>
              </Button>
              <Button
                onClick={handleSubmitForm}
                disabled={actionLoading === 'form'}
                style={{ backgroundColor: visualSettings.primaryColor || '#2563eb', color: 'white' }}
                className="h-9 px-3"
              >
                {actionLoading === 'form' && <Loader className="h-4 w-4 sm:mr-2 animate-spin" />}
                <span className="hidden sm:inline">{t('common.save')}</span>
                <span className="sm:hidden">{actionLoading !== 'form' && '✓'}</span>
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && selectedAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg max-w-md w-full p-4 sm:p-6 max-h-[95vh] overflow-y-auto"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-full shrink-0">
                <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 text-red-600" />
              </div>
              <h2 className="text-base sm:text-lg font-semibold">{t('zelle.confirmDelete')}</h2>
            </div>

            <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
              <p className="text-sm sm:text-base text-gray-700">
                {language === 'es'
                  ? `¿Estás seguro de que deseas eliminar la cuenta "${selectedAccount.account_name}"?`
                  : `Are you sure you want to delete the account "${selectedAccount.account_name}"?`}
              </p>

              {/* Warning box */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm font-medium text-amber-800 mb-2">
                  {language === 'es' ? '⚠️ Importante:' : '⚠️ Important:'}
                </p>
                <ul className="text-xs sm:text-sm text-amber-700 space-y-1 list-disc list-inside">
                  <li>
                    {language === 'es'
                      ? 'Si hay órdenes o remesas activas, la eliminación será bloqueada.'
                      : 'If there are active orders or remittances, deletion will be blocked.'}
                  </li>
                  <li>
                    {language === 'es'
                      ? 'Si hay historial, la cuenta será desactivada para preservar registros.'
                      : 'If there is history, the account will be deactivated to preserve records.'}
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex gap-2 sm:gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowDeleteModal(false)} className="h-9 px-3">
                <span className="hidden sm:inline">{t('common.cancel')}</span>
                <span className="sm:hidden">✕</span>
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={actionLoading === 'delete'}
                className="h-9 px-3"
              >
                {actionLoading === 'delete' && <Loader className="h-4 w-4 sm:mr-2 animate-spin" />}
                <Trash2 className="h-4 w-4 sm:mr-2 sm:hidden" />
                <span className="hidden sm:inline">{t('common.delete')}</span>
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Reset Modal */}
      {showResetModal && selectedAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg max-w-md w-full p-4 sm:p-6"
          >
            <h2 className="text-base sm:text-lg font-semibold mb-4">{t('zelle.resetCounters')}</h2>
            <div className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('zelle.counterType')}</label>
                <select
                  value={resetType}
                  onChange={(e) => setResetType(e.target.value)}
                  className="input-style w-full"
                >
                  <option value="daily">{t('zelle.resetDaily') || 'Reset Daily'}</option>
                  <option value="monthly">{t('zelle.resetMonthly') || 'Reset Monthly'}</option>
                </select>
              </div>
              <p className="text-xs sm:text-sm text-gray-600">
                {language === 'es'
                  ? 'Esto reiniciará el contador seleccionado. Se llenará automáticamente.'
                  : 'This will reset the selected counter. It will refill automatically.'}
              </p>
            </div>
            <div className="flex gap-2 sm:gap-3 justify-end mt-4 sm:mt-6">
              <Button variant="outline" onClick={() => setShowResetModal(false)} className="h-9 px-3">
                <span className="hidden sm:inline">{t('common.cancel')}</span>
                <span className="sm:hidden">✕</span>
              </Button>
              <Button
                onClick={handleConfirmReset}
                disabled={actionLoading === 'reset'}
                style={{ backgroundColor: visualSettings.primaryColor || '#2563eb', color: 'white' }}
                className="h-9 px-3"
              >
                {actionLoading === 'reset' && <Loader className="h-4 w-4 sm:mr-2 animate-spin" />}
                <RotateCcw className="h-4 w-4 sm:mr-2 sm:hidden" />
                <span className="hidden sm:inline">{t('common.confirm')}</span>
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default SettingsZelleTab;
