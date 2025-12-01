import React from 'react';
import { motion } from 'framer-motion';

/**
 * Generic Confirmation Dialog Component
 * Reusable modal for confirming actions with custom title and message
 */
const ConfirmDialog = ({ show, title, message, onConfirm, onCancel, t }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 rounded-t-lg">
          <h3 className="text-xl font-bold text-white">{title}</h3>
        </div>

        <div className="p-6">
          <p className="text-gray-700 text-base">{message}</p>
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            {t('adminOrders.modals.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {t('adminOrders.modals.confirm')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ConfirmDialog;
