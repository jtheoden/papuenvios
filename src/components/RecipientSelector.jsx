/**
 * RecipientSelector Component
 * Permite seleccionar un destinatario existente o crear uno nuevo
 * Usado en SendRemittancePage y CartPage
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronDown, Home } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getMyRecipients } from '@/lib/recipientService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import { getAvailableProvinces } from '@/lib/shippingService';

const RecipientSelector = React.forwardRef(({ onSelect, showAddressSelection = true }, ref) => {
  const { t } = useLanguage();
  const [recipients, setRecipients] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [municipalities, setMunicipalities] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const loadRecipientsRef = useRef(null);

  // Form data para nuevo destinatario
  const [newRecipient, setNewRecipient] = useState({
    full_name: '',
    phone: '',
    email: '',
    province: '',
    municipality: '',
    address_line_1: '',
    address_line_2: ''
  });

  useEffect(() => {
    loadRecipients();
    loadProvinces();
  }, []);

  // Expose loadRecipients to parent components via ref
  useEffect(() => {
    loadRecipientsRef.current = loadRecipients;
    if (ref) {
      ref.current = {
        loadRecipients,
        resetForm: () => {
          setShowNewForm(false);
          setNewRecipient({
            full_name: '',
            phone: '',
            email: '',
            province: '',
            municipality: '',
            address_line_1: '',
            address_line_2: ''
          });
        }
      };
    }
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

  const loadProvinces = async () => {
    // Load provinces from shipping zones (only provinces with shipping configured)
    const result = await getAvailableProvinces();
    if (result.success) {
      setProvinces(result.provinces || []);
      console.log('[RecipientSelector] Loaded available provinces:', result.provinces);
    } else {
      console.warn('[RecipientSelector] Failed to load provinces:', result.error);
      toast({
        title: t('common.error'),
        description: t('common.loadError') || 'Error loading provinces',
        variant: 'destructive'
      });
    }
  };

  const handleRecipientSelect = (recipient) => {
    setSelectedRecipient(recipient);
    setSelectedAddress(null);

    // Si hay una dirección predeterminada, seleccionarla
    if (recipient.addresses?.length > 0) {
      const defaultAddr = recipient.addresses.find(a => a.is_default) || recipient.addresses[0];
      setSelectedAddress(defaultAddr);
      onSelect({
        recipientId: recipient.id,
        addressId: defaultAddr.id,
        isNew: false,
        recipientData: recipient
      });
    } else if (recipient.addresses?.length === 1) {
      setSelectedAddress(recipient.addresses[0]);
      onSelect({
        recipientId: recipient.id,
        addressId: recipient.addresses[0].id,
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
    setNewRecipient({ ...newRecipient, province, municipality: '' });
    if (province) {
      // getMunicipalitiesByProvince retorna directamente un array de strings
      const muns = getMunicipalitiesByProvince(province);
      setMunicipalities(muns || []);
    } else {
      setMunicipalities([]);
    }
  };

  const handleNewRecipientSubmit = () => {
    // Validate required fields
    if (!newRecipient.full_name || !newRecipient.phone) {
      toast({
        title: t('common.error'),
        description: t('recipients.fullNamePhoneRequired') || 'Por favor completa nombre y teléfono',
        variant: 'destructive'
      });
      return;
    }

    // Validate address fields
    if (!newRecipient.province || !newRecipient.municipality || !newRecipient.address_line_1) {
      toast({
        title: t('common.error'),
        description: t('recipients.addressFieldsRequired') || 'Por favor completa provincia, municipio y dirección',
        variant: 'destructive'
      });
      return;
    }

    onSelect({
      recipientId: null,
      addressId: null,
      isNew: true,
      formData: newRecipient
    });

    // Reset form
    setShowNewForm(false);
    setNewRecipient({
      full_name: '',
      phone: '',
      email: '',
      province: '',
      municipality: '',
      address_line_1: '',
      address_line_2: ''
    });
  };

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Existing Recipients */}
      {recipients.length > 0 && !showNewForm && (
        <div>
          <label className="block text-sm font-semibold mb-3">
            {t('recipients.selectRecipient')}
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{recipient.full_name}</p>
                    <p className="text-xs text-gray-500">{recipient.phone}</p>
                  </div>
                  {recipient.is_favorite && <span className="text-lg">⭐</span>}
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Seleccionar Dirección si está seleccionado */}
      {selectedRecipient && selectedRecipient.addresses?.length > 1 && showAddressSelection && (
        <div>
          <label className="block text-sm font-semibold mb-3">
            {t('recipients.selectAddress')}
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
                    <p className="text-xs text-gray-600">
                      {address.municipality}, {address.province}
                    </p>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Create New Recipient */}
      <motion.button
        onClick={() => setShowNewForm(!showNewForm)}
        className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
        whileHover={{ scale: 1.01 }}
      >
        <Plus className="w-5 h-5" />
        {t('recipients.createNew')}
      </motion.button>

      {/* New Recipient Form */}
      <AnimatePresence>
        {showNewForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-blue-50 rounded-lg space-y-3 border-2 border-blue-200"
          >
            {/* Personal Information */}
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder={t('recipients.fullName')}
                value={newRecipient.full_name}
                onChange={(e) => setNewRecipient({ ...newRecipient, full_name: e.target.value })}
                className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="tel"
                placeholder={t('recipients.phone')}
                value={newRecipient.phone}
                onChange={(e) => setNewRecipient({ ...newRecipient, phone: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="email"
                placeholder={t('recipients.email')}
                value={newRecipient.email}
                onChange={(e) => setNewRecipient({ ...newRecipient, email: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Address Information */}
            <div className="border-t border-blue-300 pt-3 mt-3">
              <p className="text-xs font-semibold text-blue-900 mb-2">{t('recipients.addressInfo')}</p>

              {/* Province */}
              <div className="mb-3">
                <select
                  value={newRecipient.province}
                  onChange={(e) => handleProvinceChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">{t('recipients.selectProvince')}</option>
                  {provinces.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </div>

              {/* Municipality */}
              {newRecipient.province && (
                <div className="mb-3">
                  <select
                    value={newRecipient.municipality}
                    onChange={(e) => setNewRecipient({ ...newRecipient, municipality: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">{t('recipients.selectMunicipality')}</option>
                    {municipalities.map((municipality) => (
                      <option key={municipality} value={municipality}>
                        {municipality}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Address Line 1 */}
              <input
                type="text"
                placeholder={t('recipients.addressLine1')}
                value={newRecipient.address_line_1}
                onChange={(e) => setNewRecipient({ ...newRecipient, address_line_1: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              />

              {/* Address Line 2 (Optional) */}
              <input
                type="text"
                placeholder={t('recipients.addressLine2')}
                value={newRecipient.address_line_2}
                onChange={(e) => setNewRecipient({ ...newRecipient, address_line_2: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleNewRecipientSubmit}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                {t('common.save')}
              </button>
              <button
                onClick={() => {
                  setShowNewForm(false);
                  setNewRecipient({
                    full_name: '',
                    phone: '',
                    email: '',
                    province: '',
                    municipality: '',
                    address_line_1: '',
                    address_line_2: ''
                  });
                }}
                className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-lg hover:bg-gray-400 transition-colors font-medium"
              >
                {t('common.cancel')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

RecipientSelector.displayName = 'RecipientSelector';

export default RecipientSelector;
