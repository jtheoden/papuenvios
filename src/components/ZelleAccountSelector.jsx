/**
 * ZelleAccountSelector Component
 * Selector para elegir cuenta Zelle para pagos
 * Usado en SendRemittancePage y CartPage
 *
 * Features:
 * - Reads accounts ONLY through the list_zelle_accounts_public RPC (visibility
 *   flags applied server-side); customers have no direct table access
 * - Periodic + on-focus refresh keeps the list current (no table realtime)
 * - Auto-detects when selected account becomes unavailable
 * - Shows warning if selection is invalidated
 *
 * @param {function} onSelect - Callback cuando se selecciona una cuenta
 * @param {string} usageType - 'products' para productos/orders o 'remittances' para remesas
 * @param {string} selectedAccountId - ID de cuenta pre-seleccionada (opcional)
 * @param {number} amount - Total in USD (optional). When given, accounts whose limits
 *   would be exceeded get an ADVISORY warning (available === false); they stay selectable.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getZelleAccountsForCustomer } from '@/lib/zelleService';
import { getZelleAccountPublicContact } from '@/lib/zelleVisibility';

export const ZELLE_REFRESH_INTERVAL_MS = 30000;

// Advisory only: the server flags accounts whose limits the amount would exceed.
const isOverLimit = (account) => account.available === false;

const getContactLine = (account) => {
  const { email, phone } = getZelleAccountPublicContact(account);
  return email || phone || null;
};

const ZelleAccountSelector = ({
  onSelect,
  usageType = 'remittances',
  selectedAccountId = null,
  amount
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
      // The RPC already returns only active accounts for this usage type
      const filteredAccounts = (await getZelleAccountsForCustomer(usageType, amount)) || [];

      // Check if currently selected account is still valid
      if (selectedAccount) {
        const stillExists = filteredAccounts.some(acc => acc.id === selectedAccount.id);
        if (!stillExists) {
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
      // Background refreshes fail silently; only the explicit/initial load alerts the user
      if (showLoading) {
        toast({
          title: t('common.error'),
          description: error?.message || t('zelle.loadError'),
          variant: 'destructive'
        });
      }
    }
    if (showLoading) setLoading(false);
  }, [usageType, amount, selectedAccount, selectedAccountId, onSelect, t]);

  // Always call the latest loader from timers/listeners (it closes over the selection)
  const loadAccountsRef = useRef(loadAccounts);
  useEffect(() => {
    loadAccountsRef.current = loadAccounts;
  }, [loadAccounts]);

  // Initial load
  useEffect(() => {
    loadAccounts();
  }, [usageType, amount]);

  // Refresh periodically and when the user returns to the tab/window, so a
  // deactivated account is detected without table realtime (customers get no events).
  useEffect(() => {
    const refresh = () => loadAccountsRef.current(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const intervalId = setInterval(refresh, ZELLE_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [usageType]);

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

      {/* Conditional render: Cards for ≤2 accounts, Dropdown for >2 (Req 6dup) */}
      {accounts.length <= 2 ? (
        /* Card-based selection for few accounts */
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
                      <p className="text-sm text-gray-600">{getContactLine(account)}</p>
                      {isOverLimit(account) && (
                        <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          {t('zelle.overLimitWarning')}
                        </p>
                      )}
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
      ) : (
        /* Dropdown selection for many accounts (Req 6dup) */
        <div className="space-y-3">
          <div className="relative">
            <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <select
              value={selectedAccount?.id || ''}
              onChange={(e) => {
                const account = accounts.find(a => a.id === e.target.value);
                if (account) handleSelect(account);
              }}
              className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg bg-white text-gray-900 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all appearance-none"
            >
              <option value="">{t('zelle.selectAccountPlaceholder') || 'Selecciona una cuenta Zelle'}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {[account.account_name, getContactLine(account), isOverLimit(account) ? `(${t('zelle.overLimitWarning')})` : null].filter(Boolean).join(' - ')}
                </option>
              ))}
            </select>
          </div>

          {/* Show selected account details */}
          {selectedAccount && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-blue-50 border border-blue-200 rounded-lg"
            >
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <p className="font-semibold text-gray-900">{selectedAccount.account_name}</p>
                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full font-medium">
                  {t('zelle.active')}
                </span>
              </div>
              <p className="text-sm text-gray-600">{getContactLine(selectedAccount)}</p>
              {isOverLimit(selectedAccount) && (
                <p className="text-xs text-amber-700 mt-1">{t('zelle.overLimitWarning')}</p>
              )}
            </motion.div>
          )}
        </div>
      )}

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
