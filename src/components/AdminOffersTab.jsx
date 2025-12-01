/**
 * Admin Offers Tab Component
 * Complete coupon/offer management with create, edit, delete, and usage tracking
 * Features: Code validation, discount config, usage limits, enable/disable
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  ToggleLeft,
  ToggleRight,
  Search,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  AlertCircle,
  Percent,
  DollarSign
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase';

const AdminOffersTab = () => {
  const { t, language } = useLanguage();
  const { currencySymbol } = useCurrency();

  // States
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState('all'); // all, active, inactive
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const [expandedOffer, setExpandedOffer] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    code: '',
    discountType: 'percentage', // percentage or fixed
    discountValue: '',
    minPurchaseAmount: '',
    maxUsageGlobal: '',
    maxUsagePerUser: '',
    startDate: '',
    endDate: '',
    isActive: true
  });

  // Load offers on mount
  useEffect(() => {
    loadOffers();
  }, []);

  const loadOffers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOffers(data || []);
    } catch (err) {
      console.error('Error loading offers:', err);
      toast({
        title: language === 'es' ? '❌ Error' : '❌ Error',
        description: language === 'es' ? 'Error al cargar ofertas' : 'Error loading offers'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOffer = async (e) => {
    e.preventDefault();

    // Validation
    if (!formData.code.trim()) {
      toast({
        title: language === 'es' ? '⚠️ Validación' : '⚠️ Validation',
        description: language === 'es' ? 'El código es requerido' : 'Code is required'
      });
      return;
    }

    if (!formData.discountValue || isNaN(formData.discountValue) || parseFloat(formData.discountValue) <= 0) {
      toast({
        title: language === 'es' ? '⚠️ Validación' : '⚠️ Validation',
        description: language === 'es' ? 'El descuento debe ser mayor a 0' : 'Discount must be greater than 0'
      });
      return;
    }

    try {
      const offerData = {
        code: formData.code.toUpperCase().trim(),
        discount_type: formData.discountType,
        discount_value: parseFloat(formData.discountValue),
        min_purchase_amount: formData.minPurchaseAmount ? parseFloat(formData.minPurchaseAmount) : null,
        max_usage_global: formData.maxUsageGlobal ? parseInt(formData.maxUsageGlobal) : null,
        max_usage_per_user: formData.maxUsagePerUser ? parseInt(formData.maxUsagePerUser) : null,
        start_date: formData.startDate ? formData.startDate : null,
        end_date: formData.endDate ? formData.endDate : null,
        is_active: formData.isActive
      };

      if (editingOffer) {
        // Update existing offer
        const { error } = await supabase
          .from('offers')
          .update(offerData)
          .eq('id', editingOffer.id);

        if (error) throw error;

        toast({
          title: language === 'es' ? '✅ Actualizado' : '✅ Updated',
          description: language === 'es' ? 'Oferta actualizada exitosamente' : 'Offer updated successfully'
        });
      } else {
        // Create new offer
        const { error } = await supabase
          .from('offers')
          .insert([offerData]);

        if (error) throw error;

        toast({
          title: language === 'es' ? '✅ Creado' : '✅ Created',
          description: language === 'es' ? 'Oferta creada exitosamente' : 'Offer created successfully'
        });
      }

      // Reset form and reload
      resetForm();
      loadOffers();
    } catch (err) {
      console.error('Error saving offer:', err);
      toast({
        title: language === 'es' ? '❌ Error' : '❌ Error',
        description: language === 'es' ? 'Error al guardar la oferta' : 'Error saving offer'
      });
    }
  };

  const handleDeleteOffer = async (offerId) => {
    if (!window.confirm(language === 'es' ? '¿Eliminar esta oferta?' : 'Delete this offer?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('offers')
        .delete()
        .eq('id', offerId);

      if (error) throw error;

      toast({
        title: language === 'es' ? '✅ Eliminado' : '✅ Deleted',
        description: language === 'es' ? 'Oferta eliminada exitosamente' : 'Offer deleted successfully'
      });

      loadOffers();
    } catch (err) {
      console.error('Error deleting offer:', err);
      toast({
        title: language === 'es' ? '❌ Error' : '❌ Error',
        description: language === 'es' ? 'Error al eliminar la oferta' : 'Error deleting offer'
      });
    }
  };

  const handleToggleActive = async (offerId, currentStatus) => {
    try {
      const { error } = await supabase
        .from('offers')
        .update({ is_active: !currentStatus })
        .eq('id', offerId);

      if (error) throw error;

      loadOffers();
    } catch (err) {
      console.error('Error updating offer status:', err);
    }
  };

  const handleEditOffer = (offer) => {
    setEditingOffer(offer);
    setFormData({
      code: offer.code,
      discountType: offer.discount_type,
      discountValue: offer.discount_value,
      minPurchaseAmount: offer.min_purchase_amount || '',
      maxUsageGlobal: offer.max_usage_global || '',
      maxUsagePerUser: offer.max_usage_per_user || '',
      startDate: offer.start_date ? offer.start_date.split('T')[0] : '',
      endDate: offer.end_date ? offer.end_date.split('T')[0] : '',
      isActive: offer.is_active
    });
    setShowCreateForm(true);
  };

  const resetForm = () => {
    setFormData({
      code: '',
      discountType: 'percentage',
      discountValue: '',
      minPurchaseAmount: '',
      maxUsageGlobal: '',
      maxUsagePerUser: '',
      startDate: '',
      endDate: '',
      isActive: true
    });
    setEditingOffer(null);
    setShowCreateForm(false);
  };

  // Filter and search
  const filteredOffers = offers.filter(offer => {
    const matchesSearch = offer.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterActive === 'all' ||
      (filterActive === 'active' && offer.is_active) ||
      (filterActive === 'inactive' && !offer.is_active);
    return matchesSearch && matchesFilter;
  });

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({
      title: language === 'es' ? '✅ Copiado' : '✅ Copied',
      description: language === 'es' ? 'Código copiado al portapapeles' : 'Code copied to clipboard'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{language === 'es' ? 'Ofertas y Cupones' : 'Offers & Coupons'}</h2>
          <p className="text-gray-600 text-sm mt-1">
            {language === 'es' ? 'Administra códigos de descuento y promociones' : 'Manage discount codes and promotions'}
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:shadow-lg transition-shadow font-medium"
        >
          <Plus className="h-5 w-5" />
          {language === 'es' ? 'Nueva Oferta' : 'New Offer'}
        </button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder={language === 'es' ? 'Buscar por código...' : 'Search by code...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'active', 'inactive'].map((filter) => (
            <button
              key={filter}
              onClick={() => setFilterActive(filter)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filterActive === filter
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {language === 'es'
                ? filter === 'all'
                  ? 'Todos'
                  : filter === 'active'
                  ? 'Activos'
                  : 'Inactivos'
                : filter === 'all'
                ? 'All'
                : filter === 'active'
                ? 'Active'
                : 'Inactive'}
            </button>
          ))}
        </div>
      </div>

      {/* Create/Edit Form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white p-6 rounded-lg shadow-md border border-gray-200"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold">
                {editingOffer
                  ? language === 'es'
                    ? 'Editar Oferta'
                    : 'Edit Offer'
                  : language === 'es'
                  ? 'Crear Nueva Oferta'
                  : 'Create New Offer'}
              </h3>
              <button onClick={resetForm} className="text-gray-500 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOffer} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                {/* Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Código' : 'Code'}
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder={language === 'es' ? 'Ej: SUMMER20' : 'E.g: SUMMER20'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Discount Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Tipo de Descuento' : 'Discount Type'}
                  </label>
                  <select
                    value={formData.discountType}
                    onChange={(e) => setFormData({ ...formData, discountType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="percentage">{language === 'es' ? 'Porcentaje (%)' : 'Percentage (%)'}</option>
                    <option value="fixed">{language === 'es' ? 'Cantidad Fija' : 'Fixed Amount'}</option>
                  </select>
                </div>

                {/* Discount Value */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Valor de Descuento' : 'Discount Value'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={formData.discountValue}
                      onChange={(e) => setFormData({ ...formData, discountValue: e.target.value })}
                      placeholder="0"
                      step="0.01"
                      min="0"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <span className="text-gray-600 font-medium">
                      {formData.discountType === 'percentage' ? '%' : currencySymbol}
                    </span>
                  </div>
                </div>

                {/* Min Purchase Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Compra Mínima (opcional)' : 'Min Purchase (optional)'}
                  </label>
                  <input
                    type="number"
                    value={formData.minPurchaseAmount}
                    onChange={(e) => setFormData({ ...formData, minPurchaseAmount: e.target.value })}
                    placeholder="0"
                    step="0.01"
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Max Usage Global */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Usos Máximos Globales' : 'Max Global Uses'}
                  </label>
                  <input
                    type="number"
                    value={formData.maxUsageGlobal}
                    onChange={(e) => setFormData({ ...formData, maxUsageGlobal: e.target.value })}
                    placeholder={language === 'es' ? 'Ilimitado' : 'Unlimited'}
                    min="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Max Usage Per User */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Usos Máximos por Usuario' : 'Max Uses Per User'}
                  </label>
                  <input
                    type="number"
                    value={formData.maxUsagePerUser}
                    onChange={(e) => setFormData({ ...formData, maxUsagePerUser: e.target.value })}
                    placeholder={language === 'es' ? 'Ilimitado' : 'Unlimited'}
                    min="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Fecha de Inicio' : 'Start Date'}
                  </label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'es' ? 'Fecha de Fin' : 'End Date'}
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded"
                />
                <label className="text-sm font-medium text-gray-700">
                  {language === 'es' ? 'Oferta activa' : 'Offer active'}
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:shadow-lg transition-shadow font-medium"
                >
                  {editingOffer
                    ? language === 'es'
                      ? 'Actualizar'
                      : 'Update'
                    : language === 'es'
                    ? 'Crear'
                    : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  {language === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offers List */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-8 text-gray-500">
            {language === 'es' ? 'Cargando ofertas...' : 'Loading offers...'}
          </div>
        ) : filteredOffers.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600">
              {language === 'es'
                ? searchTerm
                  ? 'No se encontraron ofertas'
                  : 'No hay ofertas creadas aún'
                : searchTerm
                ? 'No offers found'
                : 'No offers created yet'}
            </p>
          </div>
        ) : (
          filteredOffers.map((offer) => (
            <motion.div
              key={offer.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-white rounded-lg shadow-sm border-l-4 p-4 ${
                offer.is_active
                  ? 'border-l-green-500 hover:shadow-md'
                  : 'border-l-gray-400 opacity-75'
              } transition-shadow`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <code className="bg-gray-100 px-3 py-1 rounded font-mono font-bold text-purple-600">
                      {offer.code}
                    </code>
                    <button
                      onClick={() => copyToClipboard(offer.code)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title={language === 'es' ? 'Copiar código' : 'Copy code'}
                    >
                      <Copy className="h-4 w-4 text-gray-500" />
                    </button>
                    {offer.is_active && (
                      <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded">
                        {language === 'es' ? 'Activo' : 'Active'}
                      </span>
                    )}
                  </div>

                  {/* Quick Summary */}
                  <div className="text-sm text-gray-600 grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      {offer.discount_type === 'percentage' ? (
                        <Percent className="h-4 w-4" />
                      ) : (
                        <DollarSign className="h-4 w-4" />
                      )}
                      <span>
                        {offer.discount_type === 'percentage'
                          ? `${offer.discount_value}%`
                          : `${currencySymbol}${offer.discount_value}`}
                      </span>
                    </div>
                    {offer.min_purchase_amount && (
                      <div>
                        <span className="text-xs text-gray-500">
                          {language === 'es' ? 'Min:' : 'Min:'} {currencySymbol}{offer.min_purchase_amount}
                        </span>
                      </div>
                    )}
                    {offer.end_date && (
                      <div>
                        <span className="text-xs text-gray-500">
                          {language === 'es' ? 'Vence:' : 'Expires:'} {new Date(offer.end_date).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Expandable Details */}
                  <button
                    onClick={() => setExpandedOffer(expandedOffer === offer.id ? null : offer.id)}
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
                  >
                    {expandedOffer === offer.id ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        {language === 'es' ? 'Ocultar detalles' : 'Hide details'}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        {language === 'es' ? 'Ver detalles' : 'Show details'}
                      </>
                    )}
                  </button>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleToggleActive(offer.id, offer.is_active)}
                    className={`p-2 rounded transition-colors ${
                      offer.is_active
                        ? 'bg-green-100 text-green-600 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={language === 'es' ? 'Cambiar estado' : 'Toggle status'}
                  >
                    {offer.is_active ? (
                      <ToggleRight className="h-5 w-5" />
                    ) : (
                      <ToggleLeft className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleEditOffer(offer)}
                    className="p-2 bg-blue-100 text-blue-600 hover:bg-blue-200 rounded transition-colors"
                    title={language === 'es' ? 'Editar' : 'Edit'}
                  >
                    <Edit2 className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteOffer(offer.id)}
                    className="p-2 bg-red-100 text-red-600 hover:bg-red-200 rounded transition-colors"
                    title={language === 'es' ? 'Eliminar' : 'Delete'}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              <AnimatePresence>
                {expandedOffer === offer.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 pt-4 border-t border-gray-200"
                  >
                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">
                          {language === 'es' ? 'Tipo de Descuento:' : 'Discount Type:'}
                        </span>
                        <p className="font-medium">
                          {offer.discount_type === 'percentage'
                            ? language === 'es'
                              ? 'Porcentaje'
                              : 'Percentage'
                            : language === 'es'
                            ? 'Cantidad Fija'
                            : 'Fixed Amount'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600">
                          {language === 'es' ? 'Valor:' : 'Value:'}
                        </span>
                        <p className="font-medium">{offer.discount_value}</p>
                      </div>
                      {offer.min_purchase_amount && (
                        <div>
                          <span className="text-gray-600">
                            {language === 'es' ? 'Compra Mínima:' : 'Min Purchase:'}
                          </span>
                          <p className="font-medium">{currencySymbol}{offer.min_purchase_amount}</p>
                        </div>
                      )}
                      {offer.max_usage_global && (
                        <div>
                          <span className="text-gray-600">
                            {language === 'es' ? 'Usos Máximos:' : 'Max Uses:'}
                          </span>
                          <p className="font-medium">{offer.max_usage_global}</p>
                        </div>
                      )}
                      {offer.max_usage_per_user && (
                        <div>
                          <span className="text-gray-600">
                            {language === 'es' ? 'Usos por Usuario:' : 'Uses Per User:'}
                          </span>
                          <p className="font-medium">{offer.max_usage_per_user}</p>
                        </div>
                      )}
                      {offer.start_date && (
                        <div>
                          <span className="text-gray-600">
                            {language === 'es' ? 'Fecha de Inicio:' : 'Start Date:'}
                          </span>
                          <p className="font-medium">{new Date(offer.start_date).toLocaleDateString()}</p>
                        </div>
                      )}
                      {offer.end_date && (
                        <div>
                          <span className="text-gray-600">
                            {language === 'es' ? 'Fecha de Fin:' : 'End Date:'}
                          </span>
                          <p className="font-medium">{new Date(offer.end_date).toLocaleDateString()}</p>
                        </div>
                      )}
                      {offer.created_at && (
                        <div>
                          <span className="text-gray-600">
                            {language === 'es' ? 'Creado:' : 'Created:'}
                          </span>
                          <p className="font-medium">{new Date(offer.created_at).toLocaleDateString()}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

export default AdminOffersTab;
