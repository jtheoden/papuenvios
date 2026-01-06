import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, DollarSign, User, FileText, AlertCircle, CheckCircle,
  Clock, XCircle, Upload, Eye, Package, Truck, RefreshCw
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMyRemittances,
  getRemittanceDetails,
  uploadPaymentProof,
  cancelRemittance,
  calculateDeliveryAlert,
  generateProofSignedUrl,
  confirmDelivery,
  REMITTANCE_STATUS
} from '@/lib/remittanceService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { useModal } from '@/contexts/ModalContext';
import FileUploadWithPreview from '@/components/FileUploadWithPreview';
import TooltipButton from './TooltipButton';
import { useRealtimeRemittances } from '@/hooks/useRealtimeSubscription';
import SkeletonCard from '@/components/ui/SkeletonCard';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import RemittanceTimeline from '@/components/ui/RemittanceTimeline';

const MyRemittancesPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const { showModal } = useModal();

  const [remittances, setRemittances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRemittance, setSelectedRemittance] = useState(null);
  const [proofSignedUrl, setProofSignedUrl] = useState(null);
  const [deliveryProofSignedUrl, setDeliveryProofSignedUrl] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDeliveryProofModal, setShowDeliveryProofModal] = useState(false);
  const [deliveryProofFile, setDeliveryProofFile] = useState(null);
  const [uploadData, setUploadData] = useState({
    file: null,
    reference: '',
    notes: ''
  });
  const [imagePreview, setImagePreview] = useState(null);
  const [deliveryProofPreview, setDeliveryProofPreview] = useState(null);

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Filtered remittances based on search and status filter
  const filteredRemittances = useMemo(() => {
    let filtered = remittances;

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => {
        if (statusFilter === 'pending') {
          return ['pending', 'proof_uploaded'].includes(r.status);
        }
        if (statusFilter === 'processing') {
          return ['validated', 'processing', 'ready_for_delivery'].includes(r.status);
        }
        if (statusFilter === 'completed') {
          return ['delivered', 'completed'].includes(r.status);
        }
        if (statusFilter === 'rejected') {
          return r.status === 'rejected';
        }
        return true;
      });
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(r =>
        r.remittance_number?.toLowerCase().includes(search) ||
        r.recipient_name?.toLowerCase().includes(search) ||
        r.remittance_types?.name?.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [remittances, statusFilter, searchTerm]);

  const loadRemittances = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMyRemittances({});
      // getMyRemittances returns array directly, not a result object
      if (Array.isArray(result)) {
        setRemittances(result);
      } else {
        // Handle legacy response format if needed
        if (result.success) {
          setRemittances(result.remittances);
        } else {
          throw new Error(result.error || 'Failed to load remittances');
        }
      }
    } catch (error) {
      console.error('Error loading remittances:', error);
      toast({
        title: t('common.error'),
        description: error.message || 'Failed to load remittances',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRemittances();
  }, [loadRemittances]);

  const handleRealtimeRemittance = useCallback(async () => {
    await loadRemittances();

    if (selectedRemittance?.id) {
      try {
        const updated = await getRemittanceDetails(selectedRemittance.id);
        if (updated) {
          setSelectedRemittance(updated);
        }
      } catch (error) {
        console.error('Error refreshing remittance details:', error);
      }
    }
  }, [loadRemittances, selectedRemittance]);

  useEffect(() => {
    if (isAdmin || isSuperAdmin) {
      showModal({
        type: 'info',
        title: t('common.accessDenied'),
        message: t('remittances.admin.adminCannotViewRemittances'),
        confirmText: t('common.ok')
      }).then(() => {
        onNavigate('dashboard');
      });
    }
  }, [isAdmin, isSuperAdmin]);

  useRealtimeRemittances({
    enabled: !!user && !isAdmin && !isSuperAdmin,
    filter: user ? `user_id=eq.${user.id}` : null,
    onUpdate: handleRealtimeRemittance
  });

  const handleViewDetails = async (remittance) => {
    try {
      const result = await getRemittanceDetails(remittance.id);
      // getRemittanceDetails returns the remittance object directly, not wrapped in { success, remittance }
      if (result) {
        setSelectedRemittance(result);
      } else {
        throw new Error('No remittance data returned');
      }
    } catch (error) {
      console.error('Error fetching remittance details:', error);
      toast({
        title: t('common.error'),
        description: error.message || 'Failed to load remittance details',
        variant: 'destructive'
      });
    }
  };

  // Generate signed URL when remittance with payment proof is selected
  useEffect(() => {
    const loadProofSignedUrl = async () => {
      if (selectedRemittance?.payment_proof_url && !showUploadModal) {
        setProofSignedUrl(null); // Reset previous URL
        const result = await generateProofSignedUrl(selectedRemittance.payment_proof_url);
        if (result.success) {
          setProofSignedUrl(result.signedUrl);
        } else {
          console.error('Error generating signed URL:', result.error);
          // Don't show error toast, just log - user can still see other details
        }
      } else {
        setProofSignedUrl(null);
      }
    };

    loadProofSignedUrl();
  }, [selectedRemittance, showUploadModal]);

  // Generate signed URL for delivery proof
  useEffect(() => {
    const loadDeliveryProofUrl = async () => {
      if (selectedRemittance?.delivery_proof_url && !showDeliveryProofModal) {
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
  }, [selectedRemittance?.delivery_proof_url, showDeliveryProofModal]);

  const handleUploadProof = (remittance) => {
    setSelectedRemittance(remittance);
    setShowUploadModal(true);
    // Auto-populate reference with remittance number for user convenience
    setUploadData({
      file: null,
      reference: remittance.remittance_number, // Auto-load remittance ID
      notes: ''
    });
    setImagePreview(null);
  };

  // Handle payment proof file change with preview generation
  const handlePaymentProofChange = (e) => {
    const file = e.target.files[0];
    setUploadData({ ...uploadData, file });

    // Generate preview
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  // Handle delivery proof file change with preview generation
  const handleDeliveryProofChange = (e) => {
    const file = e.target.files[0];
    setDeliveryProofFile(file);

    // Generate preview
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setDeliveryProofPreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setDeliveryProofPreview(null);
    }
  };

  const handleSubmitProof = async (e) => {
    e.preventDefault();

    if (!uploadData.file || !uploadData.reference) {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.requiredFields'),
        variant: 'destructive'
      });
      return;
    }

    try {
      const result = await uploadPaymentProof(
        selectedRemittance.id,
        uploadData.file,
        uploadData.reference,
        uploadData.notes
      );

      toast({
        title: t('common.success'),
        description: t('remittances.user.proofUploaded')
      });
      setShowUploadModal(false);
      setImagePreview(null);
      setUploadData({
        file: null,
        reference: '',
        notes: ''
      });
      await loadRemittances();
      setSelectedRemittance(result);
    } catch (error) {
      console.error('Error uploading payment proof:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.wizard.errorUploadingProof') || t('common.error'),
        variant: 'destructive'
      });
    }
  };

  const handleCancel = async (remittance) => {
    const reason = await showModal({
      title: 'Cancelar Remesa',
      message: `¿Está seguro que desea cancelar la remesa ${remittance.remittance_number}?`,
      input: true,
      inputLabel: 'Razón (opcional)',
      inputPlaceholder: 'Motivo de la cancelación...',
      confirmText: 'Cancelar Remesa',
      cancelText: t('common.back'),
      type: 'danger'
    });

    if (reason === false) return;

    try {
      await cancelRemittance(remittance.id, reason || '');
      toast({
        title: t('common.success'),
        description: t('remittances.user.remittanceCancelled')
      });
      await loadRemittances();
    } catch (error) {
      console.error('Error cancelling remittance:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive'
      });
    }
  };

  const handleUploadDeliveryProof = async () => {
    if (!selectedRemittance || !deliveryProofFile) {
      toast({
        title: t('common.error'),
        description: 'Por favor selecciona una foto de evidencia',
        variant: 'destructive'
      });
      return;
    }

    try {
      const result = await confirmDelivery(selectedRemittance.id, deliveryProofFile);
      toast({
        title: t('common.success'),
        description: 'Evidencia de entrega subida correctamente',
      });
      setDeliveryProofFile(null);
      setDeliveryProofPreview(null);
      setShowDeliveryProofModal(false);
      await loadRemittances();
      setSelectedRemittance(result);
    } catch (error) {
      console.error('Error uploading delivery proof:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const getStatusIcon = (status) => {
    const icons = {
      [REMITTANCE_STATUS.PAYMENT_PENDING]: Clock,
      [REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED]: Upload,
      [REMITTANCE_STATUS.PAYMENT_VALIDATED]: CheckCircle,
      [REMITTANCE_STATUS.PAYMENT_REJECTED]: XCircle,
      [REMITTANCE_STATUS.PROCESSING]: Package,
      [REMITTANCE_STATUS.DELIVERED]: Truck,
      [REMITTANCE_STATUS.COMPLETED]: CheckCircle,
      [REMITTANCE_STATUS.CANCELLED]: XCircle
    };

    return icons[status] || Clock;
  };

  const getStatusColor = (status) => {
    const colors = {
      [REMITTANCE_STATUS.PAYMENT_PENDING]: 'text-gray-600',
      [REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED]: 'text-yellow-600',
      [REMITTANCE_STATUS.PAYMENT_VALIDATED]: 'text-blue-600',
      [REMITTANCE_STATUS.PAYMENT_REJECTED]: 'text-red-600',
      [REMITTANCE_STATUS.PROCESSING]: 'text-purple-600',
      [REMITTANCE_STATUS.DELIVERED]: 'text-green-600',
      [REMITTANCE_STATUS.COMPLETED]: 'text-emerald-600',
      [REMITTANCE_STATUS.CANCELLED]: 'text-gray-500'
    };

    return colors[status] || 'text-gray-600';
  };

  const getStatusLabel = (status) => {
    const labels = {
      [REMITTANCE_STATUS.PAYMENT_PENDING]: t('remittances.status.paymentPending'),
      [REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED]: t('remittances.status.paymentProofUploaded'),
      [REMITTANCE_STATUS.PAYMENT_VALIDATED]: t('remittances.status.paymentValidated'),
      [REMITTANCE_STATUS.PAYMENT_REJECTED]: t('remittances.status.paymentRejected'),
      [REMITTANCE_STATUS.PROCESSING]: t('remittances.status.processing'),
      [REMITTANCE_STATUS.DELIVERED]: t('remittances.status.delivered'),
      [REMITTANCE_STATUS.COMPLETED]: t('remittances.status.completed'),
      [REMITTANCE_STATUS.CANCELLED]: t('remittances.status.cancelled')
    };

    return labels[status] || status;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className={`${getHeadingStyle()} text-3xl mb-2`}>
            {t('remittances.user.myRemittances')}
          </h1>
          <p className="text-gray-600">
            {t('remittances.user.trackRemittances')}
          </p>
        </div>
        <button
          onClick={() => onNavigate && onNavigate('send-remittance')}
          className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
        >
          <DollarSign className="h-5 w-5" />
          {t('remittances.user.newRemittance')}
        </button>
      </div>

      {/* Search and Filter Bar - only show when there are remittances */}
      {!loading && remittances.length > 0 && (
        <SearchFilterBar
          onSearch={setSearchTerm}
          onFilterChange={setStatusFilter}
          activeFilter={statusFilter}
          placeholder={t('remittances.user.searchPlaceholder') || (t('language') === 'es' ? 'Buscar por nombre, referencia...' : 'Search by name, reference...')}
          resultsCount={filteredRemittances.length}
        />
      )}

      {loading ? (
        <div className="space-y-4">
          <SkeletonCard variant="remittance" />
          <SkeletonCard variant="remittance" />
          <SkeletonCard variant="remittance" />
        </div>
      ) : remittances.length === 0 ? (
        <div className="text-center py-12 glass-effect rounded-xl">
          <DollarSign className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-700 mb-2">
            {t('remittances.user.noRemittances')}
          </h3>
          <p className="text-gray-600 mb-6">
            {t('remittances.user.noRemittancesDesc')}
          </p>
          <button
            onClick={() => onNavigate && onNavigate('send-remittance')}
            className={`${getPrimaryButtonStyle()} inline-flex items-center gap-2`}
          >
            <DollarSign className="h-5 w-5" />
            {t('remittances.user.newRemittance')}
          </button>
        </div>
      ) : filteredRemittances.length === 0 ? (
        <div className="text-center py-12 glass-effect rounded-xl">
          <DollarSign className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-600 mb-2">
            {t('remittances.user.noResults') || (t('language') === 'es' ? 'Sin resultados' : 'No results')}
          </h3>
          <p className="text-gray-500">
            {t('remittances.user.noResultsDesc') || (t('language') === 'es' ? 'No se encontraron remesas con los filtros seleccionados' : 'No remittances found with the selected filters')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRemittances.map((remittance) => {
            const StatusIcon = getStatusIcon(remittance.status);
            const alert = calculateDeliveryAlert(remittance);

            return (
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
                    <StatusIcon className={`h-5 w-5 ${getStatusColor(remittance.status)}`} />
                    <span className="text-sm font-medium">
                      {getStatusLabel(remittance.status)}
                    </span>
                  </div>
                </div>

                {/* Amount Display */}
                <div className="grid md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('remittances.user.amountSent')}</p>
                    <p className="text-lg font-bold text-blue-600">
                      {remittance.amount_sent} {remittance.currency_sent}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('remittances.user.toDeliver')}</p>
                    <p className="text-lg font-bold text-green-600">
                      {remittance.amount_to_deliver?.toFixed(2)} {remittance.currency_delivered}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('remittances.recipient.fullName')}</p>
                    <p className="font-semibold">{remittance.recipient_name}</p>
                  </div>
                </div>

                {/* Time Alert */}
                {[REMITTANCE_STATUS.PAYMENT_VALIDATED, REMITTANCE_STATUS.PROCESSING].includes(remittance.status) && (
                  <div className="mb-4">
                    <div className={`p-3 rounded-lg ${
                      alert.level === 'error' ? 'bg-red-50 border border-red-200' :
                      alert.level === 'warning' ? 'bg-yellow-50 border border-yellow-200' :
                      'bg-blue-50 border border-blue-200'
                    }`}>
                      <div className="flex items-center gap-2">
                        <Clock className={`h-4 w-4 ${
                          alert.level === 'error' ? 'text-red-600' :
                          alert.level === 'warning' ? 'text-yellow-600' :
                          'text-blue-600'
                        }`} />
                        <span className={`text-sm font-medium ${
                          alert.level === 'error' ? 'text-red-800' :
                          alert.level === 'warning' ? 'text-yellow-800' :
                          'text-blue-800'
                        }`}>
                          {alert.message}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Rejection Reason */}
                {remittance.status === REMITTANCE_STATUS.PAYMENT_REJECTED && remittance.payment_rejection_reason && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-red-800 mb-1">
                          {t('remittances.admin.rejectReason')}:
                        </p>
                        <p className="text-sm text-red-700">
                          {remittance.payment_rejection_reason}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {new Date(remittance.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <TooltipButton
                      tooltipText={t('remittances.user.viewDetails')}
                      onClick={() => handleViewDetails(remittance)}
                      className="flex items-center gap-1 px-2 sm:px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                      title={t('remittances.user.viewDetails')}
                    >
                      <Eye className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('remittances.user.viewDetails')}</span>
                    </TooltipButton>

                    {remittance.status === REMITTANCE_STATUS.PAYMENT_PENDING && (
                      <>
                        <TooltipButton
                          tooltipText={t('remittances.user.uploadProof')}
                          onClick={() => handleUploadProof(remittance)}
                          className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                          title={t('remittances.user.uploadProof')}
                        >
                          <Upload className="h-4 w-4" />
                          <span className="hidden sm:inline">{t('remittances.user.uploadProof')}</span>
                        </TooltipButton>
                        <TooltipButton
                          tooltipText={t('common.cancel')}
                          onClick={() => handleCancel(remittance)}
                          className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                          title={t('common.cancel')}
                        >
                          <XCircle className="h-4 w-4" />
                          <span className="hidden sm:inline">{t('common.cancel')}</span>
                        </TooltipButton>
                      </>
                    )}

                    {remittance.status === REMITTANCE_STATUS.PAYMENT_REJECTED && (
                      <TooltipButton
                        tooltipText={t('remittances.user.reUploadProof')}
                        onClick={() => handleUploadProof(remittance)}
                        className="flex items-center gap-1 px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                        title={t('remittances.user.reUploadProof')}
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('remittances.user.reUploadProof')}</span>
                      </TooltipButton>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Upload Proof Modal */}
      {showUploadModal && selectedRemittance && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 p-4 sm:p-6 overflow-y-auto"
          onClick={() => setShowUploadModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl sm:text-2xl font-bold gradient-text mb-4">
              {t('remittances.user.uploadProofTitle')}
            </h2>

            <form onSubmit={handleSubmitProof} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                  {t('remittances.user.remittanceLabel')}
                </label>
                <p className="font-semibold">{selectedRemittance.remittance_number}</p>
                <p className="text-xs sm:text-sm text-gray-600">
                  {selectedRemittance.amount_sent} {selectedRemittance.currency_sent}
                </p>
              </div>

              <FileUploadWithPreview
                label={t('remittances.user.paymentProofLabel')}
                accept="image/*,.pdf"
                value={uploadData.file}
                preview={imagePreview}
                onChange={handlePaymentProofChange}
                previewPosition="above"
              />

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                  {t('remittances.user.paymentReferenceLabel')}
                </label>
                <input
                  type="text"
                  value={uploadData.reference}
                  onChange={(e) => setUploadData({ ...uploadData, reference: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder={t('remittances.user.referenceExample')}
                  required
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                  {t('remittances.user.additionalNotesLabel')}
                </label>
                <textarea
                  value={uploadData.notes}
                  onChange={(e) => setUploadData({ ...uploadData, notes: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  rows="3"
                  placeholder={t('remittances.user.additionalDetailsPlaceholder')}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false);
                    setImagePreview(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className={`flex-1 ${getPrimaryButtonStyle()} text-sm`}
                >
                  {t('remittances.user.send')}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Details Modal */}
      {selectedRemittance && !showUploadModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedRemittance(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-4 sm:p-6 max-w-4xl sm:max-w-5xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl sm:text-2xl font-bold gradient-text mb-6">
              {t('remittances.user.detailsTitle')}
            </h2>

            {/* Layout 2 columnas: Info izquierda, Comprobante derecha */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Columna Izquierda - Información */}
              <div className="space-y-4">
                {/* Datos Básicos */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs sm:text-sm text-gray-500">{t('remittances.user.number')}</p>
                    <p className="font-semibold text-sm sm:text-base">{selectedRemittance.remittance_number}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-500">{t('common.status')}</p>
                    <p className="font-semibold text-sm sm:text-base">{getStatusLabel(selectedRemittance.status)}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-500">{t('remittances.user.type')}</p>
                    <p className="font-semibold text-sm sm:text-base">{selectedRemittance.remittance_types?.name}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-500">{t('remittances.user.deliveryMethod')}</p>
                    <p className="font-semibold capitalize text-sm sm:text-base">{selectedRemittance.delivery_method}</p>
                  </div>
                </div>

                {/* Destinatario */}
                <div className="pt-4 border-t">
                  <h3 className="font-bold mb-3 flex items-center gap-2 text-sm sm:text-base">
                    <User className="w-4 h-4" />
                    {t('remittances.user.recipient')}
                  </h3>
                  <div className="space-y-2 bg-gray-50 p-3 sm:p-4 rounded-lg text-xs sm:text-sm">
                    <p><span className="text-gray-600">{t('remittances.user.recipientName')}</span> <span className="font-medium">{selectedRemittance.recipient_name}</span></p>
                    <p><span className="text-gray-600">{t('remittances.user.recipientPhone')}</span> <span className="font-medium">{selectedRemittance.recipient_phone}</span></p>
                    {selectedRemittance.recipient_city && (
                      <p><span className="font-medium">{t('remittances.user.recipientCity')}</span> {selectedRemittance.recipient_city}{selectedRemittance.recipient_province && `, ${selectedRemittance.recipient_province}`}{selectedRemittance.recipient_municipality && `, ${selectedRemittance.recipient_municipality}`}</p>
                    )}
                    {selectedRemittance.recipient_address && (
                      <p><span className="text-gray-600">{t('remittances.user.recipientAddress')}</span> <span className="font-medium">{selectedRemittance.recipient_address}</span></p>
                    )}
                  </div>
                </div>

                {/* Montos */}
                <div className="pt-4 border-t">
                  <h3 className="font-bold mb-3 flex items-center gap-2 text-sm sm:text-base">
                    <DollarSign className="w-4 h-4" />
                    {t('remittances.user.amounts')}
                  </h3>
                  <div className="space-y-2 bg-gray-50 p-3 sm:p-4 rounded-lg text-xs sm:text-sm">
                    <p><span className="text-gray-600">{t('remittances.user.amountSentLabel')}</span> <span className="font-medium">${selectedRemittance.amount_sent}</span></p>
                    <p><span className="text-gray-600">{t('remittances.user.amountToDeliverLabel')}</span> <span className="font-bold text-green-600">${selectedRemittance.amount_to_deliver} {selectedRemittance.currency_delivered}</span></p>
                  </div>
                </div>

                {/* Timeline de Progreso */}
                <div className="pt-4 border-t">
                  <RemittanceTimeline
                    currentStatus={selectedRemittance.status}
                    rejectionReason={selectedRemittance.rejection_reason}
                    statusHistory={selectedRemittance.status_history}
                    compact={false}
                  />
                </div>
              </div>

              {/* Columna Derecha - Comprobante de Pago */}
              <div className="space-y-4">
                {selectedRemittance.payment_proof_url ? (
                  <div>
                    <h3 className="font-bold mb-3 flex items-center gap-2 text-sm sm:text-base">
                      <FileText className="w-4 h-4" />
                      {t('remittances.user.paymentProofSection')}
                    </h3>
                    {proofSignedUrl ? (
                      <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                        <img
                          src={proofSignedUrl}
                          alt={t('remittances.user.paymentProofAlt')}
                          className="w-full h-auto max-h-[500px] object-contain"
                          onError={(e) => {
                            // Si la imagen no carga, mostrar fallback
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div className="hidden flex-col items-center justify-center p-8 text-gray-500">
                          <FileText className="w-16 h-16 mb-4" />
                          <p className="text-xs sm:text-sm text-center">{t('remittances.user.imageLoadError')}</p>
                          <a
                            href={proofSignedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-4 text-blue-600 hover:underline text-xs sm:text-sm"
                          >
                            {t('remittances.user.openInNewTab')}
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center p-8 border-2 border-gray-200 rounded-lg bg-gray-50">
                        <div className="text-center text-gray-500">
                          <Clock className="w-12 h-12 mx-auto mb-2 animate-spin" />
                          <p className="text-xs sm:text-sm">{t('remittances.user.deliveryEvidenceLoading')}</p>
                        </div>
                      </div>
                    )}
                    {selectedRemittance.payment_reference && (
                      <div className="mt-3 bg-blue-50 p-3 rounded-lg">
                        <p className="text-xs sm:text-sm text-gray-600">{t('remittances.user.referenceLabel')}</p>
                        <p className="font-semibold text-blue-900 text-sm">{selectedRemittance.payment_reference}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 sm:p-12 bg-yellow-50 border-2 border-yellow-200 border-dashed rounded-lg">
                    <AlertCircle className="w-12 h-12 text-yellow-600 mb-4" />
                    <p className="text-xs sm:text-sm font-medium text-yellow-800 text-center">
                      {t('remittances.user.proofPending')}
                    </p>
                    <p className="text-xs text-yellow-700 text-center mt-2">
                      {t('remittances.user.proofNotSent')}
                    </p>
                  </div>
                )}

                {/* Delivery Proof Section */}
                {[REMITTANCE_STATUS.DELIVERED, REMITTANCE_STATUS.COMPLETED].includes(selectedRemittance.status) ? (
                  <div>
                    <h3 className="font-bold mb-3 flex items-center gap-2 text-sm sm:text-base">
                      <Truck className="w-4 h-4" />
                      {t('remittances.user.deliveryEvidenceTitle')}
                    </h3>
                    {selectedRemittance.delivery_proof_url ? (
                      <>
                        {deliveryProofSignedUrl ? (
                          <div className="border-2 border-green-200 rounded-lg overflow-hidden bg-gray-50">
                            <img
                              src={deliveryProofSignedUrl}
                              alt={t('remittances.user.deliveryEvidenceTitle')}
                              className="w-full h-auto max-h-[500px] object-contain"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                            <div className="hidden flex-col items-center justify-center p-8 text-gray-500">
                              <FileText className="w-16 h-16 mb-4" />
                              <p className="text-xs sm:text-sm text-center">{t('remittances.user.imageLoadError')}</p>
                              <a
                                href={deliveryProofSignedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-4 text-blue-600 hover:underline text-xs sm:text-sm"
                              >
                                {t('remittances.user.openInNewTab')}
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center p-8 border-2 border-green-200 rounded-lg bg-gray-50">
                            <div className="text-center text-gray-500">
                              <Clock className="w-12 h-12 mx-auto mb-2 animate-spin" />
                              <p className="text-xs sm:text-sm">{t('remittances.user.deliveryEvidenceLoading')}</p>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 sm:p-12 bg-green-50 border-2 border-green-200 border-dashed rounded-lg">
                        <Truck className="w-12 h-12 text-green-600 mb-4" />
                        <p className="text-xs sm:text-sm font-medium text-green-800 text-center">
                          {t('remittances.user.deliveryEvidencePending')}
                        </p>
                        <p className="text-xs text-green-700 text-center mt-2">
                          {t('remittances.user.uploadDeliveryProof')}
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Botones de Acción */}
            <div className="mt-6 pt-6 border-t space-y-3">
              {/* Upload Delivery Proof Button - Only show if delivered and no proof yet */}
              {selectedRemittance.status === REMITTANCE_STATUS.DELIVERED && !selectedRemittance.delivery_proof_url && (
                <button
                  onClick={() => setShowDeliveryProofModal(true)}
                  className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2 text-sm"
                >
                  <Upload className="h-4 w-4" />
                  {t('remittances.user.uploadDeliveryProofButton')}
                </button>
              )}

              <button
                onClick={() => setSelectedRemittance(null)}
                className="w-full py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
              >
                {t('remittances.user.closeButton')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delivery Proof Upload Modal */}
      {showDeliveryProofModal && selectedRemittance && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 p-4 sm:p-6 overflow-y-auto"
          onClick={() => setShowDeliveryProofModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl sm:text-2xl font-bold gradient-text mb-4">
              {t('remittances.user.uploadDeliveryProofTitle')}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                  {t('remittances.user.remittanceLabel')}
                </label>
                <p className="font-semibold">{selectedRemittance.remittance_number}</p>
                <p className="text-xs sm:text-sm text-gray-600">
                  {selectedRemittance.amount_to_deliver} {selectedRemittance.currency_delivered}
                </p>
              </div>

              <FileUploadWithPreview
                label={t('remittances.user.deliveryPhotoLabel')}
                accept="image/*"
                value={deliveryProofFile}
                preview={deliveryProofPreview}
                onChange={handleDeliveryProofChange}
                previewPosition="above"
              />

              <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                <p className="text-xs text-green-800">
                  {t('remittances.user.deliveryPhotoTip')}
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeliveryProofModal(false);
                    setDeliveryProofFile(null);
                    setDeliveryProofPreview(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleUploadDeliveryProof}
                  className={`flex-1 ${getPrimaryButtonStyle()} flex items-center justify-center gap-2 text-sm`}
                >
                  <Upload className="h-4 w-4" />
                  {t('remittances.user.send')}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default MyRemittancesPage;
