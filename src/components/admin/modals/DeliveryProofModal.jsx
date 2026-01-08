import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Image as ImageIcon, Camera, RefreshCw } from 'lucide-react';

/**
 * Delivery Proof Modal Component
 * Allows uploading and previewing delivery proof images for orders
 * Fully accessible with ARIA attributes and keyboard navigation support
 */
const DeliveryProofModal = ({ order, onClose, onFileChange, onSubmit, preview, loading, t }) => {
  const modalRef = useRef(null);
  const fileInputRef = useRef(null);
  const titleId = `delivery-proof-modal-title-${order.id}`;

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, loading]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="presentation"
      onClick={(e) => {
        // Close modal when clicking outside (on the backdrop)
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading}
      >
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <h3
            id={titleId}
            className="text-xl font-bold text-gray-900"
          >
            📸 {t('adminOrders.deliveryModal.title')}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1"
            disabled={loading}
            aria-label="Cerrar modal de comprobante de entrega"
            title="Presione Escape para cerrar"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900">
              <strong>{t('adminOrders.deliveryModal.orderLabel')}</strong> {order.order_number}
            </p>
            <p className="text-sm text-blue-900">
              <strong>{t('adminOrders.deliveryModal.customerLabel')}</strong> {order.user_name}
            </p>
          </div>

          <div>
            <label
              htmlFor="delivery-proof-input"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              {t('adminOrders.deliveryModal.selectPhoto')}
            </label>
            <div className="flex items-center justify-center w-full">
              <label
                htmlFor="delivery-proof-input"
                className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2"
                role="region"
                aria-label="Área de carga de archivo"
              >
                {preview ? (
                  <img
                    src={preview}
                    alt="Vista previa del comprobante de entrega"
                    className="max-h-44 rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <ImageIcon className="h-12 w-12 text-gray-400 mb-3" aria-hidden="true" />
                    <p className="mb-2 text-sm text-gray-500">
                      <span className="font-semibold">{t('adminOrders.deliveryModal.clickToUpload')}</span> {t('adminOrders.deliveryModal.dragHere')}
                    </p>
                    <p className="text-xs text-gray-500">{t('adminOrders.deliveryModal.fileTypes')}</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  id="delivery-proof-input"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={onFileChange}
                  disabled={loading}
                  aria-label="Seleccionar archivo de imagen para comprobante de entrega"
                  aria-describedby="file-help-text"
                />
              </label>
            </div>
            <p id="file-help-text" className="text-xs text-gray-500 mt-2">
              {t('adminOrders.deliveryModal.fileTypes')}
            </p>
          </div>

          {preview && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-700">
                ✅ {t('adminOrders.deliveryModal.imageLoaded')}
              </p>
            </div>
          )}

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-xs text-yellow-800">
              <strong>{t('adminOrders.deliveryModal.note')}</strong> {t('adminOrders.deliveryModal.noteText')}
            </p>
          </div>
        </div>

        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Cancelar carga de comprobante de entrega"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onSubmit}
            disabled={loading || !preview}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            aria-label={loading ? 'Cargando comprobante de entrega' : 'Enviar comprobante de entrega'}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('adminOrders.deliveryModal.uploading')}
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" aria-hidden="true" />
                {t('adminOrders.deliveryModal.submit')}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default DeliveryProofModal;
