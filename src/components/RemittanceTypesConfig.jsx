import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Edit, Trash2, Save, X, DollarSign, TrendingUp, AlertCircle, Eye, EyeOff, Calculator, ArrowRight, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModal } from '@/contexts/ModalContext';
import {
  getAllRemittanceTypes,
  createRemittanceType,
  updateRemittanceType,
  deleteRemittanceType,
  getPendingRemittancesCountByType,
  DELIVERY_METHODS
} from '@/lib/remittanceService';
import { getCurrenciesWithRates } from '@/lib/currencyService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';

// Forward simulation (mirrors remittanceService.calculateRemittance)
const simulateRemittance = ({ amount, exchangeRate, commissionPercentage, commissionFixed }) => {
  const commPctAmount = (amount * (commissionPercentage || 0)) / 100;
  const commFixedAmount = commissionFixed || 0;
  const totalCommission = commPctAmount + commFixedAmount;
  const netAmount = amount - totalCommission;
  const amountToDeliver = netAmount * exchangeRate;
  const effectiveRate = amount > 0 ? amountToDeliver / amount : 0;
  return { amount, commPctAmount, commFixedAmount, totalCommission, netAmount, exchangeRate, amountToDeliver, effectiveRate };
};

// Reverse simulation (mirrors remittanceService.calculateReverseRemittance)
const simulateReverseRemittance = ({ desiredDeliveryAmount, exchangeRate, commissionPercentage, commissionFixed }) => {
  const denominator = 1 - ((commissionPercentage || 0) / 100);
  if (denominator <= 0) return null;
  const amountToSend = ((desiredDeliveryAmount / exchangeRate) + (commissionFixed || 0)) / denominator;
  return simulateRemittance({ amount: amountToSend, exchangeRate, commissionPercentage, commissionFixed });
};

// Calculate commission % from market rate and delivery rate
const calcCommissionFromRates = (marketRate, deliveryRate) => {
  if (!marketRate || marketRate <= 0) return 0;
  if (!deliveryRate || deliveryRate <= 0) return 100;
  if (deliveryRate >= marketRate) return 0;
  return ((1 - deliveryRate / marketRate) * 100);
};

