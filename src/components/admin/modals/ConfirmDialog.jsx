import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * Generic Confirmation Dialog Component
 * Reusable modal for confirming actions with custom title and message
 * Fully accessible with ARIA attributes and keyboard navigation support
 */
const ConfirmDialog = ({ show, title, message, onConfirm, onCancel, t }) => {
  const modalRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const titleId = `confirm-dialog-title`;

  // Handle Escape key to cancel, and focus management
  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    // Focus the confirm button when modal opens
    setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 100);

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Return cleanup function
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, onCancel]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="presentation"
      onClick={(e) => {
        // Close modal when clicking outside (on the backdrop)
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 rounded-t-lg">
          <h3
            id={titleId}
            className="text-xl font-bold text-white"
          >
            {title}
          </h3>
        </div>

        <div className="p-6">
          <p className="text-gray-700 text-base">{message}</p>
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
            aria-label="Cancelar"
          >
            {t('adminOrders.modals.cancel')}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
            aria-label="Confirmar"
          >
            {t('adminOrders.modals.confirm')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ConfirmDialog;
