import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * Generic Text Input Dialog Component
 * Reusable modal for getting user input with custom title and message
 * Supports Enter key for quick submission and Escape to cancel
 * Fully accessible with ARIA labels and keyboard navigation
 */
const InputDialog = ({ show, title, message, defaultValue, onConfirm, onCancel, t }) => {
  const [inputValue, setInputValue] = useState(defaultValue || '');
  const inputRef = useRef(null);
  const modalRef = useRef(null);
  const titleId = `input-dialog-title`;
  const inputId = `input-dialog-input`;

  useEffect(() => {
    if (show) {
      setInputValue(defaultValue || '');
      // Focus the input when modal opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [show, defaultValue]);

  // Handle keyboard events (Enter to submit, Escape to cancel)
  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, onCancel]);

  if (!show) return null;

  const handleSubmit = () => {
    onConfirm(inputValue);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4 rounded-t-lg">
          <h3
            id={titleId}
            className="text-xl font-bold text-white"
          >
            {title}
          </h3>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-gray-700 text-base">{message}</p>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent focus:outline-none"
            autoFocus
            aria-label={message}
          />
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
            aria-label="Cancelar"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors font-medium"
            aria-label="Enviar"
          >
            {t('adminOrders.modals.submit')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default InputDialog;