const RemittanceTypesConfig = () => {
  const { t, language } = useLanguage();
  const { isSuperAdmin } = useAuth();
  const { showModal } = useModal();

  const [types, setTypes] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingType, setEditingType] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    currency_code: '',
    delivery_currency: '',
    exchange_rate: '',
    delivery_rate: '',
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

  // Simulator state
  const [simMode, setSimMode] = useState('send'); // 'send' or 'receive'
  const [simAmount, setSimAmount] = useState('100');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadTypes();
    loadCurrencies();
  }, []);

  // Auto-calculate commission_percentage when market rate or delivery rate change
  useEffect(() => {
    const marketRate = parseFloat(formData.exchange_rate);
    const deliveryRate = parseFloat(formData.delivery_rate);
    if (marketRate > 0 && deliveryRate > 0) {
      const pct = calcCommissionFromRates(marketRate, deliveryRate);
      setFormData(prev => ({ ...prev, commission_percentage: pct.toString() }));
    }
  }, [formData.exchange_rate, formData.delivery_rate]);

  // Show advanced if commission_fixed > 0 on load
  useEffect(() => {
    if (parseFloat(formData.commission_fixed) > 0) {
      setShowAdvanced(true);
    }
  }, [editingType]);

  // Simulator computation
  const simResult = useMemo(() => {
    const exchangeRate = parseFloat(formData.exchange_rate);
    const commissionPercentage = parseFloat(formData.commission_percentage) || 0;
    const commissionFixed = parseFloat(formData.commission_fixed) || 0;
    const amount = parseFloat(simAmount);

    if (!exchangeRate || exchangeRate <= 0) return null;
    if (!amount || amount <= 0) return null;

    if (simMode === 'send') {
      return simulateRemittance({ amount, exchangeRate, commissionPercentage, commissionFixed });
    } else {
      return simulateReverseRemittance({ desiredDeliveryAmount: amount, exchangeRate, commissionPercentage, commissionFixed });
    }
  }, [formData.exchange_rate, formData.commission_percentage, formData.commission_fixed, simAmount, simMode]);

  const loadCurrencies = async () => {
    try {
      // Load only active currencies that have exchange rates configured
      const data = await getCurrenciesWithRates();
      setCurrencies(data || []);
    } catch (error) {
      console.error('[loadCurrencies] ERROR:', error);
      setCurrencies([]);
    }
  };

  const loadTypes = async () => {
    setLoading(true);

    try {
      const types = await getAllRemittanceTypes();
      setTypes(types || []);
    } catch (error) {
      console.error('[loadTypes] ERROR:', error);
      console.error('[loadTypes] Error details:', {
        message: error?.message,
        code: error?.code
      });
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
    // Set defaults based on available currencies
    const defaultOrigin = currencies.find(c => c.code === 'USD') || currencies[0];
    const defaultDelivery = currencies.find(c => c.code === 'CUP') || currencies[0];
    setFormData({
      name: '',
      currency_code: defaultOrigin?.code || '',
      delivery_currency: defaultDelivery?.code || '',
      exchange_rate: '',
      delivery_rate: '',
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
    setSimAmount('100');
    setSimMode('send');
    setShowAdvanced(false);
    setShowForm(true);
  };

  const handleEdit = (type) => {
    setEditingType(type);
    // Derive delivery_rate from existing exchange_rate and commission_percentage
    const rate = type.exchange_rate || 0;
    const pct = type.commission_percentage || 0;
    const derivedDeliveryRate = rate * (1 - pct / 100);
    setFormData({
      name: type.name,
      currency_code: type.currency_code,
      delivery_currency: type.delivery_currency,
      exchange_rate: type.exchange_rate.toString(),
      delivery_rate: derivedDeliveryRate > 0 ? derivedDeliveryRate.toFixed(2) : '',
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
    setSimAmount('100');
    setSimMode('send');
    setShowAdvanced(parseFloat(type.commission_fixed) > 0);
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
      console.warn('[handleSave] Validation failed - Missing required fields');
      toast({
        title: t('common.error'),
        description: t('remittances.admin.requiredFields'),
        variant: 'destructive'
      });
      return;
    }

    // Validate currencies are selected
    if (!formData.currency_code || !formData.delivery_currency) {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.selectBothCurrencies'),
        variant: 'destructive'
      });
      return;
    }

    // Validate selected currencies are active
    const originCurrency = currencies.find(c => c.code === formData.currency_code);
    const deliveryCurrency = currencies.find(c => c.code === formData.delivery_currency);
    if (!originCurrency || !deliveryCurrency) {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.inactiveCurrency'),
        variant: 'destructive'
      });
      return;
    }

    // Validate delivery rate vs market rate
    const marketRate = parseFloat(formData.exchange_rate);
    const deliveryRate = parseFloat(formData.delivery_rate);
    if (deliveryRate > 0 && marketRate > 0 && deliveryRate > marketRate) {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.deliveryRateTooHigh'),
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

    try {
      if (editingType) {
        // Detect rate/commission changes and warn admin about affected pending remittances
        const oldRate = editingType.exchange_rate;
        const newRate = parseFloat(formData.exchange_rate);
        const oldCommPct = editingType.commission_percentage || 0;
        const newCommPct = parseFloat(formData.commission_percentage) || 0;

        const rateChanged = Math.abs(oldRate - newRate) > 0.0001 ||
                            Math.abs(oldCommPct - newCommPct) > 0.01;

        if (rateChanged) {
          const pendingCount = await getPendingRemittancesCountByType(editingType.id);
          if (pendingCount > 0) {
            const msg = t('remittances.admin.rateChangeAffected', { count: pendingCount })
              || `There are ${pendingCount} pending remittance(s) created at the previous rate. Users will be notified of the change.`;
            const confirmed = await showModal({
              type: 'warning',
              title: t('remittances.admin.rateChangeWarning') || 'Rate Change Detected',
              message: msg,
              confirmText: t('common.confirm'),
              cancelText: t('common.cancel')
            });
            if (!confirmed) return;
          }
        }

        await updateRemittanceType(editingType.id, typeData);
      } else {
        await createRemittanceType(typeData);
      }

      toast({
        title: t('common.success'),
        description: editingType ? t('remittances.admin.typeUpdated') : t('remittances.admin.typeCreated')
      });

      loadTypes();
      handleCancel();
    } catch (error) {
      console.error('[handleSave] ERROR:', error);
      console.error('[handleSave] Error details:', {
        message: error?.message,
        code: error?.code
      });
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive'
      });
    }
  };

  const handleDelete = async (type) => {

    const confirmed = await showModal({
      type: 'danger',
      title: t('remittances.admin.confirmDelete'),
      message: `${type.name}\n\n${t('remittances.admin.deleteWarning')}`,
      confirmText: t('common.delete'),
      cancelText: t('common.cancel')
    });

    if (!confirmed) {
      return;
    }

    try {
      await deleteRemittanceType(type.id);

      toast({
        title: t('common.success'),
        description: t('remittances.admin.typeDeleted')
      });

      loadTypes();
    } catch (error) {
      console.error('[handleDelete] ERROR:', error);
      console.error('[handleDelete] Error details:', {
        message: error?.message,
        code: error?.code
      });
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive'
      });
    }
  };

  const toggleActive = async (type) => {

    try {
      const newStatus = !type.is_active;

      await updateRemittanceType(type.id, { is_active: newStatus });

      toast({
        title: t('common.success'),
        description: type.is_active ? t('remittances.admin.typeDeactivated') : t('remittances.admin.typeActivated')
      });

      loadTypes();
    } catch (error) {
      console.error('[toggleActive] ERROR:', error);
      console.error('[toggleActive] Error details:', {
        message: error?.message,
        code: error?.code
      });
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
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
                <option value="">{t('remittances.admin.selectCurrency')}</option>
                {currencies.map(c => (
                  <option key={c.id} value={c.code}>
                    {c.code} - {language === 'es' ? c.name_es : c.name_en}
                  </option>
                ))}
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
                <option value="">{t('remittances.admin.selectCurrency')}</option>
                {currencies.map(c => (
                  <option key={c.id} value={c.code}>
                    {c.code} - {language === 'es' ? c.name_es : c.name_en}
                  </option>
                ))}
              </select>
            </div>

            {/* Market Rate (Exchange Rate) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('remittances.admin.marketRate')} *
              </label>
              <p className="text-xs text-gray-400 mb-2">{t('remittances.admin.marketRateHint')}</p>
              <div className="relative">
                <TrendingUp className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="number"
                  step="0.01"
                  value={formData.exchange_rate}
                  onChange={(e) => setFormData({ ...formData, exchange_rate: e.target.value })}
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="472.00"
                  required
                />
              </div>
            </div>

            {/* Delivery Rate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('remittances.admin.deliveryRate')} *
              </label>
              <p className="text-xs text-gray-400 mb-2">{t('remittances.admin.deliveryRateHint')}</p>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-green-500" />
                <input
                  type="number"
                  step="0.01"
                  value={formData.delivery_rate}
                  onChange={(e) => setFormData({ ...formData, delivery_rate: e.target.value })}
                  className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    parseFloat(formData.delivery_rate) > parseFloat(formData.exchange_rate) && parseFloat(formData.exchange_rate) > 0
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-300'
                  }`}
                  placeholder="470.00"
                  required
                />
              </div>
              {parseFloat(formData.delivery_rate) > parseFloat(formData.exchange_rate) && parseFloat(formData.exchange_rate) > 0 && (
                <p className="text-xs text-red-500 mt-1">{t('remittances.admin.deliveryRateTooHigh')}</p>
              )}
            </div>

            {/* Auto-calculated commission display */}
            {parseFloat(formData.exchange_rate) > 0 && parseFloat(formData.delivery_rate) > 0 && (
              <div className="md:col-span-2">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    <span className="text-sm text-blue-700 font-medium">{t('remittances.admin.calculatedCommission')}:</span>
                    <span className="text-sm font-bold text-blue-800">
                      {parseFloat(formData.commission_percentage || 0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-blue-700 font-medium">{t('remittances.admin.marginPerUnit')}:</span>
                    <span className="text-sm font-bold text-blue-800">
                      {(parseFloat(formData.exchange_rate) - parseFloat(formData.delivery_rate)).toFixed(2)} {formData.delivery_currency || ''}/{formData.currency_code || ''}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Advanced: Fixed commission (collapsible) */}
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {t('remittances.admin.advancedCommission')}
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-2">
                  <input
                    type="number"
                    step="0.01"
                    value={formData.commission_fixed}
                    onChange={(e) => setFormData({ ...formData, commission_fixed: e.target.value })}
                    className="w-full max-w-xs px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                  {parseFloat(formData.commission_fixed) > 0 && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {t('remittances.admin.advancedCommissionWarning')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Simulator */}
            {parseFloat(formData.exchange_rate) > 0 && parseFloat(formData.delivery_rate) > 0 && (
              <div className="md:col-span-2 bg-gray-50 border border-gray-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  {t('remittances.admin.simulator.title')}
                </h4>

                {/* Mode toggle + Amount */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <div className="flex bg-white border border-gray-300 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSimMode('send')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        simMode === 'send' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {t('remittances.admin.simulator.youSend')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimMode('receive')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        simMode === 'receive' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {t('remittances.admin.simulator.theyReceive')}
                    </button>
                  </div>
                  <div className="relative flex-1 min-w-[120px] max-w-[200px]">
                    <input
                      type="number"
                      step="0.01"
                      value={simAmount}
                      onChange={(e) => setSimAmount(e.target.value)}
                      className="w-full px-3 py-1.5 pr-14 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="100"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
                      {simMode === 'send' ? formData.currency_code : formData.delivery_currency}
                    </span>
                  </div>
                </div>

                {/* Results */}
                {simResult ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <p className="text-gray-500">{t('remittances.admin.simulator.amountSent')}</p>
                      <p className="font-semibold">{simResult.amount.toFixed(2)} {formData.currency_code}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">{t('remittances.admin.simulator.commissionPct')}</p>
                      <p className="font-semibold">{simResult.commPctAmount.toFixed(2)} {formData.currency_code}</p>
                    </div>
                    {simResult.commFixedAmount > 0 && (
                      <div>
                        <p className="text-gray-500">{t('remittances.admin.simulator.commissionFixed')}</p>
                        <p className="font-semibold">{simResult.commFixedAmount.toFixed(2)} {formData.currency_code}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-gray-500">{t('remittances.admin.simulator.totalCommission')}</p>
                      <p className="font-semibold text-red-600">{simResult.totalCommission.toFixed(2)} {formData.currency_code}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">{t('remittances.admin.simulator.netAmount')}</p>
                      <p className="font-semibold">{simResult.netAmount.toFixed(2)} {formData.currency_code}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">{t('remittances.admin.simulator.exchangeRateApplied')}</p>
                      <p className="font-semibold">{simResult.exchangeRate}</p>
                    </div>

                    {/* Highlighted results */}
                    <div className="col-span-2 sm:col-span-3 grid grid-cols-2 gap-3 mt-1">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                        <p className="text-green-600 text-[10px] uppercase font-medium">{t('remittances.admin.simulator.amountToDeliver')}</p>
                        <p className="font-bold text-green-700 text-base">{simResult.amountToDeliver.toFixed(2)} {formData.delivery_currency}</p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                        <p className="text-blue-600 text-[10px] uppercase font-medium">{t('remittances.admin.simulator.effectiveRate')}</p>
                        <p className="font-bold text-blue-700 text-base">
                          {simResult.effectiveRate.toFixed(2)} {formData.delivery_currency}/{formData.currency_code}
                        </p>
                      </div>
                    </div>

                    {simMode === 'receive' && (
                      <div className="col-span-2 sm:col-span-3 text-xs text-gray-500 mt-1">
                        {t('remittances.admin.simulator.mustSend')}: <span className="font-semibold">{simResult.amount.toFixed(2)} {formData.currency_code}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    {!parseFloat(formData.exchange_rate) ? t('remittances.admin.simulator.enterValidRate') : t('remittances.admin.simulator.enterValidAmount')}
                  </p>
                )}
              </div>
            )}

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
                <option value={DELIVERY_METHODS.CARD}>{t('remittances.recipient.card')}</option>
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
              className={`glass-effect p-3 sm:p-6 rounded-xl ${!type.is_active ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-col gap-3">
                {/* Header with name and action buttons */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <h3 className="text-sm sm:text-lg font-bold gradient-text truncate">{type.name}</h3>
                    {!type.is_active && (
                      <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[10px] sm:text-xs rounded-full flex-shrink-0">
                        {t('remittances.admin.inactive')}
                      </span>
                    )}
                  </div>
                  {/* Action buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(type)}
                      className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      title={type.is_active ? t('remittances.admin.deactivate') : t('remittances.admin.activate')}
                    >
                      {type.is_active ? (
                        <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
                      ) : (
                        <EyeOff className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                      )}
                    </button>
                    <button
                      onClick={() => handleEdit(type)}
                      className="p-1.5 sm:p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                      title={t('common.edit')}
                    >
                      <Edit className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                    {isSuperAdmin && (
                      <button
                        onClick={() => handleDelete(type)}
                        className="p-1.5 sm:p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
                  <div>
                    <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{t('remittances.admin.deliveryRate')}</p>
                    <p className="text-xs sm:text-sm font-bold text-green-700">
                      {(type.exchange_rate * (1 - (type.commission_percentage || 0) / 100)).toFixed(2)} {type.delivery_currency}/{type.currency_code}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{t('remittances.admin.marketRate')}</p>
                    <p className="text-xs sm:text-sm font-semibold">
                      {type.exchange_rate} {type.delivery_currency}/{type.currency_code}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{t('remittances.admin.commission')}</p>
                    <p className="text-xs sm:text-sm font-semibold">
                      {(type.commission_percentage || 0).toFixed(2)}%
                      {type.commission_fixed > 0 && ` + ${type.commission_fixed} ${type.currency_code}`}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{t('remittances.admin.limits')}</p>
                    <p className="text-xs sm:text-sm font-semibold">
                      {type.min_amount} - {type.max_amount || '∞'} {type.currency_code}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{t('remittances.admin.delivery')}</p>
                    <p className="text-xs sm:text-sm font-semibold capitalize">{type.delivery_method}</p>
                  </div>

                  <div>
                    <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{t('remittances.admin.maxTime')}</p>
                    <p className="text-xs sm:text-sm font-semibold">
                      {type.max_delivery_days} {type.max_delivery_days === 1 ? t('adminOrders.days.singular') : t('adminOrders.days.plural')}
                      <span className="text-gray-400 ml-1">({t('remittances.admin.alertDays')}: {type.warning_days})</span>
                    </p>
                  </div>
                </div>

                {type.description && (
                  <p className="text-xs sm:text-sm text-gray-600 line-clamp-2">{type.description}</p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RemittanceTypesConfig;
