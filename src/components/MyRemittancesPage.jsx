import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, DollarSign, User, FileText, AlertCircle, CheckCircle,
  Clock, XCircle, Upload, Eye, Package, Truck, RefreshCw, X
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import SEO from '@/components/SEO';
import {
  getMyRemittances,
  getRemittanceDetails,
  uploadPaymentProof,
  cancelRemittance,
  calculateDeliveryAlert,
  generateProofSignedUrl,
  REMITTANCE_STATUS
} from '@/lib/remittanceService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import { useModal } from '@/contexts/ModalContext';

const MyRemittancesPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { showModal } = useModal();

  const [remittances, setRemittances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRemittance, setSelectedRemittance] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
  const [proofImageUrl, setProofImageUrl] = useState(null);
  const [proofImageLoading, setProofImageLoading] = useState(false);
  const [uploadData, setUploadData] = useState({
    file: null,
    reference: '',
    notes: ''
  });
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    loadRemittances();
  }, []);

  const loadRemittances = async () => {
    setLoading(true);
    const result = await getMyRemittances({});
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

  const handleViewDetails = async (remittance) => {
    const result = await getRemittanceDetails(remittance.id);
    if (result.success) {
      setSelectedRemittance(result.remittance);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const handleUploadProof = (remittance) => {
    setSelectedRemittance(remittance);
    setShowUploadModal(true);
    setUploadData({ file: null, reference: '', notes: '' });
    setPreviewUrl(null);
  };

  const handleViewProof = async (remittance) => {
    setSelectedRemittance(remittance);
    setShowProofModal(true);
    setProofImageLoading(true);

    const proofPath = remittance.payment_proof_url;

    // Check if it's already a URL (old format)
    if (proofPath.startsWith('http://') || proofPath.startsWith('https://')) {
      setProofImageUrl(proofPath);
      setProofImageLoading(false);
    } else {
      // It's a file path, generate a signed URL
      const result = await generateProofSignedUrl(proofPath);

      if (result.success) {
        setProofImageUrl(result.signedUrl);
      } else {
        console.error('Failed to generate signed URL:', result.error);
        toast({
          title: t('common.error'),
          description: 'No se pudo cargar el comprobante',
          variant: 'destructive'
        });
        setProofImageUrl(null);
      }
      setProofImageLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: t('common.error'),
        description: 'Solo se permiten imágenes',
        variant: 'destructive'
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t('common.error'),
        description: 'El archivo no puede superar 5MB',
        variant: 'destructive'
      });
      return;
    }

    setUploadData({ ...uploadData, file });

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result);
    };
    reader.readAsDataURL(file);
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

    const result = await uploadPaymentProof(
      selectedRemittance.id,
      uploadData.file,
      uploadData.reference,
      uploadData.notes
    );

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.user.proofUploaded')
      });
      setShowUploadModal(false);
      loadRemittances();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
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

    const result = await cancelRemittance(remittance.id, reason || '');

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.user.remittanceCancelled')
      });
      loadRemittances();
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
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
      <SEO
        titleKey="seo.myRemittances.title"
        descriptionKey="seo.myRemittances.description"
        path="/my-remittances"
        type="website"
        keywords={['mis remesas', 'my remittances', 'track remittances', 'estado remesa']}
      />
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className={`${getHeadingStyle()} text-3xl mb-2`}>
            Mis Remesas
          </h1>
          <p className="text-gray-600">
            Consulte el estado de sus envíos de dinero
          </p>
        </div>
        <button
          onClick={() => onNavigate && onNavigate('sendRemittance')}
          className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
        >
          <DollarSign className="h-5 w-5" />
          Nueva Remesa
        </button>
      </div>

      {remittances.length === 0 ? (
        <div className="text-center py-12 glass-effect rounded-xl">
          <DollarSign className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-700 mb-2">
            No tiene remesas registradas
          </h3>
          <p className="text-gray-600 mb-6">
            Envíe su primera remesa de forma rápida y segura
          </p>
          <button
            onClick={() => onNavigate && onNavigate('sendRemittance')}
            className={`${getPrimaryButtonStyle()} inline-flex items-center gap-2`}
          >
            <DollarSign className="h-5 w-5" />
            Enviar Remesa
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {remittances.map((remittance) => {
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
                <div className="grid md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Enviado</p>
                    <p className="text-lg font-bold text-blue-600">
                      {remittance.amount} {remittance.currency}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">A Entregar</p>
                    <p className="text-lg font-bold text-green-600">
                      {remittance.amount_to_deliver?.toFixed(2)} {remittance.delivery_currency}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Destinatario</p>
                    <p className="font-semibold">{remittance.recipient_name}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Ciudad</p>
                    <p className="font-semibold">{remittance.recipient_city || 'N/A'}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Método de Entrega</p>
                    <p className="font-semibold capitalize">
                      {remittance.delivery_method === 'cash' ? 'Efectivo' :
                       remittance.delivery_method === 'transfer' ? 'Transferencia' :
                       remittance.delivery_method === 'card' ? 'Tarjeta' :
                       remittance.delivery_method === 'pickup' ? 'Recogida' :
                       remittance.delivery_method || 'N/A'}
                    </p>
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
                          Razón del rechazo:
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
                      {new Date(remittance.created_at).toLocaleDateString('es-CU')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDetails(remittance)}
                      className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                    >
                      <Eye className="h-4 w-4" />
                      Ver Detalles
                    </button>

                    {remittance.payment_proof_url && (
                      <button
                        onClick={() => handleViewProof(remittance)}
                        className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                      >
                        <FileText className="h-4 w-4" />
                        Ver Comprobante
                      </button>
                    )}

                    {remittance.status === REMITTANCE_STATUS.PAYMENT_PENDING && (
                      <>
                        <button
                          onClick={() => handleUploadProof(remittance)}
                          className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                        >
                          <Upload className="h-4 w-4" />
                          Subir Comprobante
                        </button>
                        <button
                          onClick={() => handleCancel(remittance)}
                          className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                        >
                          <XCircle className="h-4 w-4" />
                          Cancelar
                        </button>
                      </>
                    )}

                    {remittance.status === REMITTANCE_STATUS.PAYMENT_REJECTED && (
                      <button
                        onClick={() => handleUploadProof(remittance)}
                        className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Reenviar Comprobante
                      </button>
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
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowUploadModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`bg-white rounded-2xl p-6 w-full ${previewUrl ? 'max-w-4xl' : 'max-w-md'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold gradient-text mb-4">
              Subir Comprobante de Pago
            </h2>

            <form onSubmit={handleSubmitProof}>
              <div className={`${previewUrl ? 'grid grid-cols-2 gap-6' : 'space-y-4'}`}>
                {/* Columna Izquierda: Formulario */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Remesa
                    </label>
                    <p className="font-semibold">{selectedRemittance.remittance_number}</p>
                    <p className="text-sm text-gray-600">
                      {selectedRemittance.amount} {selectedRemittance.currency}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Comprobante de pago *
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                    {!previewUrl && (
                      <p className="text-xs text-gray-500 mt-1">
                        Formatos: JPG, PNG. Máximo 5MB
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Referencia de pago *
                    </label>
                    <input
                      type="text"
                      value={uploadData.reference}
                      onChange={(e) => setUploadData({ ...uploadData, reference: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ej: ZELLE123456"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notas adicionales
                    </label>
                    <textarea
                      value={uploadData.notes}
                      onChange={(e) => setUploadData({ ...uploadData, notes: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows="3"
                      placeholder="Detalles adicionales..."
                    />
                  </div>
                </div>

                {/* Columna Derecha: Preview */}
                {previewUrl && (
                  <div className="flex flex-col">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Vista Previa
                    </label>
                    <div className="relative flex-1 min-h-[300px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 overflow-hidden">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-full h-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewUrl(null);
                          setUploadData({ ...uploadData, file: null });
                        }}
                        className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Botones */}
              <div className="flex gap-3 pt-6 mt-6 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false);
                    setPreviewUrl(null);
                    setUploadData({ file: null, reference: '', notes: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className={`flex-1 ${getPrimaryButtonStyle()}`}
                >
                  Enviar
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
            className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold gradient-text mb-6">
              Detalles de Remesa
            </h2>

            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Número</p>
                  <p className="font-semibold">{selectedRemittance.remittance_number}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Estado</p>
                  <p className="font-semibold">{getStatusLabel(selectedRemittance.status)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Tipo</p>
                  <p className="font-semibold">{selectedRemittance.remittance_types?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Método de Entrega</p>
                  <p className="font-semibold capitalize">{selectedRemittance.delivery_method}</p>
                </div>
              </div>

              <div className="pt-4 border-t">
                <h3 className="font-bold mb-3">Destinatario</h3>
                <div className="space-y-2">
                  <p><span className="text-gray-600">Nombre:</span> {selectedRemittance.recipient_name}</p>
                  <p><span className="text-gray-600">Teléfono:</span> {selectedRemittance.recipient_phone}</p>
                  {selectedRemittance.recipient_city && (
                    <p><span className="text-gray-600">Ciudad:</span> {selectedRemittance.recipient_city}</p>
                  )}
                  {selectedRemittance.recipient_address && (
                    <p><span className="text-gray-600">Dirección:</span> {selectedRemittance.recipient_address}</p>
                  )}
                </div>
              </div>

              {selectedRemittance.payment_proof_url && (
                <div className="pt-4 border-t">
                  <h3 className="font-bold mb-3">Comprobante de Pago</h3>
                  <a
                    href={selectedRemittance.payment_proof_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-blue-600 hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    Ver Comprobante
                  </a>
                </div>
              )}

              <div className="pt-4 border-t">
                <button
                  onClick={() => setSelectedRemittance(null)}
                  className="w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Payment Proof Modal */}
      {showProofModal && selectedRemittance?.payment_proof_url && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowProofModal(false)}
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
                onClick={() => setShowProofModal(false)}
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
                      href={proofImageUrl || selectedRemittance.payment_proof_url}
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
                        <p className="text-gray-600">No se pudo cargar el comprobante</p>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">{t('remittances.user.viewProof')}</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default MyRemittancesPage;
