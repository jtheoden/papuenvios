/**
 * RecipientForm Component
 * Reusable form for creating/editing recipients
 * Includes ProvinceSelector for address selection
 * Flexible for different use cases (remittances, orders, etc)
 *
 * FUTURE ENHANCEMENT - Bank Accounts Integration:
 * This component will be extended to support bank account management.
 * When showBankAccounts field is enabled, the form will display:
 * - Bank account selector (select from user's linked bank accounts)
 * - Add new bank account button (opens BankAccountForm modal)
 * - Account details preview (showing bank name, account type, last 4 digits)
 * - Set as default account checkbox
 *
 * Expected future fields config:
 * {
 *   bankAccounts: false,        // Show linked bank accounts section
 *   primaryBankAccount: false,  // Show primary account selector
 *   allowAddNewAccount: false   // Allow creating new bank account inline
 * }
 *
 * Bank account data flow:
 * - formData.bank_account_id: UUID of selected bank account
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

      {/* Province & Municipality */}
      {(fields.province || fields.municipality) && (
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

      {/*
        FUTURE SECTION: Bank Accounts

        When fields.bankAccounts is enabled, this section will render:

        {fields.bankAccounts && (
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-3">
              {language === 'es' ? 'Cuentas Bancarias' : 'Bank Accounts'}
            </p>

            {/* Bank account selector dropdown */}
            {/* Add new account button (opens BankAccountForm modal) */}
            {/* Account details preview */}
            {/* Set as default checkbox */}
          </div>
        )}

        Implementation references:
        - Use recipientService.getBankAccountsForRecipient(recipientId)
        - Use recipientService.linkBankAccountToRecipient(recipientId, bankAccountId)
        - Reference types from @/types/banking: BankAccountDetail, RecipientBankAccount
      */}

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
