/**
 * BankAccountSelector Component
 * Allows selecting existing bank accounts for a recipient
 * Or creating new bank accounts for non-cash remittances
 * Used in remittance flows when delivery_method is transfer/card/moneypocket
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getBankAccountsForRecipient, linkBankAccountToRecipient } from '@/lib/recipientService';
import BankAccountForm from '@/components/BankAccountForm';
import { CreditCard, Plus, AlertCircle, Loader } from 'lucide-react';

const BankAccountSelector = ({
  recipientId,
  onSelect,
  showCreateButton = true
}) => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);

  useEffect(() => {
    if (recipientId) {
      loadBankAccounts();
    }
  }, [recipientId]);

  const loadBankAccounts = async () => {
    setLoading(true);
    try {
      const result = await getBankAccountsForRecipient(recipientId);
      if (result.success) {
        setAccounts(result.data || []);
        // Auto-select default account if available
        const defaultAccount = result.data?.find(a => a.is_default);
        if (defaultAccount) {
          setSelectedAccount(defaultAccount);
          if (onSelect) {
            onSelect(defaultAccount);
          }
        }
      }
    } catch (error) {
      console.error('Error loading bank accounts:', error);
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: language === 'es'
          ? 'No se pudieron cargar las cuentas'
          : 'Failed to load accounts',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAccountSelect = (account) => {
    setSelectedAccount(account);
    if (onSelect) {
      onSelect(account);
    }
  };

  const handleAccountCreated = async (newAccount) => {
    setCreatingAccount(true);
    try {
      // Link the newly created account to the recipient
      const linkResult = await linkBankAccountToRecipient(
        recipientId,
        newAccount.id,
        accounts.length === 0 // Set as default if it's the first account
      );

      if (!linkResult.success) {
        throw new Error(linkResult.error);
      }

      // Add to local list
      const accountWithDetails = {
        ...linkResult.data,
        bank_account: newAccount
      };

      setAccounts([...accounts, accountWithDetails]);
      handleAccountSelect(accountWithDetails);

      toast({
        title: language === 'es' ? 'Éxito' : 'Success',
        description: language === 'es'
          ? 'Cuenta vinculada al destinatario'
          : 'Account linked to recipient',
        variant: 'default'
      });

      setShowForm(false);
    } catch (error) {
      console.error('Error linking account:', error);
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: error.message || (language === 'es'
          ? 'Error al vincular la cuenta'
          : 'Failed to link account'),
        variant: 'destructive'
      });
    } finally {
      setCreatingAccount(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg flex items-center gap-3">
        <Loader className="w-5 h-5 animate-spin text-blue-600" />
        <p className="text-sm text-gray-600">
          {language === 'es' ? 'Cargando cuentas...' : 'Loading accounts...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Accounts List */}
      {accounts.length > 0 ? (
        <div>
          <label className="block text-sm font-semibold mb-3">
            {language === 'es' ? 'Cuentas Bancarias Disponibles' : 'Available Bank Accounts'} <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {accounts.map((account) => (
              <motion.button
                key={account.id}
                type="button"
                onClick={() => handleAccountSelect(account)}
                className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                  selectedAccount?.id === account.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <p className="font-semibold text-gray-900">
                        {account.bank_account?.bank?.name}
                      </p>
                    </div>
                    <p className="text-sm text-gray-600">
                      {account.bank_account?.account_type?.name} • ****{account.bank_account?.account_number_last4}
                    </p>
                    <p className="text-xs text-gray-500">
                      {language === 'es' ? 'Titular:' : 'Holder:'} {account.bank_account?.account_holder_name}
                    </p>
                  </div>
                  <div className="ml-2 flex flex-col items-end gap-1">
                    {account.is_default && (
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full whitespace-nowrap">
                        {language === 'es' ? 'Por defecto' : 'Default'}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-4 bg-yellow-50 rounded-lg border-2 border-yellow-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-yellow-800">
              {language === 'es' ? 'Sin Cuentas Bancarias' : 'No Bank Accounts'}
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              {language === 'es'
                ? 'Este destinatario no tiene cuentas bancarias vinculadas. Crea una nueva.'
                : 'This recipient has no linked bank accounts. Create a new one.'}
            </p>
          </div>
        </div>
      )}

      {/* Create New Account Button */}
      {showCreateButton && !showForm && (
        <motion.button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors font-medium"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus className="w-5 h-5" />
          {language === 'es' ? 'Agregar Nueva Cuenta Bancaria' : 'Add New Bank Account'}
        </motion.button>
      )}

      {/* Create Account Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200"
          >
            <h3 className="font-semibold text-gray-900 mb-4">
              {language === 'es' ? 'Crear Nueva Cuenta Bancaria' : 'Create New Bank Account'}
            </h3>
            <BankAccountForm
              userId={user?.id}
              onSuccess={handleAccountCreated}
              onCancel={() => setShowForm(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection Info */}
      {selectedAccount && (
        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
          <p className="text-sm text-green-800">
            {language === 'es'
              ? '✓ Cuenta seleccionada: ' + selectedAccount.bank_account?.bank?.name
              : '✓ Selected account: ' + selectedAccount.bank_account?.bank?.name}
          </p>
        </div>
      )}
    </div>
  );
};

export default BankAccountSelector;
