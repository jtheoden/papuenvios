/**
 * RecipientForm Component
 * Reusable form for creating/editing recipients
 * Includes ProvinceSelector for address selection
 * Flexible for different use cases (remittances, orders, etc)
 *
 * ENHANCEMENT - Bank Accounts Integration:
 * Supports conditional display of bank accounts or address based on delivery method.
 * When deliveryMethod prop is provided and not 'cash':
 * - Shows bank account selector instead of province/address fields
 * - Allows recipient selection to have linked bank accounts
 * - Replaces address selection with account selection
 *
 * Props:
 * - deliveryMethod: 'cash' | 'transfer' | 'card' | 'moneypocket' (optional)
 *   When set to non-cash value, shows bank accounts instead of address
 *
 * Data flow:
 * - formData.bank_account_id: UUID of selected bank account (for transfers)
 * - formData.linked_bank_accounts: Array of RecipientBankAccount objects
 * - onChange will include bank account selection changes
 *
 * Related services:
 * - @/lib/recipientService - getBankAccountsForRecipient(), linkBankAccountToRecipient()
 * - @/lib/bankService - getAllBanks(), getAllAccountTypes()
 * - @/types/banking - BankAccountDetail, RecipientBankAccount types
 */

import { useLanguage } from '@/contexts/LanguageContext';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import ProvinceSelector from '@/components/ProvinceSelector';
import { useState, useEffect } from 'react';
import { getBankAccountsForRecipient } from '@/lib/recipientService';
import { CreditCard, AlertCircle } from 'lucide-react';

