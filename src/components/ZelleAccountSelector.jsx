/**
 * ZelleAccountSelector Component
 * Selector para elegir cuenta Zelle para pagos
 * Usado en SendRemittancePage y CartPage
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getAllZelleAccounts } from '@/lib/zelleService';

const ZelleAccountSelector = ({ onSelect }) => {
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    const result = await getAllZelleAccounts();
    if (result.success) {
      setAccounts(result.accounts || []);
      // Auto-select si solo hay una cuenta
      if (result.accounts?.length === 1) {
        setSelectedAccount(result.accounts[0]);
        onSelect(result.accounts[0]);
      }
    } else {
      toast({
        title: t('common.error'),
        description: result.error || 'Error al cargar cuentas Zelle',
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const handleSelect = (account) => {
    setSelectedAccount(account);
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
            Contacta a administración para configurar cuentas Zelle
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

      <div className="space-y-2">
        {accounts.map((account) => (
          <motion.button
            key={account.id}
            onClick={() => handleSelect(account)}
            className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
              selectedAccount?.id === account.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300'
            }`}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {/* Radio button visual */}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center flex-shrink-0 ${
                      selectedAccount?.id === account.id
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedAccount?.id === account.id && (
                      <div className="w-2 h-2 bg-white rounded-full" />
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
                        Prioridad: #{account.priority_order}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Badge de info */}
              {account.is_active && (
                <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                  Activa
                </span>
              )}
            </div>
          </motion.button>
        ))}
      </div>

      {/* Info de seleccionada */}
      {selectedAccount && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-green-50 border-l-4 border-green-500 rounded text-sm"
        >
          <p className="text-green-800">
            ✓ Pagarás a través de: <span className="font-semibold">{selectedAccount.account_name}</span>
          </p>
        </motion.div>
      )}
    </div>
  );
};

export default ZelleAccountSelector;
