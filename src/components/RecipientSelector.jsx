/**
 * RecipientSelector Component
 * Smart component for selecting or creating recipients
 * Uses RecipientForm for creating new recipients
 * Adapts based on use case (remittances, orders, etc)
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Home, Search, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getMyRecipients, createRecipient, addRecipientAddress } from '@/lib/recipientService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import RecipientForm from '@/components/RecipientForm';
import BankAccountSelector from '@/components/BankAccountSelector';

const RecipientSelector = React.forwardRef((
  {
    onSelect,
    shippingZones = [],
    showAddressSelection = false,
    showProvinceInForm = false,
    deliveryMethod = 'cash', // 'cash' | 'transfer' | 'card' | 'moneypocket'
    selectedRecipientData = null, // For passing selected recipient context
    selectedRemittanceType = null // Tipo de remesa seleccionado para pasar al BankAccountSelector
  },
  ref
) => {
  const { t, language } = useLanguage();
  const [recipients, setRecipients] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [municipalities, setMunicipalities] = useState([]);
  const [creatingRecipient, setCreatingRecipient] = useState(false);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '',
    id_number: '',
    province: '',
    municipality: '',
    address_line_1: '',
    address_line_2: '',
    notes: ''
  });

  useEffect(() => {
    loadRecipients();
  }, []);

  // Restore selection state from prop when recipients load or prop changes
  useEffect(() => {
    if (selectedRecipientData && recipients.length > 0) {
      // Find the recipient in the loaded list
      const recipientId = selectedRecipientData.recipientId;
      const recipient = recipients.find(r => r.id === recipientId);

      if (recipient && recipient.id !== selectedRecipient?.id) {
        setSelectedRecipient(recipient);

        // Restore address selection
        if (selectedRecipientData.addressId && recipient.addresses) {
          const address = recipient.addresses.find(a => a.id === selectedRecipientData.addressId);
          if (address) {
            setSelectedAddress(address);
          }
        } else if (recipient.addresses?.length > 0) {
          const defaultAddr = recipient.addresses.find(a => a.is_default) || recipient.addresses[0];
          setSelectedAddress(defaultAddr);
        }

        // Restore bank account selection for off-cash remittances
        if (selectedRecipientData.recipient_bank_account_id) {
          setSelectedBankAccountId(selectedRecipientData.recipient_bank_account_id);
        }
      }
    }
  }, [selectedRecipientData, recipients]);

  useEffect(() => {
    if (ref) {
      ref.current = {
        loadRecipients,
        resetForm: resetForm
      };
    }
  }, [ref]);

  const loadRecipients = async () => {
    setLoading(true);
    try {
      const recipients = await getMyRecipients();
      setRecipients(recipients || []);
    } catch (error) {
      console.error('Error loading recipients:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const resetForm = () => {
    setShowForm(false);
    setFormData({
      full_name: '',
      phone: '',
      email: '',
      id_number: '',
      province: '',
      municipality: '',
      address_line_1: '',
      address_line_2: '',
      notes: ''
    });
    setMunicipalities([]);
  };

  // Helper: Check if a province has a valid shipping zone (cost > 0 OR free_shipping = true)
  const hasValidShippingZone = (provinceName) => {
    if (!provinceName || shippingZones.length === 0) return false;
    const zone = shippingZones.find(z =>
      z.province_name?.toLowerCase().trim() === provinceName.toLowerCase().trim() &&
      z.municipality_name === null // Province-level zone
    );
    if (!zone) return false;
    // Valid if: has shipping cost > 0 OR is marked as free shipping
    return zone.shipping_cost > 0 || zone.free_shipping === true;
  };

  // Helper: Check if recipient has at least one address with valid shipping zone
  const hasValidAddress = (recipient) => {
    if (!recipient.addresses || recipient.addresses.length === 0) return false;
    return recipient.addresses.some(addr => hasValidShippingZone(addr.province));
  };

  // Filter recipients: must have valid address with valid shipping zone
  // Also filter by search term
  const filteredRecipients = useMemo(() => {
    // First filter by valid shipping zones
    const validRecipients = recipients.filter(r => hasValidAddress(r));

    // Then filter by search term
    if (!searchTerm) return validRecipients;
    const term = searchTerm.toLowerCase();
    return validRecipients.filter(r =>
      r.full_name.toLowerCase().includes(term) ||
      r.phone.includes(term) ||
      r.email?.toLowerCase().includes(term)
    );
  }, [recipients, searchTerm, shippingZones]);

  // Get valid provinces (those with shipping cost > 0 or free_shipping = true)
  const validProvinces = useMemo(() => {
    return shippingZones
      .filter(z => z.municipality_name === null && (z.shipping_cost > 0 || z.free_shipping === true))
      .map(z => z.province_name);
  }, [shippingZones]);

  const handleRecipientSelect = (recipient) => {
    setSelectedRecipient(recipient);
    setSelectedAddress(null);

    if (recipient.addresses && recipient.addresses.length > 0) {
      const defaultAddr = recipient.addresses.find(a => a.is_default) || recipient.addresses[0];
      setSelectedAddress(defaultAddr);
      onSelect({
        recipientId: recipient.id,
        addressId: defaultAddr.id,
        isNew: false,
        recipientData: recipient
      });
    }
  };

  const handleAddressSelect = (address) => {
    setSelectedAddress(address);
    onSelect({
      recipientId: selectedRecipient.id,
      addressId: address.id,
      isNew: false,
      recipientData: selectedRecipient
    });
  };

  const handleProvinceChange = (province) => {
    setFormData({ ...formData, province, municipality: '' });
    if (province) {
      const muns = getMunicipalitiesByProvince(province) || [];
      setMunicipalities(muns);
    } else {
      setMunicipalities([]);
    }
  };

  const handleFormSubmit = async () => {
    if (!formData.full_name || !formData.phone) {
      toast({
        title: t('common.error'),
        description: t('recipients.fillNameAndPhone'),
        variant: 'destructive'
      });
      return;
    }

    if (showProvinceInForm && (!formData.province || !formData.municipality || !formData.address_line_1)) {
      toast({
        title: t('common.error'),
        description: language === 'es' ? 'Completa provincia, municipio y dirección' : 'Complete province, municipality and address',
        variant: 'destructive'
      });
      return;
    }

    // Validate province has valid shipping zone
    if (showProvinceInForm && formData.province && !hasValidShippingZone(formData.province)) {
      toast({
        title: t('common.error'),
        description: language === 'es'
          ? 'La provincia seleccionada no tiene costo de envío configurado. Contacta al administrador.'
          : 'Selected province does not have shipping cost configured. Contact administrator.',
        variant: 'destructive'
      });
      return;
    }

    setCreatingRecipient(true);

    try {
      // Create recipient
      const recipientResult = await createRecipient({
        full_name: formData.full_name,
        phone: formData.phone,
        email: formData.email || '',
        id_number: formData.id_number || ''
      });

      if (!recipientResult.success) {
        throw new Error(recipientResult.error);
      }

      const newRecipientId = recipientResult.recipient.id;

      // Create address if provinces are shown
      if (showProvinceInForm && formData.province) {
        const addressResult = await addRecipientAddress({
          recipient_id: newRecipientId,
          address_line_1: formData.address_line_1,
          address_line_2: formData.address_line_2 || '',
          province: formData.province,
          municipality: formData.municipality,
          is_default: true
        });

        if (!addressResult.success) {
          throw new Error(addressResult.error);
        }

        toast({
          title: t('common.success'),
          description: t('recipients.recipientCreated')
        });
      }

      // Reload and notify
      await loadRecipients();

      // Auto-select the new recipient
      const newRecipient = {
        ...recipientResult.recipient,
        addresses: showProvinceInForm ? [{
          id: recipientResult.address?.id,
          address_line_1: formData.address_line_1,
          address_line_2: formData.address_line_2,
          province: formData.province,
          municipality: formData.municipality,
          is_default: true
        }] : []
      };

      handleRecipientSelect(newRecipient);
      resetForm();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error.message || t('common.error'),
        variant: 'destructive'
      });
    } finally {
      setCreatingRecipient(false);
    }
  };

  if (loading) {
    return <div className="p-4 bg-gray-50 rounded-lg"><p className="text-sm">{t('common.loading')}</p></div>;
  }

  return (
    <div className="space-y-4">
      {/* Existing Recipients */}
      {recipients.length > 0 && !showForm && (
        <div>
          <label className="block text-sm font-semibold mb-3">
            {language === 'es' ? 'Selecciona un Destinatario' : 'Select a Recipient'}
          </label>

          {/* Search Input */}
          {recipients.length > 7 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={language === 'es' ? 'Buscar por nombre, teléfono o email...' : 'Search by name, phone or email...'}
                className="w-full pl-10 pr-10 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Recipients List - Conditional render: Cards for ≤2, Dropdown for >2 (Req 6dup) */}
          {recipients.length <= 2 ? (
            /* Card-based selection for few recipients */
            <div className="space-y-2">
              {filteredRecipients.length > 0 ? (
                filteredRecipients.map((recipient) => (
                  <motion.button
                    key={recipient.id}
                    onClick={() => handleRecipientSelect(recipient)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      selectedRecipient?.id === recipient.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <p className="font-medium">{recipient.full_name}</p>
                    <p className="text-xs text-gray-500">{recipient.phone}</p>
                  </motion.button>
                ))
              ) : (
                <div className="p-4 bg-gray-50 rounded-lg text-center">
                  <p className="text-sm text-gray-600">
                    {language === 'es' ? 'No se encontraron destinatarios' : 'No recipients found'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Dropdown selection for many recipients (Req 6dup) */
            <div className="space-y-3">
              <select
                value={selectedRecipient?.id || ''}
                onChange={(e) => {
                  const recipient = recipients.find(r => r.id === e.target.value);
                  if (recipient) handleRecipientSelect(recipient);
                }}
                className="w-full p-3 border-2 border-gray-200 rounded-lg bg-white text-gray-900 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="">{language === 'es' ? 'Selecciona un destinatario' : 'Select a recipient'}</option>
                {filteredRecipients.map((recipient) => (
                  <option key={recipient.id} value={recipient.id}>
                    {recipient.full_name} - {recipient.phone}
                  </option>
                ))}
              </select>

              {/* Show selected recipient details */}
              {selectedRecipient && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-blue-50 border border-blue-200 rounded-lg"
                >
                  <p className="font-semibold text-gray-900">{selectedRecipient.full_name}</p>
                  <p className="text-sm text-gray-600">{selectedRecipient.phone}</p>
                  {selectedRecipient.email && (
                    <p className="text-xs text-gray-500">{selectedRecipient.email}</p>
                  )}
                </motion.div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Select Address from existing recipient (only for cash deliveries) */}
      {selectedRecipient && selectedRecipient.addresses?.length > 1 && showAddressSelection && deliveryMethod === 'cash' && (
        <div>
          <label className="block text-sm font-semibold mb-3">
            {language === 'es' ? 'Selecciona Dirección' : 'Select Address'}
          </label>
          <div className="space-y-2">
            {selectedRecipient.addresses.map((address) => (
              <motion.button
                key={address.id}
                onClick={() => handleAddressSelect(address)}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                  selectedAddress?.id === address.id
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                whileHover={{ scale: 1.01 }}
              >
                <div className="flex items-start gap-2">
                  <Home className="w-4 h-4 mt-0.5 text-gray-600" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium">{address.address_line_1}</p>
                    <p className="text-xs text-gray-600">{address.municipality}, {address.province}</p>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Bank Account Selector (only for non-cash deliveries: transfer, card, moneypocket) */}
      {selectedRecipient && deliveryMethod !== 'cash' && (
        <div className="border-t pt-4">
          <BankAccountSelector
            recipientId={selectedRecipient.id}
            onSelect={(account) => {
              // account.id = recipient_bank_accounts.id (the link table)
              // account.bank_account.id = bank_accounts.id (the actual account)
              const recipientBankAccountId = account.id;
              setSelectedBankAccountId(recipientBankAccountId);
              onSelect({
                recipientId: selectedRecipient.id,
                addressId: selectedAddress?.id,
                isNew: false,
                recipientData: selectedRecipient,
                recipient_bank_account_id: recipientBankAccountId,
                bank_account_details: account.bank_account
              });
            }}
            showCreateButton={true}
            selectedRemittanceType={selectedRemittanceType}
          />
        </div>
      )}

      {/* Create New Recipient Button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
      >
        <Plus className="w-5 h-5" />
        {language === 'es' ? 'Crear Nuevo Destinatario' : 'Create New Recipient'}
      </button>

      {/* New Recipient Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200"
          >
            <RecipientForm
              formData={formData}
              onChange={setFormData}
              shippingZones={shippingZones}
              municipalities={municipalities}
              onProvinceChange={handleProvinceChange}
              onMunicipalityChange={(municipality) => setFormData({ ...formData, municipality })}
              submitLabel={language === 'es' ? 'Guardar Destinatario' : 'Save Recipient'}
              onSubmit={handleFormSubmit}
              onCancel={resetForm}
              deliveryMethod={deliveryMethod}
              recipientId={selectedRecipientData?.recipientId || null}
              fields={{
                fullName: true,
                phone: true,
                email: true,
                idNumber: false,
                province: showProvinceInForm && deliveryMethod === 'cash',
                municipality: showProvinceInForm && deliveryMethod === 'cash',
                address: showProvinceInForm && deliveryMethod === 'cash',
                notes: false
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

RecipientSelector.displayName = 'RecipientSelector';

export default RecipientSelector;
