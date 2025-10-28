/**
 * BankAccountForm Component
 * Form for creating and managing user bank accounts
 * Supports multiple currencies and bank institutions
 * Used in BankAccountSelector for non-cash remittances
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { createBankAccount } from '@/lib/recipientService';
import { getAllBanks, getAllAccountTypes } from '@/lib/bankService';
import { Building2, DollarSign, AlertCircle, Loader } from 'lucide-react';

const BankAccountForm = ({
  userId,
  onSuccess,
  onCancel,
  recipientId = null
}) => {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [banks, setBanks] = useState([]);
  const [accountTypes, setAccountTypes] = useState([]);

  const [formData, setFormData] = useState({
    bankId: '',
    accountTypeId: '',
    currencyId: 'USD', // Default to USD
    accountNumber: '',
    accountHolderName: ''
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    loadBankData();
  }, []);

  const loadBankData = async () => {
    setLoadingData(true);
    try {
      const [banksResult, typesResult] = await Promise.all([
        getAllBanks(),
        getAllAccountTypes()
      ]);

      if (banksResult.success) {
        setBanks(banksResult.data || []);
      }
      if (typesResult.success) {
        setAccountTypes(typesResult.data || []);
      }
    } catch (error) {
      console.error('Error loading bank data:', error);
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: language === 'es'
          ? 'No se pudo cargar la información bancaria'
          : 'Failed to load bank information',
        variant: 'destructive'
      });
    } finally {
      setLoadingData(false);
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.bankId) {
      newErrors.bankId = language === 'es' ? 'Selecciona un banco' : 'Select a bank';
    }
    if (!formData.accountTypeId) {
      newErrors.accountTypeId = language === 'es' ? 'Selecciona tipo de cuenta' : 'Select account type';
    }
    if (!formData.accountNumber || formData.accountNumber.length < 8) {
      newErrors.accountNumber = language === 'es'
        ? 'Número de cuenta inválido (mínimo 8 dígitos)'
        : 'Invalid account number (minimum 8 digits)';
    }
    if (!formData.accountHolderName || formData.accountHolderName.trim().length === 0) {
      newErrors.accountHolderName = language === 'es' ? 'Ingresa nombre del titular' : 'Enter account holder name';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const result = await createBankAccount(userId, {
        bankId: formData.bankId,
        accountTypeId: formData.accountTypeId,
        currencyId: formData.currencyId,
        accountNumber: formData.accountNumber.replace(/\s/g, ''),
        accountHolderName: formData.accountHolderName.trim()
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      toast({
        title: language === 'es' ? 'Éxito' : 'Success',
        description: language === 'es'
          ? 'Cuenta bancaria creada exitosamente'
          : 'Bank account created successfully',
        variant: 'default'
      });

      // Call success callback with created account
      if (onSuccess) {
        onSuccess(result.data);
      }
    } catch (error) {
      console.error('Error creating bank account:', error);
      toast({
        title: language === 'es' ? 'Error' : 'Error',
        description: error.message || (language === 'es'
          ? 'Error al crear la cuenta bancaria'
          : 'Failed to create bank account'),
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-center gap-3">
          <Loader className="w-5 h-5 animate-spin text-blue-600" />
          <p className="text-gray-600">
            {language === 'es' ? 'Cargando información...' : 'Loading information...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Bank Selection */}
      <div>
        <label className="block text-sm font-semibold mb-2">
          {language === 'es' ? 'Banco' : 'Bank'} <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Building2 className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <select
            value={formData.bankId}
            onChange={(e) => setFormData({ ...formData, bankId: e.target.value })}
            className={`w-full pl-10 pr-4 py-2 border-2 rounded-lg transition-colors input-style ${
              errors.bankId ? 'border-red-500 bg-red-50' : 'border-gray-200'
            }`}
          >
            <option value="">
              {language === 'es' ? 'Selecciona un banco...' : 'Select a bank...'}
            </option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.name} {bank.local_code ? `(${bank.local_code})` : ''}
              </option>
            ))}
          </select>
        </div>
        {errors.bankId && (
          <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {errors.bankId}
          </p>
        )}
      </div>

      {/* Account Type Selection */}
      <div>
        <label className="block text-sm font-semibold mb-2">
          {language === 'es' ? 'Tipo de Cuenta' : 'Account Type'} <span className="text-red-500">*</span>
        </label>
        <select
          value={formData.accountTypeId}
          onChange={(e) => setFormData({ ...formData, accountTypeId: e.target.value })}
          className={`w-full px-4 py-2 border-2 rounded-lg transition-colors input-style ${
            errors.accountTypeId ? 'border-red-500 bg-red-50' : 'border-gray-200'
          }`}
        >
          <option value="">
            {language === 'es' ? 'Selecciona tipo de cuenta...' : 'Select account type...'}
          </option>
          {accountTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
              {type.description && ` - ${type.description}`}
            </option>
          ))}
        </select>
        {errors.accountTypeId && (
          <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {errors.accountTypeId}
          </p>
        )}
      </div>

      {/* Currency Selection */}
      <div>
        <label className="block text-sm font-semibold mb-2">
          {language === 'es' ? 'Moneda' : 'Currency'} <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <DollarSign className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <select
            value={formData.currencyId}
            onChange={(e) => setFormData({ ...formData, currencyId: e.target.value })}
            className="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-lg input-style"
          >
            <option value="USD">USD - Dólares Estadounidenses</option>
            <option value="CUP">CUP - Pesos Cubanos</option>
            <option value="MLC">MLC - Moneda Libremente Convertible</option>
          </select>
        </div>
      </div>

      {/* Account Number */}
      <div>
        <label className="block text-sm font-semibold mb-2">
          {language === 'es' ? 'Número de Cuenta' : 'Account Number'} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.accountNumber}
          onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
          placeholder={language === 'es' ? 'Ingresa número de cuenta' : 'Enter account number'}
          className={`w-full px-4 py-2 border-2 rounded-lg transition-colors input-style ${
            errors.accountNumber ? 'border-red-500 bg-red-50' : 'border-gray-200'
          }`}
        />
        {errors.accountNumber && (
          <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {errors.accountNumber}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          {language === 'es'
            ? '💡 Solo se guardan los últimos 4 dígitos'
            : '💡 Only last 4 digits are stored'}
        </p>
      </div>

      {/* Account Holder Name */}
      <div>
        <label className="block text-sm font-semibold mb-2">
          {language === 'es' ? 'Nombre del Titular' : 'Account Holder Name'} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.accountHolderName}
          onChange={(e) => setFormData({ ...formData, accountHolderName: e.target.value })}
          placeholder={language === 'es' ? 'Nombre completo del titular' : 'Full name of account holder'}
          className={`w-full px-4 py-2 border-2 rounded-lg transition-colors input-style ${
            errors.accountHolderName ? 'border-red-500 bg-red-50' : 'border-gray-200'
          }`}
        />
        {errors.accountHolderName && (
          <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {errors.accountHolderName}
          </p>
        )}
      </div>

      {/* Security Note */}
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-xs text-blue-800">
          {language === 'es'
            ? '🔒 Los números de cuenta se almacenan encriptados de forma segura'
            : '🔒 Account numbers are stored securely and encrypted'}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-4 border-t">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              {language === 'es' ? 'Guardando...' : 'Saving...'}
            </>
          ) : (
            language === 'es' ? 'Crear Cuenta' : 'Create Account'
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-lg hover:bg-gray-400 transition-colors font-medium"
        >
          {language === 'es' ? 'Cancelar' : 'Cancel'}
        </button>
      </div>
    </form>
  );
};

export default BankAccountForm;
