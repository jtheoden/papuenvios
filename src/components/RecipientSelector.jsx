/**
 * RecipientSelector Component
 * Smart component for selecting or creating recipients
 * Uses RecipientForm for creating new recipients
 * Adapts based on use case (remittances, orders, etc)
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Home } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getMyRecipients, createRecipient, addRecipientAddress } from '@/lib/recipientService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import RecipientForm from '@/components/RecipientForm';

const RecipientSelector = React.forwardRef((
  {
    onSelect,
    shippingZones = [],
    showAddressSelection = false,
    showProvinceInForm = false
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

  useEffect(() => {
    ref.current = {
      loadRecipients,
      resetForm: resetForm
    };
  }, [ref]);

  const loadRecipients = async () => {
    setLoading(true);
    const result = await getMyRecipients();
    if (result.success) {
      setRecipients(result.recipients || []);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
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
        description: language === 'es' ? 'Nombre y teléfono requeridos' : 'Name and phone required',
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
          description: language === 'es' ? 'Destinatario creado' : 'Recipient created'
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
        description: error.message || (language === 'es' ? 'Error al crear destinatario' : 'Error creating recipient'),
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
          <div className="space-y-2">
            {recipients.map((recipient) => (
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
            ))}
          </div>
        </div>
      )}

      {/* Select Address from existing recipient */}
      {selectedRecipient && selectedRecipient.addresses?.length > 1 && showAddressSelection && (
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
              fields={{
                fullName: true,
                phone: true,
                email: true,
                idNumber: false,
                province: showProvinceInForm,
                municipality: showProvinceInForm,
                address: showProvinceInForm,
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
