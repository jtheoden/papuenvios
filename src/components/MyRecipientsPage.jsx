import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Edit, Trash2, MapPin, Phone, Mail, User, Star,
  Home, Save, X, AlertCircle, ArrowLeft
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useModal } from '@/contexts/ModalContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import {
  getMyRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  addRecipientAddress,
  updateRecipientAddress,
  deleteRecipientAddress
} from '@/lib/recipientService';
import { getProvinceNames, getMunicipalitiesByProvince } from '@/lib/cubanLocations';

const MyRecipientsPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { showModal } = useModal();

  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState(null);
  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);

  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    id_number: '',
    email: '',
    notes: '',
    is_favorite: false
  });

  const [addressForm, setAddressForm] = useState({
    province: '',
    municipality: '',
    address_line_1: '',
    address_line_2: '',
    postal_code: '',
    reference_point: '',
    is_default: false
  });

  useEffect(() => {
    loadRecipients();
    loadProvinces();
  }, []);

  const loadRecipients = async () => {
    setLoading(true);
    try {
      const result = await getMyRecipients();
      // getMyRecipients returns array directly, not wrapped object
      if (Array.isArray(result)) {
        setRecipients(result);
      } else {
        // Handle legacy format if needed
        if (result.success) {
          setRecipients(result.recipients);
        } else {
          setRecipients([]);
        }
      }
    } catch (error) {
      console.error('Error loading recipients:', error);
      toast({
        title: t('common.error'),
        description: error.message || 'Failed to load recipients',
        variant: 'destructive'
      });
      setRecipients([]);
    } finally {
      setLoading(false);
    }
  };

  const loadProvinces = () => {
    // Usa datos estáticos de cubanLocations.js - siempre disponibles
    const provinceNames = getProvinceNames();
    setProvinces(provinceNames);
  };

  const loadMunicipalities = (province) => {
    // Usa datos estáticos de cubanLocations.js - siempre disponibles
    const municipalityNames = getMunicipalitiesByProvince(province);
    setMunicipalities(municipalityNames);
  };

  const handleProvinceChange = (province) => {
    setAddressForm({ ...addressForm, province, municipality: '' });
    loadMunicipalities(province);
  };

  const handleOpenForm = (recipient = null) => {
    if (recipient) {
      setEditingRecipient(recipient);
      setFormData({
        full_name: recipient.full_name,
        phone: recipient.phone,
        id_number: recipient.id_number || '',
        email: recipient.email || '',
        notes: recipient.notes || '',
        is_favorite: recipient.is_favorite || false
      });
      if (recipient.addresses?.[0]) {
        const addr = recipient.addresses[0];
        setAddressForm({
          province: addr.province,
          municipality: addr.municipality || '',
          address_line_1: addr.address_line_1,
          address_line_2: addr.address_line_2 || '',
          postal_code: addr.postal_code || '',
          reference_point: addr.reference_point || '',
          is_default: addr.is_default || false
        });
        if (addr.province) {
          loadMunicipalities(addr.province);
        }
      }
    } else {
      setEditingRecipient(null);
      setFormData({
        full_name: '',
        phone: '',
        id_number: '',
        email: '',
        notes: '',
        is_favorite: false
      });
      setAddressForm({
        province: '',
        municipality: '',
        address_line_1: '',
        address_line_2: '',
        postal_code: '',
        reference_point: '',
        is_default: true
      });
    }
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingRecipient(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.full_name || !formData.phone) {
      toast({
        title: t('common.error'),
        description: t('recipients.fillNameAndPhone'),
        variant: 'destructive'
      });
      return;
    }

    let result;
    if (editingRecipient) {
      result = await updateRecipient(editingRecipient.id, formData);
      if (result.success && addressForm.province && addressForm.address_line_1) {
        if (editingRecipient.addresses?.[0]) {
          await updateRecipientAddress(editingRecipient.addresses[0].id, addressForm);
        } else {
          await addRecipientAddress({
            recipient_id: editingRecipient.id,
            ...addressForm
          });
        }
      }
    } else {
      result = await createRecipient(formData);
      if (result.success && addressForm.province && addressForm.address_line_1) {
        await addRecipientAddress({
          recipient_id: result.recipient.id,
          ...addressForm
        });
      }
    }

    if (result.success) {
      toast({
        title: t('common.success'),
        description: editingRecipient ? t('recipients.recipientUpdated') : t('recipients.recipientCreated')
      });
      handleCloseForm();
      loadRecipients();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleDelete = async (recipient) => {
    const confirmed = await showModal({
      type: 'confirm',
      title: t('recipients.deleteRecipientConfirm'),
      message: `${t('recipients.deleteRecipientMessage')} "${recipient.full_name}"?`,
      confirmText: t('common.delete'),
      cancelText: t('common.cancel')
    });

    if (!confirmed) return;

    const result = await deleteRecipient(recipient.id);
    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('recipients.recipientDeleted')
      });
      loadRecipients();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleToggleFavorite = async (recipient) => {
    const result = await updateRecipient(recipient.id, {
      is_favorite: !recipient.is_favorite
    });
    if (result.success) {
      loadRecipients();
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      {/* Back Button */}
      {onNavigate && (
        <button
          onClick={() => onNavigate('user-panel')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>{t('recipients.backToPanel')}</span>
        </button>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className={`${getHeadingStyle()} text-2xl mb-1`}>
            <User className="inline h-6 w-6 mr-2" />
            {t('recipients.myRecipients')}
          </h2>
          <p className="text-gray-600 text-sm">
            {t('recipients.manageRecipients')}
          </p>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
        >
          <Plus className="h-5 w-5" />
          {t('recipients.newRecipientButton')}
        </button>
      </div>

      {/* Recipients List */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {recipients.length === 0 ? (
          <div className="col-span-full glass-effect p-8 rounded-xl text-center">
            <User className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">{t('recipients.noRecipientsSaved')}</p>
            <p className="text-sm text-gray-500 mb-4">
              {t('recipients.addRecipientsFaster')}
            </p>
            <button
              onClick={() => handleOpenForm()}
              className="text-blue-600 hover:underline"
            >
              {t('recipients.createFirstRecipient')}
            </button>
          </div>
        ) : (
          recipients.map((recipient) => {
            const defaultAddress = recipient.addresses?.find((a) => a.is_default) ||
              recipient.addresses?.[0];

            return (
              <motion.div
                key={recipient.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-effect p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 transition-all"
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      {recipient.full_name}
                      {recipient.is_favorite && (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      )}
                    </h3>
                  </div>
                  <button
                    onClick={() => handleToggleFavorite(recipient)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                  >
                    <Star
                      className={`h-5 w-5 ${
                        recipient.is_favorite
                          ? 'text-yellow-500 fill-yellow-500'
                          : 'text-gray-400'
                      }`}
                    />
                  </button>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 mb-3 text-sm">
                  <div className="flex items-center gap-2 text-gray-700">
                    <Phone className="h-3 w-3 flex-shrink-0" />
                    <span>{recipient.phone}</span>
                  </div>
                  {recipient.email && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{recipient.email}</span>
                    </div>
                  )}
                  {defaultAddress && (
                    <div className="flex items-start gap-2 text-gray-700">
                      <MapPin className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <p className="font-medium">
                          {defaultAddress.municipality}, {defaultAddress.province}
                        </p>
                        <p className="text-gray-600">{defaultAddress.address_line_1}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Address Count */}
                {recipient.addresses && recipient.addresses.length > 0 && (
                  <div className="mb-3">
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                      {recipient.addresses.length}{' '}
                      {recipient.addresses.length === 1 ? t('recipients.addressCountSingular') : t('recipients.addressCountPlural')}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleOpenForm(recipient)}
                    className="text-xs px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-1"
                  >
                    <Edit className="h-3 w-3" />
                    {t('recipients.editAction')}
                  </button>
                  <button
                    onClick={() => handleDelete(recipient)}
                    className="text-xs px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('recipients.deleteAction')}
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={handleCloseForm}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-effect p-6 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold">
                  {editingRecipient ? t('recipients.editRecipientTitle') : t('recipients.newRecipientButton')}
                </h3>
                <button
                  onClick={handleCloseForm}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <User className="h-5 w-5" />
                    {t('recipients.personalInfo')}
                  </h4>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.fullNameLabel')}
                      </label>
                      <input
                        type="text"
                        value={formData.full_name}
                        onChange={(e) =>
                          setFormData({ ...formData, full_name: e.target.value })
                        }
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.phoneLabel')}
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.idNumberLabel')}
                      </label>
                      <input
                        type="text"
                        value={formData.id_number}
                        onChange={(e) =>
                          setFormData({ ...formData, id_number: e.target.value })
                        }
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-4 pt-4 border-t">
                  <h4 className="font-semibold flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    {t('recipients.deliveryAddress')}
                  </h4>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.provinceLabel')}
                      </label>
                      <select
                        value={addressForm.province}
                        onChange={(e) => handleProvinceChange(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">{t('recipients.selectProvinceOpt')}</option>
                        {provinces.map((province) => (
                          <option key={province} value={province}>
                            {province}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.municipalityLabel')}
                      </label>
                      <select
                        value={addressForm.municipality}
                        onChange={(e) =>
                          setAddressForm({ ...addressForm, municipality: e.target.value })
                        }
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={!addressForm.province}
                      >
                        <option value="">{t('recipients.selectMunicipalityOpt')}</option>
                        {municipalities.map((mun) => (
                          <option key={mun} value={mun}>
                            {mun}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.addressLine1Label')}
                      </label>
                      <input
                        type="text"
                        value={addressForm.address_line_1}
                        onChange={(e) =>
                          setAddressForm({ ...addressForm, address_line_1: e.target.value })
                        }
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={t('recipients.addressPlaceholder')}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('recipients.referencePointLabel')}
                      </label>
                      <input
                        type="text"
                        value={addressForm.reference_point}
                        onChange={(e) =>
                          setAddressForm({ ...addressForm, reference_point: e.target.value })
                        }
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={t('recipients.referencePlaceholder')}
                      />
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('recipients.notesLabel')}
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows="3"
                  />
                </div>

                {/* Favorite */}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_favorite}
                    onChange={(e) =>
                      setFormData({ ...formData, is_favorite: e.target.checked })
                    }
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 flex items-center gap-1">
                    <Star className="h-4 w-4" />
                    {t('recipients.markAsFavorite')}
                  </span>
                </label>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseForm}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 ${getPrimaryButtonStyle()} flex items-center justify-center gap-2`}
                  >
                    <Save className="h-5 w-5" />
                    {editingRecipient ? t('recipients.updateButton') : t('common.save')}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MyRecipientsPage;
