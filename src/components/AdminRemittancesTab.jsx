import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, Eye, CheckCircle, XCircle, Clock, Package, Truck,
  AlertTriangle, Download, FileText, Image as ImageIcon, Calendar, X
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModal } from '@/contexts/ModalContext';
import {
  getAllRemittances,
  validatePayment,
  rejectPayment,
  startProcessing,
  confirmDelivery,
  completeRemittance,
  calculateDeliveryAlert,
  generateProofSignedUrl,
  getRemittanceDetails,
  REMITTANCE_STATUS
} from '@/lib/remittanceService';
import { toast } from '@/components/ui/use-toast';
import ImageProofModal from './ImageProofModal';
import TooltipButton from './TooltipButton';

const AdminRemittancesTab = () => {
  const { t, language } = useLanguage();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showModal } = useModal();

  const locale = language === 'es' ? 'es-CU' : 'en-US';

  const [remittances, setRemittances] = useState([]);
  const [filteredRemittances, setFilteredRemittances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRemittance, setSelectedRemittance] = useState(null);
  const [proofSignedUrl, setProofSignedUrl] = useState(null);
  const [deliveryProofSignedUrl, setDeliveryProofSignedUrl] = useState(null);
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false);
  const [selectedProofUrl, setSelectedProofUrl] = useState(null);

  useEffect(() => {
    loadRemittances();
  }, []);

  useEffect(() => {
    filterRemittances();
  }, [remittances, searchTerm, statusFilter]);

  // Generate signed URL for payment proof when modal opens
  useEffect(() => {
    const loadProofSignedUrl = async () => {
      if (selectedRemittance?.payment_proof_url) {
        setProofSignedUrl(null);
        const result = await generateProofSignedUrl(selectedRemittance.payment_proof_url);
        if (result.success) {
          setProofSignedUrl(result.signedUrl);
        }
      } else {
        setProofSignedUrl(null);
      }
    };
    loadProofSignedUrl();
  }, [selectedRemittance?.payment_proof_url]);


  // Generate signed URL for delivery proof when modal opens
  useEffect(() => {
    const loadDeliveryProofUrl = async () => {
      if (selectedRemittance?.delivery_proof_url) {
        setDeliveryProofSignedUrl(null);
        const result = await generateProofSignedUrl(selectedRemittance.delivery_proof_url, 'remittance-delivery-proofs');
        if (result.success) {
          setDeliveryProofSignedUrl(result.signedUrl);
        }
      } else {
        setDeliveryProofSignedUrl(null);
      }
    };
    loadDeliveryProofUrl();
  }, [selectedRemittance?.delivery_proof_url]);

  const loadRemittances = async () => {
    setLoading(true);
    try {
      const remittances = await getAllRemittances({});
      setRemittances(remittances || []);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || 'Error loading remittances',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
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

  const handleViewDetails = async (remittance) => {
    try {
      const details = await getRemittanceDetails(remittance.id);
      setSelectedRemittance(details);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || 'No se pudieron cargar los detalles de la remesa',
        variant: 'destructive'
      });
    }
  };

  const handleValidatePayment = async (remittance) => {
    const notes = await showModal({
      title: t('remittances.admin.validate'),
      message: t('remittances.admin.confirmValidateMessage', { amount: remittance.amount_sent, currency: remittance.currency_sent }),
      input: true,
      inputLabel: t('remittances.admin.validationNotes') + ' (opcional)',
      inputPlaceholder: t('remittances.admin.validationNotesPlaceholder'),
      confirmText: t('remittances.admin.validate'),
      cancelText: t('common.cancel'),
      type: 'success'
    });

    if (notes === false) return; // User cancelled

    try {
      await validatePayment(remittance.id, notes || '');
      toast({
        title: t('common.success'),
        description: t('remittances.admin.paymentValidated')
      });
      await loadRemittances();
      setSelectedRemittance(null);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.admin.paymentValidationFailed'),
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

    try {
      await rejectPayment(remittance.id, reason);
      toast({
        title: t('common.success'),
        description: t('remittances.admin.paymentRejected')
      });
      await loadRemittances();
      setSelectedRemittance(null);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.admin.paymentRejectionFailed'),
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

    try {
      await startProcessing(remittance.id, '');
      toast({
        title: t('common.success'),
        description: t('remittances.admin.processingStarted')
      });
      await loadRemittances();
      setSelectedRemittance(null);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.admin.processingFailed'),
        variant: 'destructive'
      });
    }
  };

  const handleUploadDeliveryProof = async (remittance, file) => {
    if (!file) {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.selectDeliveryProofFile'),
        variant: 'destructive'
      });
      return;
    }

    try {
      // Upload file to Supabase Storage
      const { supabase } = await import('@/lib/supabase');
      const fileExt = file.name.split('.').pop();
      // File path structure: {user_id}/{remittance_id}_delivery_proof.{ext}
      const filePath = `${remittance.user_id}/${remittance.id}_delivery_proof.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('remittance-delivery-proofs')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Update remittance with delivery proof URL
      const { supabase: sb } = await import('@/lib/supabase');
      const { error: updateError } = await sb
        .from('remittances')
        .update({ delivery_proof_url: filePath })
        .eq('id', remittance.id);

      if (updateError) throw updateError;

      toast({
        title: t('common.success'),
        description: t('remittances.admin.deliveryProofUploaded')
      });

      await loadRemittances();
    } catch (error) {
      console.error('Error uploading delivery proof:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.admin.deliveryProofUploadFailed'),
        variant: 'destructive'
      });
    }
  };

  const handleConfirmDelivery = async (remittance) => {
    // SECURITY: Check if delivery proof exists
    const hasDeliveryProof = remittance.delivery_proof_url && remittance.delivery_proof_url.trim() !== '';

    if (!hasDeliveryProof) {
      // Delivery proof is required but missing
      toast({
        title: t('common.error'),
        description: t('remittances.admin.deliveryProofRequired'),
        variant: 'destructive'
      });
      return;
    }

    const notes = await showModal({
      title: t('remittances.admin.confirmDelivery'),
      message: t('remittances.admin.confirmDeliveryMessage', {
        amount: remittance.amount_to_deliver,
        currency: remittance.currency_delivered,
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

    try {
      // Pass null for proofFile since proof must already exist (enforced by validation above)
      await confirmDelivery(remittance.id, null, notes || '');
      toast({
        title: t('common.success'),
        description: t('remittances.admin.deliveryConfirmed')
      });
      await loadRemittances();
      setSelectedRemittance(null);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.admin.deliveryConfirmationFailed'),
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

    try {
      await completeRemittance(remittance.id, '');
      toast({
        title: t('common.success'),
        description: t('remittances.admin.remittanceCompleted')
      });
      await loadRemittances();
      setSelectedRemittance(null);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.admin.completionFailed'),
        variant: 'destructive'
      });
    }
  };

  const handleViewPaymentProof = (remittance) => {
    setSelectedProofUrl(remittance.payment_proof_url);
    setShowPaymentProofModal(true);
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
            <TooltipButton
              tooltipText={t('remittances.admin.validate')}
              className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
              onClick={() => handleValidatePayment(remittance)}
              title={t('remittances.admin.validate')}
            >
              <CheckCircle className="h-4 w-4" />
              <span className="hidden sm:inline">{t('remittances.admin.validate')}</span>
            </TooltipButton>
            <TooltipButton
              tooltipText={t('remittances.admin.reject')}
              className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
              onClick={() => handleRejectPayment(remittance)}
              title={t('remittances.admin.reject')}
            >
              <XCircle className="h-4 w-4" />
              <span className="hidden sm:inline">{t('remittances.admin.reject')}</span>
            </TooltipButton>
          </div>
        );

      case REMITTANCE_STATUS.PAYMENT_VALIDATED:
        return (
          <TooltipButton
            tooltipText={t('remittances.admin.process')}
            className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            onClick={() => handleStartProcessing(remittance)}
            title={t('remittances.admin.process')}
          >
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">{t('remittances.admin.process')}</span>
          </TooltipButton>
        );

      case REMITTANCE_STATUS.PROCESSING:
        const hasDeliveryProof = remittance.delivery_proof_url && remittance.delivery_proof_url.trim() !== '';
        return (
          <div className="flex flex-col gap-2">
            {/* Upload Delivery Proof */}
            <div className="flex items-center gap-2">
              <label
                className="flex items-center gap-2 px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm cursor-pointer"
                title={hasDeliveryProof ? t('remittances.admin.changeDeliveryProof') : t('remittances.admin.uploadDeliveryProof')}
              >
                <ImageIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{hasDeliveryProof ? t('remittances.admin.changeDeliveryProof') : t('remittances.admin.uploadDeliveryProof')}</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleUploadDeliveryProof(remittance, file);
                    }
                  }}
                  className="hidden"
                />
              </label>
              {hasDeliveryProof && (
                <span className="text-xs text-green-600 font-semibold flex items-center gap-1" title={t('remittances.admin.proofUploaded')}>
                  <CheckCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('remittances.admin.proofUploaded')}</span>
                </span>
              )}
            </div>

            {/* Confirm Delivery - Only enabled if proof exists */}
            <TooltipButton
              tooltipText={t('remittances.admin.confirmDelivery')}
              onClick={() => handleConfirmDelivery(remittance)}
              disabled={!hasDeliveryProof}
              className={`flex items-center gap-1 px-2 sm:px-3 py-1 rounded-lg transition-colors text-sm ${
                hasDeliveryProof
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-400 text-gray-200 cursor-not-allowed'
              }`}
              title={t('remittances.admin.confirmDelivery')}
            >
              <Truck className="h-4 w-4" />
              <span className="hidden sm:inline">{t('remittances.admin.confirmDelivery')}</span>
            </TooltipButton>
          </div>
        );

      case REMITTANCE_STATUS.DELIVERED:
        return (
          <TooltipButton
            tooltipText={t('remittances.admin.complete')}
            onClick={() => handleComplete(remittance)}
            className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
            title={t('remittances.admin.complete')}
          >
            <CheckCircle className="h-4 w-4" />
            <span className="hidden sm:inline">{t('remittances.admin.complete')}</span>
          </TooltipButton>
        );

      default:
        return null;
    }
  };

  if (!isAdmin && !isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertTriangle className="h-16 w-16 text-yellow-600 mb-4" />
        <h3 className="text-xl font-bold text-gray-700 mb-2">
          {t('common.accessDenied')}
        </h3>
        <p className="text-gray-600 text-center max-w-md">
          {t('remittances.admin.adminCannotViewRemittances')}
        </p>
      </div>
    );
  }

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

              <div className="grid md:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.user.amountSent')}</p>
                  <p className="font-semibold">
                    {remittance.amount_sent} {remittance.currency_sent}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.user.toDeliver')}</p>
                  <p className="font-semibold">
                    {remittance.amount_to_deliver?.toFixed(2)} {remittance.currency_delivered}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.user.method')}</p>
                  <p className="font-semibold capitalize">{remittance.delivery_method}</p>
                </div>

                {remittance.recipient_city && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.city')}</p>
                    <p className="font-semibold">
                      {remittance.recipient_city}
                      {remittance.recipient_province && `, ${remittance.recipient_province}`}
                      {remittance.recipient_municipality && `, ${remittance.recipient_municipality}`}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.fullName')}</p>
                  <p className="font-semibold">{remittance.recipient_name}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.phone')}</p>
                  <p className="font-semibold">{remittance.recipient_phone}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {new Date(remittance.created_at).toLocaleDateString(locale)}
                  </span>
                  {remittance.payment_proof_url && (
                    <TooltipButton
                      tooltipText={t('remittances.user.viewProof')}
                      onClick={() => handleViewPaymentProof(remittance)}
                      className="flex items-center gap-1 px-2 sm:px-3 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors text-sm"
                      title={t('remittances.user.viewProof')}
                    >
                      <FileText className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('remittances.user.viewProof')}</span>
                    </TooltipButton>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <TooltipButton
                    tooltipText={t('remittances.admin.viewDetails')}
                    onClick={() => handleViewDetails(remittance)}
                    className="flex items-center gap-1 px-2 sm:px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                    title={t('remittances.admin.viewDetails')}
                  >
                    <Eye className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('remittances.admin.viewDetails')}</span>
                  </TooltipButton>
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
            className="bg-white rounded-2xl max-w-4xl sm:max-w-5xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl sm:text-2xl font-bold gradient-text">
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
            <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                      {new Date(selectedRemittance.created_at).toLocaleString(locale)}
                    </p>
                  </div>
                </div>

                {/* Amount Information */}
                <div className="bg-gray-50 rounded-lg p-3 sm:p-4 space-y-3">
                  <h3 className="font-semibold text-gray-900 mb-3 text-sm sm:text-base">{t('remittances.admin.amountInfoTitle')}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs sm:text-sm text-gray-600">{t('remittances.admin.amountSent')}</p>
                      <p className="text-base sm:text-lg font-bold text-blue-600">{selectedRemittance.amount_sent} {selectedRemittance.currency_sent}</p>
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm text-gray-600">{t('remittances.admin.toDeliver')}</p>
                      <p className="text-base sm:text-lg font-bold text-green-600">{selectedRemittance.amount_to_deliver?.toFixed(2)} {selectedRemittance.currency_delivered}</p>
                    </div>
                  </div>
                </div>

                {/* Recipient Information */}
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 text-sm sm:text-base">{t('remittances.admin.recipientInfoTitle')}</h3>
                  <div className="bg-gray-50 rounded-lg p-3 sm:p-4 space-y-2 text-xs sm:text-sm">
                    <p><span className="font-medium">{t('remittances.admin.recipientName')}</span> {selectedRemittance.recipient_name || 'N/A'}</p>
                    <p><span className="font-medium">{t('remittances.admin.recipientPhone')}</span> {selectedRemittance.recipient_phone || 'N/A'}</p>
                    {selectedRemittance.recipient_city && (
                      <p>
                        <span className="font-medium">{t('remittances.admin.recipientLocation')}</span> {selectedRemittance.recipient_city}
                        {selectedRemittance.recipient_province && `, ${selectedRemittance.recipient_province}`}
                        {selectedRemittance.recipient_municipality && `, ${selectedRemittance.recipient_municipality}`}
                      </p>
                    )}
                  </div>
                </div>

                {/* Location Information - Only for Cash Delivery */}
                {selectedRemittance.delivery_method === 'cash' && (
                  <div className="border-l-4 border-green-500 bg-green-50 rounded-lg p-3 sm:p-4">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm sm:text-base">
                      <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
                      {t('remittances.admin.cashDeliveryTitle')}
                    </h3>
                    <div className="space-y-2 text-xs sm:text-sm">
                      {selectedRemittance.recipient_province && (
                        <p><span className="font-medium">{t('remittances.admin.province')}</span> {selectedRemittance.recipient_province}</p>
                      )}
                      {selectedRemittance.recipient_municipality && (
                        <p><span className="font-medium">{t('remittances.admin.municipality')}</span> {selectedRemittance.recipient_municipality}</p>
                      )}
                      {selectedRemittance.recipient_address && (
                        <p><span className="font-medium">{t('common.address')}</span> {selectedRemittance.recipient_address}</p>
                      )}
                      {selectedRemittance.recipient_id_number && (
                        <p><span className="font-medium">{t('remittances.recipient.idNumber')}</span> {selectedRemittance.recipient_id_number}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Bank Account Information - For Bank Transfer/Card */}
                {selectedRemittance.delivery_method !== 'cash' && selectedRemittance.recipient_bank_account && (
                  <div className="border-l-4 border-blue-500 bg-blue-50 rounded-lg p-3 sm:p-4">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm sm:text-base">
                      <span className="inline-block w-3 h-3 bg-blue-500 rounded-full"></span>
                      {selectedRemittance.delivery_method === 'transfer' ? t('remittances.admin.bankInfoTitle') : t('remittances.admin.cardInfoTitle')}
                    </h3>
                    <div className="space-y-2 text-xs sm:text-sm font-mono bg-white rounded p-3 border border-blue-200">
                      <p>{selectedRemittance.recipient_bank_account}</p>
                    </div>
                    {selectedRemittance.recipient_bank_name && (
                      <p className="text-xs sm:text-sm mt-2"><span className="font-medium">{t('remittances.admin.bankName')}</span> {selectedRemittance.recipient_bank_name}</p>
                    )}
                  </div>
                )}

                {/* Delivery Method */}
                <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
                  <p className="text-xs sm:text-sm text-blue-600 font-medium mb-1">{t('remittances.admin.deliveryMethodLabel')}</p>
                  <p className="text-base sm:text-lg font-semibold text-blue-900">
                    {selectedRemittance.delivery_method === 'cash' ? t('remittances.admin.cash')
                      : selectedRemittance.delivery_method === 'transfer' ? t('remittances.admin.transfer')
                      : selectedRemittance.delivery_method === 'card' ? t('remittances.admin.card')
                      : selectedRemittance.delivery_method}
                  </p>
                </div>

                {/* Payment Reference */}
                {selectedRemittance.payment_reference && (
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 font-medium mb-2">{t('remittances.admin.paymentReferenceLabel')}</p>
                    <p className="font-mono bg-gray-50 p-3 rounded-lg text-xs sm:text-sm">{selectedRemittance.payment_reference}</p>
                  </div>
                )}

                {/* Notes */}
                {selectedRemittance.notes && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">{t('remittances.admin.notesLabel')}</h3>
                    <p className="text-xs sm:text-sm text-gray-700 bg-gray-50 rounded-lg p-3 sm:p-4">{selectedRemittance.notes}</p>
                  </div>
                )}
              </div>

              {/* Right Column - Payment Proof and Delivery Proof */}
              <div className="lg:col-span-1 space-y-4">
                {/* Payment Proof */}
                {selectedRemittance.payment_proof_url ? (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2 text-sm sm:text-base">
                      <FileText className="h-4 w-4" />
                      {t('remittances.admin.paymentProofSection')}
                    </h4>
                    {proofSignedUrl ? (
                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-2">
                        <img
                          src={proofSignedUrl}
                          alt={t('remittances.user.paymentProofAlt')}
                          className="w-full h-auto rounded-lg max-h-[400px] object-contain"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div className="hidden flex-col items-center justify-center p-4 text-gray-500">
                          <FileText className="w-8 h-8 mb-2" />
                          <p className="text-xs text-center">{t('remittances.user.imageLoadError')}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center p-4 border-2 border-gray-200 rounded-lg bg-gray-50">
                        <Clock className="w-6 h-6 text-gray-400 animate-spin" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-yellow-800 font-medium">
                      {t('remittances.admin.noPaymentProof')}
                    </p>
                  </div>
                )}

                {/* Delivery Proof */}
                {selectedRemittance.status === REMITTANCE_STATUS.DELIVERED || selectedRemittance.status === REMITTANCE_STATUS.COMPLETED ? (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2 text-sm sm:text-base">
                      <Truck className="h-4 w-4" />
                      {t('remittances.admin.deliveryProofSection')}
                    </h4>
                    {selectedRemittance.delivery_proof_url ? (
                      <>
                        {deliveryProofSignedUrl ? (
                          <div className="bg-gray-50 rounded-lg border border-green-200 p-2">
                            <img
                              src={deliveryProofSignedUrl}
                              alt="Evidencia de entrega"
                              className="w-full h-auto rounded-lg max-h-[400px] object-contain"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                            <div className="hidden flex-col items-center justify-center p-4 text-gray-500">
                              <FileText className="w-8 h-8 mb-2" />
                              <p className="text-xs text-center">No se pudo cargar la imagen</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center p-4 border-2 border-green-200 rounded-lg bg-gray-50">
                            <Clock className="w-6 h-6 text-green-400 animate-spin" />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <p className="text-sm text-green-800 font-medium">
                          Evidencia de entrega pendiente
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
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

      {/* Payment Proof Modal */}
      <ImageProofModal
        isOpen={showPaymentProofModal}
        onClose={() => setShowPaymentProofModal(false)}
        proofUrl={selectedProofUrl}
        title={t('remittances.user.paymentProof')}
        bucketName="remittance-proofs"
      />
    </div>
  );
};

export default AdminRemittancesTab;
