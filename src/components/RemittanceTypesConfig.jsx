import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit, Trash2, Save, X, DollarSign, TrendingUp, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModal } from '@/contexts/ModalContext';
import {
  getAllRemittanceTypes,
  createRemittanceType,
  updateRemittanceType,
  deleteRemittanceType,
  DELIVERY_METHODS
} from '@/lib/remittanceService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';

const RemittanceTypesConfig = () => {
  const { t } = useLanguage();
  const { isSuperAdmin } = useAuth();
  const { showModal } = useModal();

  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingType, setEditingType] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    currency_code: 'USD',
    delivery_currency: 'CUP',
    exchange_rate: '',
    commission_percentage: '0',
    commission_fixed: '0',
    min_amount: '',
    max_amount: '',
    delivery_method: DELIVERY_METHODS.CASH,
    max_delivery_days: '3',
    warning_days: '2',
    description: '',
    icon: 'dollar-sign',
    is_active: true,
    display_order: 0
  });

  useEffect(() => {
    loadTypes();
  }, []);

  const loadTypes = async () => {
    setLoading(true);
    try {
      const types = await getAllRemittanceTypes();
      setTypes(types || []);
    } catch (error) {
      console.error('Error loading remittance types:', error);
      toast({
        title: t('common.error'),
        description: error.message || 'Error loading remittance types',
        variant: 'destructive'
      });
      setTypes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingType(null);
    setFormData({
      name: '',
      currency_code: 'USD',
      delivery_currency: 'CUP',
      exchange_rate: '',
      commission_percentage: '0',
      commission_fixed: '0',
      min_amount: '',
      max_amount: '',
      delivery_method: DELIVERY_METHODS.CASH,
      max_delivery_days: '3',
      warning_days: '2',
      description: '',
      icon: 'dollar-sign',
      is_active: true,
      display_order: types.length
    });
    setShowForm(true);
  };

  const handleEdit = (type) => {
    setEditingType(type);
    setFormData({
      name: type.name,
      currency_code: type.currency_code,
      delivery_currency: type.delivery_currency,
      exchange_rate: type.exchange_rate.toString(),
      commission_percentage: (type.commission_percentage || 0).toString(),
      commission_fixed: (type.commission_fixed || 0).toString(),
      min_amount: type.min_amount.toString(),
      max_amount: type.max_amount ? type.max_amount.toString() : '',
      delivery_method: type.delivery_method,
      max_delivery_days: type.max_delivery_days.toString(),
      warning_days: type.warning_days.toString(),
      description: type.description || '',
      icon: type.icon || 'dollar-sign',
      is_active: type.is_active,
      display_order: type.display_order
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingType(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();

    // Validaciones
    if (!formData.name || !formData.exchange_rate || !formData.min_amount) {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.requiredFields'),
        variant: 'destructive'
      });
      return;
    }

    const typeData = {
      name: formData.name,
      currency_code: formData.currency_code,
      delivery_currency: formData.delivery_currency,
      exchange_rate: parseFloat(formData.exchange_rate),
      commission_percentage: parseFloat(formData.commission_percentage) || 0,
      commission_fixed: parseFloat(formData.commission_fixed) || 0,
      min_amount: parseFloat(formData.min_amount),
      max_amount: formData.max_amount ? parseFloat(formData.max_amount) : null,
      delivery_method: formData.delivery_method,
      max_delivery_days: parseInt(formData.max_delivery_days),
      warning_days: parseInt(formData.warning_days),
      description: formData.description,
      icon: formData.icon,
      is_active: formData.is_active,
      display_order: formData.display_order
    };

    let result;
    if (editingType) {
      result = await updateRemittanceType(editingType.id, typeData);
    } else {
      result = await createRemittanceType(typeData);
    }

    if (result.success) {
      toast({
        title: t('common.success'),
        description: editingType ? t('remittances.admin.typeUpdated') : t('remittances.admin.typeCreated')
      });
      loadTypes();
      handleCancel();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleDelete = async (type) => {
    const confirmed = await showModal({
      type: 'danger',
      title: t('remittances.admin.confirmDelete'),
      message: `${type.name}\n\n${t('remittances.admin.deleteWarning')}`,
      confirmText: t('remittances.admin.delete'),
      cancelText: t('remittances.admin.cancel')
    });

    if (!confirmed) return;

    const result = await deleteRemittanceType(type.id);

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.typeDeleted')
      });
      loadTypes();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const toggleActive = async (type) => {
    const result = await updateRemittanceType(type.id, { is_active: !type.is_active });

    if (result.success) {
      toast({
        title: t('common.success'),
        description: type.is_active ? t('remittances.admin.typeDeactivated') : t('remittances.admin.typeActivated')
      });
      loadTypes();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className={`${getHeadingStyle()} text-2xl mb-2`}>
            {t('remittances.admin.types')}
          </h2>
          <p className="text-gray-600">
            {t('remittances.admin.title')}
          </p>
        </div>
        <button
          onClick={handleCreate}
          className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
        >
          <Plus className="h-5 w-5" />
          {t('remittances.admin.newType')}
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-effect p-6 rounded-xl mb-6 border-2 border-blue-200"
        >
          <h3 className="text-xl font-bold mb-4 gradient-text">
            {editingType ? t('remittances.admin.editRemittanceType') : t('remittances.admin.newRemittanceType')}
          </h3>

          <form onSubmit={handleSave} className="grid md:grid-cols-2 gap-6">
            {/* Nombre */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.typeName')} *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('remittances.admin.typeNamePlaceholder')}
                required
              />
            </div>

            {/* Monedas */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.originCurrency')} *
              </label>
              <select
                value={formData.currency_code}
                onChange={(e) => setFormData({ ...formData, currency_code: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="USD">USD - Dólar Estadounidense</option>
                <option value="EUR">EUR - Euro</option>
                <option value="CAD">CAD - Dólar Canadiense</option>
                <option value="GBP">GBP - Libra Esterlina</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.deliveryCurrency')} *
              </label>
              <select
                value={formData.delivery_currency}
                onChange={(e) => setFormData({ ...formData, delivery_currency: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="CUP">CUP - Peso Cubano</option>
                <option value="USD">USD - Dólar (Efectivo)</option>
                <option value="MLC">MLC - Moneda Libremente Convertible</option>
              </select>
            </div>

            {/* Tasa de Cambio */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.exchangeRate')} *
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="number"
                  step="0.01"
                  value={formData.exchange_rate}
                  onChange={(e) => setFormData({ ...formData, exchange_rate: e.target.value })}
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="320.00"
                  required
                />
              </div>
            </div>

            {/* Comisiones */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.commissionPercent')}
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.commission_percentage}
                onChange={(e) => setFormData({ ...formData, commission_percentage: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="2.5"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.commissionFixed')}
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.commission_fixed}
                onChange={(e) => setFormData({ ...formData, commission_fixed: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="5.00"
              />
            </div>

            {/* Límites */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.minAmount')} *
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.min_amount}
                onChange={(e) => setFormData({ ...formData, min_amount: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="10.00"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.maxAmount')}
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.max_amount}
                onChange={(e) => setFormData({ ...formData, max_amount: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="1000.00"
              />
            </div>

            {/* Método de Entrega */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.deliveryMethod')} *
              </label>
              <select
                value={formData.delivery_method}
                onChange={(e) => setFormData({ ...formData, delivery_method: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value={DELIVERY_METHODS.CASH}>{t('remittances.recipient.cash')}</option>
                <option value={DELIVERY_METHODS.TRANSFER}>{t('remittances.recipient.transfer')}</option>
                <option value={DELIVERY_METHODS.CARD}>Tarjeta</option>
              </select>
            </div>

            {/* Tiempos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.maxDeliveryDays')} *
              </label>
              <input
                type="number"
                value={formData.max_delivery_days}
                onChange={(e) => setFormData({ ...formData, max_delivery_days: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.warningDays')} *
              </label>
              <input
                type="number"
                value={formData.warning_days}
                onChange={(e) => setFormData({ ...formData, warning_days: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                required
              />
            </div>

            {/* Descripción */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('remittances.admin.description')}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows="3"
                placeholder={t('remittances.admin.descriptionPlaceholder')}
              />
            </div>

            {/* Estado */}
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  {t('remittances.admin.active')}
                </span>
              </label>
            </div>

            {/* Botones */}
            <div className="md:col-span-2 flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
              >
                <Save className="h-4 w-4" />
                {t('common.save')}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Lista de Tipos */}
      {types.length === 0 ? (
        <div className="text-center py-12 glass-effect rounded-xl">
          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">{t('remittances.admin.noTypes')}</p>
          <button
            onClick={handleCreate}
            className={`${getPrimaryButtonStyle()} inline-flex items-center gap-2`}
          >
            <Plus className="h-5 w-5" />
            {t('remittances.admin.newType')}
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {types.map((type) => (
            <motion.div
              key={type.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass-effect p-6 rounded-xl ${!type.is_active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold gradient-text">{type.name}</h3>
                    {!type.is_active && (
                      <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full">
                        {t('remittances.admin.inactive')}
                      </span>
                    )}
                  </div>

                  <div className="grid md:grid-cols-3 gap-4 mt-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Conversión</p>
                      <p className="font-semibold">
                        1 {type.currency_code} = {type.exchange_rate} {type.delivery_currency}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Límites</p>
                      <p className="font-semibold">
                        {type.min_amount} - {type.max_amount || '∞'} {type.currency_code}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Comisión</p>
                      <p className="font-semibold">
                        {type.commission_percentage}% + {type.commission_fixed} {type.currency_code}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Entrega</p>
                      <p className="font-semibold capitalize">{type.delivery_method}</p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Tiempo Máximo</p>
                      <p className="font-semibold">{type.max_delivery_days} {type.max_delivery_days === 1 ? t('adminOrders.days.singular') : t('adminOrders.days.plural')}</p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 mb-1">Alerta</p>
                      <p className="font-semibold">{type.warning_days} {type.warning_days === 1 ? t('adminOrders.days.singular') : t('adminOrders.days.plural')}</p>
                    </div>
                  </div>

                  {type.description && (
                    <p className="text-sm text-gray-600 mt-3">{type.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => toggleActive(type)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title={type.is_active ? t('remittances.admin.deactivate') : t('remittances.admin.activate')}
                  >
                    {type.is_active ? (
                      <Eye className="h-5 w-5 text-green-600" />
                    ) : (
                      <EyeOff className="h-5 w-5 text-gray-400" />
                    )}
                  </button>

                  <button
                    onClick={() => handleEdit(type)}
                    className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                    title={t('remittances.admin.edit')}
                  >
                    <Edit className="h-5 w-5" />
                  </button>

                  {isSuperAdmin && (
                    <button
                      onClick={() => handleDelete(type)}
                      className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                      title={t('remittances.admin.delete')}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RemittanceTypesConfig;
