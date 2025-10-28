import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, Eye, CheckCircle, XCircle, Clock, Package, Truck,
  AlertTriangle, Download, FileText, Image as ImageIcon, Calendar, X
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useModal } from '@/contexts/ModalContext';
import {
  getAllRemittances,
  validatePayment,
  rejectPayment,
  startProcessing,
  confirmDelivery,
  completeRemittance,
  calculateDeliveryAlert,
  REMITTANCE_STATUS
} from '@/lib/remittanceService';
import { toast } from '@/components/ui/use-toast';
import { getPrimaryButtonStyle } from '@/lib/styleUtils';

const AdminRemittancesTab = () => {
  const { t } = useLanguage();
  const { showModal } = useModal();

  const [remittances, setRemittances] = useState([]);
  const [filteredRemittances, setFilteredRemittances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRemittance, setSelectedRemittance] = useState(null);

  useEffect(() => {
    loadRemittances();
  }, []);

  useEffect(() => {
    filterRemittances();
  }, [remittances, searchTerm, statusFilter]);

  const loadRemittances = async () => {
    setLoading(true);
    const result = await getAllRemittances({});
    if (result.success) {
      setRemittances(result.remittances);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const filterRemittances = () => {
    let filtered = [...remittances];

    // Filtro por búsqueda
    if (searchTerm) {
      filtered = filtered.filter(r =>
        r.remittance_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.recipient_phone?.includes(searchTerm)
      );
    }

    // Filtro por estado
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending_validation') {
        filtered = filtered.filter(r => r.status === REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED);
      } else if (statusFilter === 'in_progress') {
        filtered = filtered.filter(r =>
          [REMITTANCE_STATUS.PAYMENT_VALIDATED, REMITTANCE_STATUS.PROCESSING].includes(r.status)
        );
      } else if (statusFilter === 'urgent') {
        filtered = filtered.filter(r => {
          const alert = calculateDeliveryAlert(r);
          return alert.level === 'error' || alert.level === 'warning';
        });
      } else {
        filtered = filtered.filter(r => r.status === statusFilter);
      }
    }

    setFilteredRemittances(filtered);
  };

  const handleValidatePayment = async (remittance) => {
    const notes = await showModal({
      title: t('remittances.admin.validate'),
      message: t('remittances.admin.confirmValidateMessage', { amount: remittance.amount, currency: remittance.currency }),
      input: true,
      inputLabel: t('remittances.admin.validationNotes') + ' (opcional)',
      inputPlaceholder: t('remittances.admin.validationNotesPlaceholder'),
      confirmText: t('remittances.admin.validate'),
      cancelText: t('common.cancel'),
      type: 'success'
    });

    if (notes === false) return; // User cancelled

    const result = await validatePayment(remittance.id, notes || '');

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.paymentValidated')
      });
      loadRemittances();
      setSelectedRemittance(null);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleRejectPayment = async (remittance) => {
    const reason = await showModal({
      title: t('remittances.admin.reject'),
      message: t('remittances.admin.confirmRejectMessage', { number: remittance.remittance_number }),
      input: true,
      inputLabel: t('remittances.admin.rejectReason') + ' *',
      inputPlaceholder: t('remittances.admin.rejectReasonPlaceholder'),
      confirmText: t('remittances.admin.reject'),
      cancelText: t('common.cancel'),
      type: 'danger',
      required: true
    });

    if (!reason) return;

    const result = await rejectPayment(remittance.id, reason);

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.paymentRejected')
      });
      loadRemittances();
      setSelectedRemittance(null);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleStartProcessing = async (remittance) => {
    const confirmed = await showModal({
      title: t('remittances.admin.process'),
      message: t('remittances.admin.confirmProcessMessage', { number: remittance.remittance_number }),
      confirmText: t('remittances.admin.process'),
      cancelText: t('common.cancel')
    });

    if (!confirmed) return;

    const result = await startProcessing(remittance.id, '');

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.processingStarted')
      });
      loadRemittances();
      setSelectedRemittance(null);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleConfirmDelivery = async (remittance) => {
    const notes = await showModal({
      title: t('remittances.admin.confirmDelivery'),
      message: t('remittances.admin.confirmDeliveryMessage', {
        amount: remittance.amount_to_deliver,
        currency: remittance.delivery_currency,
        recipient: remittance.recipient_name
      }),
      input: true,
      inputLabel: t('remittances.admin.deliveryNotes'),
      inputPlaceholder: t('remittances.admin.deliveryNotesPlaceholder'),
      confirmText: t('remittances.admin.confirmDelivery'),
      cancelText: t('common.cancel'),
      type: 'success'
    });

    if (notes === false) return;

    const result = await confirmDelivery(remittance.id, null, notes || '');

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.deliveryConfirmed')
      });
      loadRemittances();
      setSelectedRemittance(null);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleComplete = async (remittance) => {
    const confirmed = await showModal({
      title: t('remittances.admin.complete'),
      message: t('remittances.admin.confirmCompleteMessage', { number: remittance.remittance_number }),
      confirmText: t('remittances.admin.complete'),
      cancelText: t('common.cancel'),
      type: 'success'
    });

    if (!confirmed) return;

    const result = await completeRemittance(remittance.id, '');

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.remittanceCompleted')
      });
      loadRemittances();
      setSelectedRemittance(null);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      [REMITTANCE_STATUS.PAYMENT_PENDING]: {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        label: t('remittances.status.paymentPending')
      },
      [REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED]: {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        label: t('remittances.status.paymentProofUploaded')
      },
      [REMITTANCE_STATUS.PAYMENT_VALIDATED]: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        label: t('remittances.status.paymentValidated')
      },
      [REMITTANCE_STATUS.PAYMENT_REJECTED]: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        label: t('remittances.status.paymentRejected')
      },
      [REMITTANCE_STATUS.PROCESSING]: {
        bg: 'bg-purple-100',
        text: 'text-purple-700',
        label: t('remittances.status.processing')
      },
      [REMITTANCE_STATUS.DELIVERED]: {
        bg: 'bg-green-100',
        text: 'text-green-700',
        label: t('remittances.status.delivered')
      },
      [REMITTANCE_STATUS.COMPLETED]: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        label: t('remittances.status.completed')
      },
      [REMITTANCE_STATUS.CANCELLED]: {
        bg: 'bg-gray-100',
        text: 'text-gray-500',
        label: t('remittances.status.cancelled')
      }
    };

    const badge = badges[status] || badges[REMITTANCE_STATUS.PAYMENT_PENDING];

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  const getAlertBadge = (remittance) => {
    const alert = calculateDeliveryAlert(remittance);

    const colors = {
      success: 'bg-green-100 text-green-700',
      info: 'bg-blue-100 text-blue-700',
      warning: 'bg-yellow-100 text-yellow-700',
      error: 'bg-red-100 text-red-700'
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[alert.level]}`}>
        {alert.message}
      </span>
    );
  };

  const renderActionButtons = (remittance) => {
    switch (remittance.status) {
      case REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED:
        return (
          <div className="flex gap-2">
            <button
              onClick={() => handleValidatePayment(remittance)}
              className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
            >
              <CheckCircle className="h-4 w-4" />
              {t('remittances.admin.validate')}
            </button>
            <button
              onClick={() => handleRejectPayment(remittance)}
              className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
            >
              <XCircle className="h-4 w-4" />
              {t('remittances.admin.reject')}
            </button>
          </div>
        );

      case REMITTANCE_STATUS.PAYMENT_VALIDATED:
        return (
          <button
            onClick={() => handleStartProcessing(remittance)}
            className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            <Package className="h-4 w-4" />
            {t('remittances.admin.process')}
          </button>
        );

      case REMITTANCE_STATUS.PROCESSING:
        return (
          <button
            onClick={() => handleConfirmDelivery(remittance)}
            className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
          >
            <Truck className="h-4 w-4" />
            {t('remittances.admin.confirmDelivery')}
          </button>
        );

      case REMITTANCE_STATUS.DELIVERED:
        return (
          <button
            onClick={() => handleComplete(remittance)}
            className="flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
          >
            <CheckCircle className="h-4 w-4" />
            {t('remittances.admin.complete')}
          </button>
        );

      default:
        return null;
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
      {/* Filters */}
      <div className="glass-effect p-4 rounded-xl">
        <div className="grid md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('remittances.admin.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
            >
              <option value="all">{t('remittances.admin.allStatuses')}</option>
              <option value="pending_validation">{t('remittances.admin.pendingValidation')}</option>
              <option value="in_progress">{t('remittances.admin.inProgress')}</option>
              <option value="urgent">{t('remittances.admin.urgent')}</option>
              <option value={REMITTANCE_STATUS.COMPLETED}>{t('remittances.status.completed')}</option>
              <option value={REMITTANCE_STATUS.CANCELLED}>{t('remittances.status.cancelled')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: t('remittances.admin.pendingValidation'),
            value: remittances.filter(r => r.status === REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED).length,
            color: 'bg-yellow-100 text-yellow-700'
          },
          {
            label: t('remittances.admin.inProgress'),
            value: remittances.filter(r =>
              [REMITTANCE_STATUS.PAYMENT_VALIDATED, REMITTANCE_STATUS.PROCESSING].includes(r.status)
            ).length,
            color: 'bg-blue-100 text-blue-700'
          },
          {
            label: t('remittances.status.completed'),
            value: remittances.filter(r => r.status === REMITTANCE_STATUS.COMPLETED).length,
            color: 'bg-green-100 text-green-700'
          },
          {
            label: t('remittances.admin.total'),
            value: remittances.length,
            color: 'bg-gray-100 text-gray-700'
          }
        ].map((stat, i) => (
          <div key={i} className="glass-effect p-4 rounded-xl">
            <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Remittances List */}
      {filteredRemittances.length === 0 ? (
        <div className="text-center py-12 glass-effect rounded-xl">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{t('remittances.user.noRemittances')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRemittances.map((remittance) => (
            <motion.div
              key={remittance.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-effect p-6 rounded-xl hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold gradient-text">
                    {remittance.remittance_number}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {remittance.remittance_types?.name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(remittance.status)}
                  {[REMITTANCE_STATUS.PAYMENT_VALIDATED, REMITTANCE_STATUS.PROCESSING].includes(remittance.status) && (
                    getAlertBadge(remittance)
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.user.amountSent')}</p>
                  <p className="font-semibold">
                    {remittance.amount} {remittance.currency}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.user.toDeliver')}</p>
                  <p className="font-semibold">
                    {remittance.amount_to_deliver?.toFixed(2)} {remittance.delivery_currency}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.user.method')}</p>
                  <p className="font-semibold capitalize">{remittance.delivery_method}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.fullName')}</p>
                  <p className="font-semibold">{remittance.recipient_name}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.phone')}</p>
                  <p className="font-semibold">{remittance.recipient_phone}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.city')}</p>
                  <p className="font-semibold">{remittance.recipient_city || 'N/A'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {new Date(remittance.created_at).toLocaleDateString('es-CU')}
                  </span>
                  {remittance.payment_proof_url && (
                    <a
                      href={remittance.payment_proof_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      <FileText className="h-4 w-4" />
                      {t('remittances.user.viewProof')}
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedRemittance(remittance)}
                    className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                  >
                    <Eye className="h-4 w-4" />
                    {t('remittances.admin.viewDetails')}
                  </button>
                  {renderActionButtons(remittance)}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Details Modal (simplified - full implementation would use a proper modal component) */}
      {selectedRemittance && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedRemittance(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold gradient-text">
                {t('remittances.admin.viewDetails')} - {selectedRemittance.remittance_number}
              </h2>
              <button
                onClick={() => setSelectedRemittance(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Content - 2 Column Layout */}
            <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Remittance Information */}
              <div className="lg:col-span-2 space-y-6">
                {/* Basic Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500 uppercase tracking-wider">{t('common.number')}</p>
                    <p className="font-semibold text-lg">{selectedRemittance.remittance_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 uppercase tracking-wider">{t('common.status')}</p>
                    {getStatusBadge(selectedRemittance.status)}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 uppercase tracking-wider">{t('common.type')}</p>
                    <p className="font-semibold">{selectedRemittance.remittance_types?.name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 uppercase tracking-wider">{t('common.createdAt')}</p>
                    <p className="font-semibold">
                      {new Date(selectedRemittance.created_at).toLocaleString('es-CU')}
                    </p>
                  </div>
                </div>

                {/* Amount Information */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold text-gray-900 mb-3">Información de Monto</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Monto Enviado:</p>
                      <p className="text-lg font-bold text-blue-600">{selectedRemittance.amount} {selectedRemittance.currency}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">A Entregar:</p>
                      <p className="text-lg font-bold text-green-600">{selectedRemittance.amount_to_deliver?.toFixed(2)} {selectedRemittance.delivery_currency}</p>
                    </div>
                  </div>
                </div>

                {/* Recipient Information */}
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Información del Destinatario</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                    <p><span className="font-medium">Nombre:</span> {selectedRemittance.recipient_name || 'N/A'}</p>
                    <p><span className="font-medium">Teléfono:</span> {selectedRemittance.recipient_phone || 'N/A'}</p>
                    <p><span className="font-medium">Ciudad:</span> {selectedRemittance.recipient_city || 'N/A'}</p>
                  </div>
                </div>

                {/* Location Information - Only for Cash Delivery */}
                {selectedRemittance.delivery_method === 'cash' && (
                  <div className="border-l-4 border-green-500 bg-green-50 rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
                      Entrega en Efectivo - Datos de Localización
                    </h3>
                    <div className="space-y-2 text-sm">
                      {selectedRemittance.recipient_province && (
                        <p><span className="font-medium">Provincia:</span> {selectedRemittance.recipient_province}</p>
                      )}
                      {selectedRemittance.recipient_municipality && (
                        <p><span className="font-medium">Municipio:</span> {selectedRemittance.recipient_municipality}</p>
                      )}
                      {selectedRemittance.recipient_address && (
                        <p><span className="font-medium">Dirección:</span> {selectedRemittance.recipient_address}</p>
                      )}
                      {selectedRemittance.recipient_id_number && (
                        <p><span className="font-medium">Carnet de Identidad:</span> {selectedRemittance.recipient_id_number}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Bank Account Information - For Bank Transfer/Card */}
                {selectedRemittance.delivery_method !== 'cash' && selectedRemittance.recipient_bank_account && (
                  <div className="border-l-4 border-blue-500 bg-blue-50 rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="inline-block w-3 h-3 bg-blue-500 rounded-full"></span>
                      {selectedRemittance.delivery_method === 'transfer' ? '🏦 Datos Bancarios' : '💳 Datos de Cuenta'}
                    </h3>
                    <div className="space-y-2 text-sm font-mono bg-white rounded p-3 border border-blue-200">
                      <p>{selectedRemittance.recipient_bank_account}</p>
                    </div>
                    {selectedRemittance.recipient_bank_name && (
                      <p className="text-sm mt-2"><span className="font-medium">Banco:</span> {selectedRemittance.recipient_bank_name}</p>
                    )}
                  </div>
                )}

                {/* Delivery Method */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-blue-600 font-medium mb-1">Método de Entrega</p>
                  <p className="text-lg font-semibold text-blue-900">
                    {selectedRemittance.delivery_method === 'cash' ? '💵 Efectivo'
                      : selectedRemittance.delivery_method === 'transfer' ? '🏦 Transferencia Bancaria'
                      : selectedRemittance.delivery_method === 'card' ? '💳 Tarjeta'
                      : selectedRemittance.delivery_method}
                  </p>
                </div>

                {/* Payment Reference */}
                {selectedRemittance.payment_reference && (
                  <div>
                    <p className="text-sm text-gray-600 font-medium mb-2">Referencia de Pago</p>
                    <p className="font-mono bg-gray-50 p-3 rounded-lg text-sm">{selectedRemittance.payment_reference}</p>
                  </div>
                )}

                {/* Notes */}
                {selectedRemittance.notes && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Notas</h3>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4">{selectedRemittance.notes}</p>
                  </div>
                )}
              </div>

              {/* Right Column - Payment Proof */}
              <div className="lg:col-span-1">
                {selectedRemittance.payment_proof_url ? (
                  <div className="sticky top-20 space-y-3">
                    <h4 className="font-semibold text-gray-900">Comprobante de Pago</h4>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-2">
                      <img
                        src={selectedRemittance.payment_proof_url}
                        alt="Comprobante de pago"
                        className="w-full h-auto rounded-lg"
                      />
                    </div>
                    <a
                      href={selectedRemittance.payment_proof_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-sm text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      Ver en tamaño completo →
                    </a>
                  </div>
                ) : (
                  <div className="sticky top-20 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 font-medium">
                      Sin comprobante de pago
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer - Close Button */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setSelectedRemittance(null)}
                className="w-full py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                {t('remittances.admin.cancel')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default AdminRemittancesTab;
