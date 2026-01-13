/**
 * ZelleAccountSelector Component
 * Selector para elegir cuenta Zelle para pagos
 * Usado en SendRemittancePage y CartPage
 *
 * Features:
 * - Real-time updates when accounts change
 * - Auto-detects when selected account becomes unavailable
 * - Shows warning if selection is invalidated
 *
 * @param {function} onSelect - Callback cuando se selecciona una cuenta
 * @param {string} usageType - 'products' para productos/orders o 'remittances' para remesas
 * @param {string} selectedAccountId - ID de cuenta pre-seleccionada (opcional)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getAllZelleAccounts } from '@/lib/zelleService';
import { useRealtimeZelleAccounts } from '@/hooks/useRealtimeSubscription';

const ZelleAccountSelector = ({
  onSelect,
  usageType = 'remittances',
  selectedAccountId = null
}) => {
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accountInvalidated, setAccountInvalidated] = useState(false);
  const previousAccountsRef = useRef([]);

  // Load accounts function
  const loadAccounts = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const allAccounts = await getAllZelleAccounts();

      // Filter active accounts by usage type
      const filteredAccounts = (allAccounts || []).filter(account => {
        if (!account.is_active) return false;

        if (usageType === 'products') {
          return account.for_products === true;
        } else if (usageType === 'remittances') {
          return account.for_remittances === true;
        }

        return false;
      });

      // Check if currently selected account is still valid
      if (selectedAccount) {
        const stillExists = filteredAccounts.some(acc => acc.id === selectedAccount.id);
        if (!stillExists) {
          console.log('[ZelleAccountSelector] Selected account no longer available');
          setAccountInvalidated(true);
          setSelectedAccount(null);
          onSelect(null);

          toast({
            title: t('zelle.accountUnavailable'),
            description: t('zelle.selectAnotherAccount'),
            variant: 'destructive',
            duration: 10000 // 10 seconds - longer for important message
          });
        }
      }

      // Store previous accounts for comparison
      previousAccountsRef.current = filteredAccounts;
      setAccounts(filteredAccounts);

      // Auto-select if only one account and no current selection
      if (filteredAccounts.length === 1 && !selectedAccount) {
        setSelectedAccount(filteredAccounts[0]);
        onSelect(filteredAccounts[0]);
        setAccountInvalidated(false);
      }

      // Pre-select if selectedAccountId prop is provided
      if (selectedAccountId && !selectedAccount) {
        const preSelected = filteredAccounts.find(acc => acc.id === selectedAccountId);
        if (preSelected) {
          setSelectedAccount(preSelected);
          onSelect(preSelected);
        }
      }
    } catch (error) {
      console.error('Error loading Zelle accounts:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('zelle.loadError'),
        variant: 'destructive'
      });
    }
    if (showLoading) setLoading(false);
  }, [usageType, selectedAccount, selectedAccountId, onSelect, t]);

  // Initial load
  useEffect(() => {
    loadAccounts();
  }, [usageType]);

  // Subscribe to real-time updates
  useRealtimeZelleAccounts({
    onUpdate: (payload) => {
      console.log('[ZelleAccountSelector] Zelle account changed:', payload.eventType);
      // Reload without showing loading spinner for smoother UX
      loadAccounts(false);
    },
    enabled: true
  });

  const handleSelect = (account) => {
    setSelectedAccount(account);
    setAccountInvalidated(false);
    onSelect(account);
  };

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg flex items-center gap-2">
        <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
        <p className="text-sm text-gray-600">{t('common.loading')}</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 rounded-lg border-2 border-yellow-200 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold text-yellow-800">{t('zelle.noAccounts')}</p>
          <p className="text-sm text-yellow-700 mt-1">
            {t('zelle.contactAdmin')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-gray-700">
        {t('zelle.selectAccount')} <span className="text-red-500">*</span>
      </label>

      {/* Warning banner when account was invalidated */}
      <AnimatePresence>
        {accountInvalidated && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">
                  {t('zelle.accountInvalidated')}
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  {t('zelle.pleaseSelectNew')}
                </p>
              </div>
              <button
                onClick={() => loadAccounts(false)}
                className="p-1 hover:bg-amber-100 rounded transition-colors"
                title={t('common.refresh')}
              >
                <RefreshCw className="w-4 h-4 text-amber-600" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        {accounts.map((account) => (
          <motion.button
            key={account.id}
            onClick={() => handleSelect(account)}
            className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
              selectedAccount?.id === account.id
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
            }`}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            layout
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center flex-shrink-0 transition-colors ${
                      selectedAccount?.id === account.id
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedAccount?.id === account.id && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-2 h-2 bg-white rounded-full"
                      />
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <p className="font-semibold text-gray-900">{account.account_name}</p>
                    </div>
                    <p className="text-sm text-gray-600">{account.email}</p>
                    {account.priority_order && (
                      <p className="text-xs text-gray-500 mt-1">
                        {t('zelle.priority')}: #{account.priority_order}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {account.is_active && (
                <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full font-medium">
                  {t('zelle.active')}
                </span>
              )}
            </div>
          </motion.button>
        ))}
      </div>

      {/* Selected account confirmation */}
      <AnimatePresence>
        {selectedAccount && !accountInvalidated && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="p-3 bg-green-50 border-l-4 border-green-500 rounded text-sm"
          >
            <p className="text-green-800">
              ✓ {t('zelle.payingVia')}: <span className="font-semibold">{selectedAccount.account_name}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ZelleAccountSelector;
