import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, Eye, CheckCircle, XCircle, Clock, Package, Truck,
  AlertTriangle, Download, FileText, Image as ImageIcon, Calendar
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
  generateProofSignedUrl,
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
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [proofImageUrl, setProofImageUrl] = useState(null);
  const [proofImageLoading, setProofImageLoading] = useState(false);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryForm, setDeliveryForm] = useState({
    notes: '',
    proofFile: null,
    proofPreview: null
  });

  useEffect(() => {
    loadRemittances();
  }, []);

  useEffect(() => {
    filterRemittances();
  }, [remittances, searchTerm, statusFilter]);

  useEffect(() => {
    const generateSignedUrl = async () => {
      if (proofModalOpen && selectedRemittance?.payment_proof_url) {
        setProofImageLoading(true);

        const proofUrl = selectedRemittance.payment_proof_url;

        // Check if it's already a signed URL (starts with http/https)
        if (proofUrl.startsWith('http://') || proofUrl.startsWith('https://')) {
          // It's already a URL (old format or signed URL), use it directly
          setProofImageUrl(proofUrl);
          setProofImageLoading(false);
        } else {
          // It's a file path, generate a signed URL
          const result = await generateProofSignedUrl(proofUrl);

          if (result.success) {
            setProofImageUrl(result.signedUrl);
          } else {
            console.error('Failed to generate signed URL:', result.error);
            toast({
              title: t('common.error'),
              description: 'No se pudo generar URL para visualizar el comprobante',
              variant: 'destructive'
            });
            setProofImageUrl(null);
          }
          setProofImageLoading(false);
        }
      } else {
        setProofImageUrl(null);
        setProofImageLoading(false);
      }
    };

    generateSignedUrl();
  }, [proofModalOpen, selectedRemittance?.payment_proof_url, t]);

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
    setSelectedRemittance(remittance);
    setDeliveryModalOpen(true);
    setDeliveryForm({ notes: '', proofFile: null, proofPreview: null });
  };

  const handleDeliverySubmit = async () => {
    if (!selectedRemittance) return;

    const result = await confirmDelivery(
      selectedRemittance.id,
      deliveryForm.proofFile,
      deliveryForm.notes || ''
    );

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.admin.deliveryConfirmed')
      });
      loadRemittances();
      setDeliveryModalOpen(false);
      setSelectedRemittance(null);
      setDeliveryForm({ notes: '', proofFile: null, proofPreview: null });
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleProofFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setDeliveryForm(prev => ({ ...prev, proofFile: file }));

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setDeliveryForm(prev => ({ ...prev, proofPreview: event.target.result }));
        };
        reader.readAsDataURL(file);
      } else {
        setDeliveryForm(prev => ({ ...prev, proofPreview: null }));
      }
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRemittance(remittance);
                        setProofModalOpen(true);
                      }}
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      <FileText className="h-4 w-4" />
                      {t('remittances.user.viewProof')}
                    </button>
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

      {/* Payment Proof Modal */}
      <AnimatePresence>
        {proofModalOpen && selectedRemittance?.payment_proof_url && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
            onClick={() => setProofModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">{t('remittances.user.paymentProof')}</h2>
                <button
                  onClick={() => {
                    setProofModalOpen(false);
                    setProofImageUrl(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="bg-gray-50 rounded-xl p-4">
                {selectedRemittance.payment_proof_url ? (
                  selectedRemittance.payment_proof_url.toLowerCase().endsWith('.pdf') ? (
                    <div className="text-center py-8">
                      <FileText className="h-16 w-16 text-blue-600 mx-auto mb-4" />
                      <p className="text-gray-600 mb-4">{t('remittances.wizard.pdfFile')}</p>
                      <a
                        href={selectedRemittance.payment_proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Descargar PDF
                      </a>
                    </div>
                  ) : (
                    <div className="text-center">
                      {proofImageLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                        </div>
                      ) : proofImageUrl ? (
                        <img
                          src={proofImageUrl}
                          alt="Payment proof"
                          className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
                          onError={(e) => {
                            console.error('Error loading proof image:', proofImageUrl);
                            e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="%23f3f4f6" width="400" height="300"/><text x="50%" y="50%" font-family="Arial" font-size="14" fill="%236b7280" text-anchor="middle">Error al cargar imagen</text></svg>';
                          }}
                        />
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-gray-600">No se pudo generar URL para visualizar el comprobante</p>
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="text-center py-12">
                    <ImageIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">{t('remittances.user.viewProof')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delivery Confirmation Modal */}
      <AnimatePresence>
        {deliveryModalOpen && selectedRemittance && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setDeliveryModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">{t('remittances.admin.confirmDelivery')}</h2>
                <button
                  onClick={() => setDeliveryModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Remittance Info Summary */}
                <div className="grid md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                  <div>
                    <p className="text-xs text-gray-500">{t('remittances.user.toDeliver')}</p>
                    <p className="text-xl font-bold">
                      {selectedRemittance.amount_to_deliver?.toFixed(2)} {selectedRemittance.currency_delivered}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('remittances.recipient.fullName')}</p>
                    <p className="font-semibold">{selectedRemittance.recipient_name}</p>
                  </div>
                </div>

                {/* Delivery Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.admin.deliveryNotes')} (opcional)
                  </label>
                  <textarea
                    value={deliveryForm.notes}
                    onChange={(e) => setDeliveryForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder={t('remittances.admin.deliveryNotesPlaceholder')}
                    rows="3"
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Optional Delivery Proof Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.user.paymentProof')} (opcional)
                  </label>
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleProofFileChange}
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {deliveryForm.proofFile && (
                      <p className="text-xs text-green-600">
                        ✓ {deliveryForm.proofFile.name}
                      </p>
                    )}
                    {deliveryForm.proofPreview && (
                      <img
                        src={deliveryForm.proofPreview}
                        alt="Preview"
                        className="w-full h-auto max-h-[200px] object-contain rounded-lg border border-gray-200"
                      />
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                  <button
                    onClick={() => setDeliveryModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleDeliverySubmit}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    <Truck className="h-4 w-4 inline mr-2" />
                    {t('remittances.admin.confirmDelivery')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedRemittance && !proofModalOpen && !deliveryModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedRemittance(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">{t('remittances.admin.viewDetails')}</h2>
                <button
                  onClick={() => setSelectedRemittance(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">{t('common.number')}</p>
                    <p className="font-semibold">{selectedRemittance.remittance_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{t('common.status')}</p>
                    {getStatusBadge(selectedRemittance.status)}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{t('common.type')}</p>
                    <p className="font-semibold">{selectedRemittance.remittance_types?.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{t('common.createdAt')}</p>
                    <p className="font-semibold">
                      {new Date(selectedRemittance.created_at).toLocaleString('es-CU')}
                    </p>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4 pt-4 border-t">
                  <div>
                    <p className="text-xs text-gray-500">{t('remittances.user.amountSent')}</p>
                    <p className="font-semibold">{selectedRemittance.amount_sent} {selectedRemittance.currency_sent}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('remittances.user.toDeliver')}</p>
                    <p className="font-semibold">{selectedRemittance.amount_to_deliver?.toFixed(2)} {selectedRemittance.currency_delivered}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('remittances.user.method')}</p>
                    <p className="font-semibold capitalize">{selectedRemittance.delivery_method}</p>
                  </div>
                </div>

                <div className="pt-4 border-t space-y-4">
                  <div>
                    <button
                      onClick={() => setSelectedRemittance(null)}
                      className="w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      {t('common.close')}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminRemittancesTab;
