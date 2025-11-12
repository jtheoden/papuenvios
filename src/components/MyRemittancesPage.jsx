import React, { useState, useEffect } from 'react';
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
  const [proofSignedUrl, setProofSignedUrl] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadData, setUploadData] = useState({
    file: null,
    reference: '',
    notes: ''
  });

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

  const handleUploadProof = (remittance) => {
    setSelectedRemittance(remittance);
    setShowUploadModal(true);
    // Auto-populate reference with remittance number for user convenience
    setUploadData({
      file: null,
      reference: remittance.remittance_number, // Auto-load remittance ID
      notes: ''
    });
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
                <div className="grid md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Enviado</p>
                    <p className="text-lg font-bold text-blue-600">
                      {remittance.amount_sent} {remittance.currency_sent}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">A Entregar</p>
                    <p className="text-lg font-bold text-green-600">
                      {remittance.amount_to_deliver?.toFixed(2)} {remittance.currency_delivered}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Destinatario</p>
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
            className="bg-white rounded-2xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold gradient-text mb-4">
              Subir Comprobante de Pago
            </h2>

            <form onSubmit={handleSubmitProof} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Remesa
                </label>
                <p className="font-semibold">{selectedRemittance.remittance_number}</p>
                <p className="text-sm text-gray-600">
                  {selectedRemittance.amount_sent} {selectedRemittance.currency_sent}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Comprobante de pago *
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setUploadData({ ...uploadData, file: e.target.files[0] })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
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

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
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
            className="bg-white rounded-2xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold gradient-text mb-6">
              Detalles de Remesa
            </h2>

            {/* Layout 2 columnas: Info izquierda, Comprobante derecha */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Columna Izquierda - Información */}
              <div className="space-y-4">
                {/* Datos Básicos */}
                <div className="grid grid-cols-2 gap-4">
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

                {/* Destinatario */}
                <div className="pt-4 border-t">
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Destinatario
                  </h3>
                  <div className="space-y-2 bg-gray-50 p-4 rounded-lg">
                    <p><span className="text-gray-600">Nombre:</span> <span className="font-medium">{selectedRemittance.recipient_name}</span></p>
                    <p><span className="text-gray-600">Teléfono:</span> <span className="font-medium">{selectedRemittance.recipient_phone}</span></p>
                    {selectedRemittance.recipient_city && (
                      <p><span className="text-gray-600">Ciudad:</span> <span className="font-medium">{selectedRemittance.recipient_city}</span></p>
                    )}
                    {selectedRemittance.recipient_address && (
                      <p><span className="text-gray-600">Dirección:</span> <span className="font-medium">{selectedRemittance.recipient_address}</span></p>
                    )}
                  </div>
                </div>

                {/* Montos */}
                <div className="pt-4 border-t">
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Montos
                  </h3>
                  <div className="space-y-2 bg-gray-50 p-4 rounded-lg">
                    <p><span className="text-gray-600">Monto enviado:</span> <span className="font-medium">${selectedRemittance.amount_sent}</span></p>
                    <p><span className="text-gray-600">Monto a entregar:</span> <span className="font-bold text-green-600">${selectedRemittance.amount_to_deliver} {selectedRemittance.currency_delivered}</span></p>
                  </div>
                </div>
              </div>

              {/* Columna Derecha - Comprobante de Pago */}
              <div className="space-y-4">
                {selectedRemittance.payment_proof_url ? (
                  <div>
                    <h3 className="font-bold mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Comprobante de Pago
                    </h3>
                    {proofSignedUrl ? (
                      <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                        <img
                          src={proofSignedUrl}
                          alt="Comprobante de pago"
                          className="w-full h-auto max-h-[500px] object-contain"
                          onError={(e) => {
                            // Si la imagen no carga, mostrar fallback
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div className="hidden flex-col items-center justify-center p-8 text-gray-500">
                          <FileText className="w-16 h-16 mb-4" />
                          <p className="text-sm text-center">No se pudo cargar la imagen</p>
                          <a
                            href={proofSignedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-4 text-blue-600 hover:underline text-sm"
                          >
                            Abrir en nueva pestaña
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center p-8 border-2 border-gray-200 rounded-lg bg-gray-50">
                        <div className="text-center text-gray-500">
                          <Clock className="w-12 h-12 mx-auto mb-2 animate-spin" />
                          <p className="text-sm">Cargando comprobante...</p>
                        </div>
                      </div>
                    )}
                    {selectedRemittance.payment_reference && (
                      <div className="mt-3 bg-blue-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Referencia:</p>
                        <p className="font-semibold text-blue-900">{selectedRemittance.payment_reference}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-12 bg-yellow-50 border-2 border-yellow-200 border-dashed rounded-lg">
                    <AlertCircle className="w-12 h-12 text-yellow-600 mb-4" />
                    <p className="text-sm font-medium text-yellow-800 text-center">
                      Comprobante de pago pendiente
                    </p>
                    <p className="text-xs text-yellow-700 text-center mt-2">
                      El comprobante aún no ha sido enviado
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Botón Cerrar */}
            <div className="mt-6 pt-6 border-t">
              <button
                onClick={() => setSelectedRemittance(null)}
                className="w-full py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default MyRemittancesPage;
