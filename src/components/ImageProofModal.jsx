import { motion } from 'framer-motion';
import { FileText, Clock, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEffect, useState, useRef } from 'react';
import { generateProofSignedUrl } from '@/lib/remittanceService';

/**
 * Reusable modal for displaying proof/receipt images
 * Handles signed URL generation and loading states
 * Fully accessible with ARIA attributes and keyboard navigation support
 */
const ImageProofModal = ({
  isOpen,
  onClose,
  proofUrl,
  title = 'Comprobante',
  bucketName = 'remittance-proofs'
}) => {
  const { t } = useLanguage();
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const modalRef = useRef(null);
  const titleId = `image-proof-modal-title`;

  useEffect(() => {
    const loadSignedUrl = async () => {
      if (isOpen && proofUrl) {
        setLoading(true);
        setSignedUrl(null);

        const result = await generateProofSignedUrl(proofUrl, bucketName);
        if (result.success) {
          setSignedUrl(result.signedUrl);
        }
        setLoading(false);
      }
    };

    loadSignedUrl();
  }, [isOpen, proofUrl, bucketName]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="presentation"
      onClick={(e) => {
        // Close modal when clicking outside (on the backdrop)
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2
            id={titleId}
            className="text-2xl font-bold gradient-text"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1"
            aria-label="Cerrar modal de comprobante"
            title="Presione Escape para cerrar"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center p-8 border-2 border-gray-200 rounded-lg bg-gray-50">
              <div className="text-center text-gray-500">
                <Clock className="w-12 h-12 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Cargando comprobante...</p>
              </div>
            </div>
          ) : signedUrl ? (
            <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
              <img
                src={signedUrl}
                alt={title}
                className="w-full h-auto max-h-[600px] object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="hidden flex-col items-center justify-center p-8 text-gray-500">
                <FileText className="w-16 h-16 mb-4" />
                <p className="text-sm text-center">No se pudo cargar la imagen</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center p-8 border-2 border-gray-200 rounded-lg bg-gray-50">
              <div className="text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-2" />
                <p className="text-sm">No hay comprobante disponible</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            aria-label="Cerrar"
          >
            {t('common.close')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ImageProofModal;
