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
  showCreateButton = true,
  selectedRemittanceType = null // Tipo de remesa seleccionado
}) => {
  const { language, t } = useLanguage();
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
      // getBankAccountsForRecipient returns array directly or throws exception
      const accountsData = await getBankAccountsForRecipient(recipientId);
      setAccounts(accountsData || []);

      // Auto-select default account if available
      const defaultAccount = accountsData?.find(a => a.is_default);
      if (defaultAccount) {
        setSelectedAccount(defaultAccount);
        if (onSelect) {
          onSelect(defaultAccount);
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
      // linkBankAccountToRecipient returns link data directly or throws exception
      const linkData = await linkBankAccountToRecipient(
        recipientId,
        newAccount.id,
        accounts.length === 0 // Set as default if it's the first account
      );

      // Add to local list
      const accountWithDetails = {
        ...linkData,
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

          {/* Show as cards for 1-3 accounts, dropdown for 4+ */}
          {accounts.length <= 3 ? (
            <div className="space-y-2">
              {accounts.map((account) => {
                const logoPath = account.bank_account?.bank?.logo_filename
                  ? `/bank-logos/${account.bank_account.bank.logo_filename}`
                  : null;
                const currencyCode = account.bank_account?.currency?.code || '';
                const isSelected = selectedAccount?.id === account.id;

                return (
                  <motion.button
                    key={account.id}
                    type="button"
                    onClick={() => handleAccountSelect(account)}
                    className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
                    }`}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Bank Logo */}
                      <div className="flex-shrink-0">
                        {logoPath ? (
                          <img
                            src={logoPath}
                            alt={account.bank_account?.bank?.name}
                            className="w-12 h-12 object-contain rounded"
                            onError={(e) => {
                              e.target.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded flex items-center justify-center">
                            <CreditCard className="w-6 h-6 text-white" />
                          </div>
                        )}
                      </div>

                      {/* Account Info */}
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900 truncate">
                            {account.bank_account?.bank?.name}
                          </p>
                          {currencyCode && (
                            <span className="px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded">
                              {currencyCode}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">
                          {account.bank_account?.account_type?.name} • ****{account.bank_account?.account_number_last4}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {language === 'es' ? 'Titular:' : 'Holder:'} {account.bank_account?.account_holder_name}
                        </p>
                      </div>

                      {/* Selection indicator & Default Badge */}
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        {isSelected && (
                          <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {account.is_default && (
                          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full whitespace-nowrap">
                            {language === 'es' ? 'Por defecto' : 'Default'}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            // Dropdown select for 4+ accounts
            <div className="relative">
              <select
                value={selectedAccount?.id || ''}
                onChange={(e) => {
                  const account = accounts.find(a => a.id === e.target.value);
                  if (account) handleAccountSelect(account);
                }}
                className="w-full px-4 py-3 pr-10 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none appearance-none bg-white cursor-pointer"
              >
                <option value="">
                  {language === 'es' ? 'Selecciona una cuenta...' : 'Select an account...'}
                </option>
                {accounts.map((account) => {
                  const currencyCode = account.bank_account?.currency?.code || '';
                  const bankName = account.bank_account?.bank?.name || '';
                  const last4 = account.bank_account?.account_number_last4 || '';
                  const accountType = account.bank_account?.account_type?.name || '';
                  const isDefault = account.is_default ? ` (${language === 'es' ? 'Por defecto' : 'Default'})` : '';

                  return (
                    <option key={account.id} value={account.id}>
                      {bankName} - {accountType} ****{last4} ({currencyCode}){isDefault}
                    </option>
                  );
                })}
              </select>
              <CreditCard className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
          )}
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
            className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200 relative"
          >
            <h3 className="font-semibold text-gray-900 mb-4">
              {language === 'es' ? 'Crear Nueva Cuenta Bancaria' : 'Create New Bank Account'}
            </h3>
            <BankAccountForm
              userId={user?.id}
              onSuccess={handleAccountCreated}
              onCancel={() => setShowForm(false)}
              selectedRemittanceType={selectedRemittanceType}
            />

            {/* Loading overlay while linking account to recipient */}
            {creatingAccount && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                <div className="text-center">
                  <Loader className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-700">
                    {t('bankAccounts.linkingToRecipient')}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection Info */}
      {selectedAccount && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-green-50 rounded-lg border border-green-200"
        >
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800">
                {language === 'es' ? 'Cuenta seleccionada' : 'Selected account'}
              </p>
              <p className="text-xs text-green-700 mt-1">
                {selectedAccount.bank_account?.bank?.name} • {selectedAccount.bank_account?.account_type?.name} ****{selectedAccount.bank_account?.account_number_last4} ({selectedAccount.bank_account?.currency?.code})
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default BankAccountSelector;