const RecipientForm = ({
  formData = {},
  onChange,
  shippingZones = [],
  municipalities = [],
  onProvinceChange,
  onMunicipalityChange,
  submitLabel = 'Guardar',
  onSubmit,
  onCancel,
  deliveryMethod = 'cash', // 'cash' | 'transfer' | 'card' | 'moneypocket'
  recipientId = null, // Required if deliveryMethod is not 'cash'
  fields = {
    fullName: true,
    phone: true,
    email: true,
    idNumber: false,
    province: false,
    municipality: false,
    address: false,
    notes: false
  }
}) => {
  const { language } = useLanguage();
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedBankAccount, setSelectedBankAccount] = useState(null);

  // Load bank accounts for non-cash remittances
  useEffect(() => {
    if (deliveryMethod !== 'cash' && recipientId) {
      loadBankAccounts();
    }
  }, [deliveryMethod, recipientId]);

  const loadBankAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const result = await getBankAccountsForRecipient(recipientId);
      if (result.success) {
        setBankAccounts(result.data || []);
        // Auto-select default if available
        const defaultAccount = result.data?.find(a => a.is_default);
        if (defaultAccount) {
          setSelectedBankAccount(defaultAccount);
          onChange({ ...formData, bank_account_id: defaultAccount.bank_account_id });
        }
      }
    } catch (error) {
      console.error('Error loading bank accounts:', error);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleBankAccountSelect = (account) => {
    setSelectedBankAccount(account);
    onChange({ ...formData, bank_account_id: account.bank_account_id });
  };

  const handleChange = (field, value) => {
    onChange({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-4">
      {/* Full Name */}
      {fields.fullName && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Nombre Completo' : 'Full Name'} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.full_name || ''}
            onChange={e => handleChange('full_name', e.target.value)}
            className="input-style w-full"
            placeholder={language === 'es' ? 'Juan Pérez' : 'John Doe'}
            required
          />
        </div>
      )}

      {/* Phone */}
      {fields.phone && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Teléfono' : 'Phone'} <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            value={formData.phone || ''}
            onChange={e => handleChange('phone', e.target.value)}
            className="input-style w-full"
            placeholder="+53 5555 5555"
            required
          />
        </div>
      )}

      {/* Email */}
      {fields.email && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Email' : 'Email'} ({language === 'es' ? 'opcional' : 'optional'})
          </label>
          <input
            type="email"
            value={formData.email || ''}
            onChange={e => handleChange('email', e.target.value)}
            className="input-style w-full"
            placeholder="john@example.com"
          />
        </div>
      )}

      {/* ID Number */}
      {fields.idNumber && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Cédula/Identificación' : 'ID Number'} ({language === 'es' ? 'opcional' : 'optional'})
          </label>
          <input
            type="text"
            value={formData.id_number || ''}
            onChange={e => handleChange('id_number', e.target.value)}
            className="input-style w-full"
            placeholder="12345678901"
          />
        </div>
      )}

      {/* Bank Accounts (for non-cash remittances) OR Province & Municipality (for cash) */}
      {deliveryMethod !== 'cash' ? (
        // Bank Account Selector for non-cash remittances
        <div className="border-t pt-4">
          <p className="text-xs font-semibold text-gray-600 mb-3">
            {language === 'es' ? 'Cuenta Bancaria' : 'Bank Account'} <span className="text-red-500">*</span>
          </p>

          {loadingAccounts ? (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
              <p className="text-sm text-gray-600">{language === 'es' ? 'Cargando cuentas...' : 'Loading accounts...'}</p>
            </div>
          ) : bankAccounts.length > 0 ? (
            <div className="space-y-2">
              {bankAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => handleBankAccountSelect(account)}
                  className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                    selectedBankAccount?.id === account.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-blue-600" />
                        <p className="font-medium text-gray-900">{account.bank_account?.bank?.name}</p>
                      </div>
                      <p className="text-sm text-gray-600">
                        {account.bank_account?.account_type?.name} • ****{account.bank_account?.account_number_last4}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{account.bank_account?.account_holder_name}</p>
                    </div>
                    {account.is_default && (
                      <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                        {language === 'es' ? 'Por defecto' : 'Default'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
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
                    ? 'Este destinatario no tiene cuentas bancarias vinculadas'
                    : 'This recipient has no linked bank accounts'}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Province & Municipality for cash deliveries
        (fields.province || fields.municipality) && (
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-3">
              {language === 'es' ? 'Información de Entrega' : 'Delivery Information'}
            </p>
            <ProvinceSelector
              shippingZones={shippingZones}
              selectedProvince={formData.province || ''}
              selectedMunicipality={formData.municipality || ''}
              municipalities={municipalities}
              onProvinceChange={onProvinceChange}
              onMunicipalityChange={onMunicipalityChange}
              showLabel={true}
            />
          </div>
        )
      )}

      {/* Address */}
      {fields.address && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Dirección' : 'Address'} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.address_line_1 || ''}
            onChange={e => handleChange('address_line_1', e.target.value)}
            className="input-style w-full"
            placeholder={language === 'es' ? 'Calle 23, entre L y M' : 'Street address'}
            required
          />
          {formData.address_line_2 && (
            <input
              type="text"
              value={formData.address_line_2}
              onChange={e => handleChange('address_line_2', e.target.value)}
              className="input-style w-full mt-2"
              placeholder={language === 'es' ? 'Apartamento, suite, etc (opcional)' : 'Apartment, suite, etc (optional)'}
            />
          )}
        </div>
      )}

      {/* Notes */}
      {fields.notes && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'es' ? 'Notas' : 'Notes'} ({language === 'es' ? 'opcional' : 'optional'})
          </label>
          <textarea
            value={formData.notes || ''}
            onChange={e => handleChange('notes', e.target.value)}
            className="input-style w-full"
            rows="3"
            placeholder={language === 'es' ? 'Información adicional...' : 'Additional information...'}
          />
        </div>
      )}


      {/* Action Buttons */}
      {(onSubmit || onCancel) && (
        <div className="flex gap-2 pt-4 border-t">
          {onSubmit && (
            <button
              onClick={onSubmit}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {submitLabel}
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-lg hover:bg-gray-400 transition-colors font-medium"
            >
              {language === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default RecipientForm;
