import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * Generic Text Input Dialog Component
 * Reusable modal for getting user input with custom title and message
 * Supports Enter key for quick submission
 */
const InputDialog = ({ show, title, message, defaultValue, onConfirm, onCancel, t }) => {
  const [inputValue, setInputValue] = useState(defaultValue || '');

  useEffect(() => {
    if (show) {
      setInputValue(defaultValue || '');
    }
  }, [show, defaultValue]);

  if (!show) return null;

  const handleSubmit = () => {
    onConfirm(inputValue);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
      >
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4 rounded-t-lg">
          <h3 className="text-xl font-bold text-white">{title}</h3>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-gray-700 text-base">{message}</p>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            autoFocus
          />
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            {t('adminOrders.modals.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            {t('adminOrders.modals.submit')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default InputDialog;
