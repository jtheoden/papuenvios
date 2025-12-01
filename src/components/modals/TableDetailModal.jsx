import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Generic modal component for displaying table row details
 * Used by responsive tables to show full details on mobile/tablet
 * Fully accessible with ARIA attributes and keyboard navigation support
 *
 * @prop {boolean} isOpen - Whether modal is visible
 * @prop {function} onClose - Callback when modal should close
 * @prop {string} title - i18n key for modal title
 * @prop {object} data - Data object to display
 * @prop {array} columns - Array of column configs: {key, label, render}
 * @prop {string} maxHeight - CSS max-height value (default: '90vh')
 */
const TableDetailModal = ({ isOpen, onClose, title, data, columns = [], maxHeight = '90vh' }) => {
  const { t } = useLanguage();
  const modalRef = useRef(null);
  const titleId = `table-detail-modal-title`;

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

  if (!isOpen || !data) return null;

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
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-white rounded-2xl px-4 sm:px-6 md:px-8 py-6 max-w-4xl sm:max-w-5xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Header with title and close button */}
        <div className="flex items-center justify-between mb-6">
          <h2
            id={titleId}
            className="text-xl sm:text-2xl font-bold gradient-text"
          >
            {typeof title === 'string' && title.includes('.') ? t(title) : title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg transition-colors"
            aria-label="Cerrar detalles del registro"
            title="Presione Escape para cerrar"
          >
            <X size={24} className="text-gray-600" aria-hidden="true" />
          </button>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {columns.map((column) => (
            <div key={column.key} className="space-y-1">
              <label className="block text-xs sm:text-sm font-medium text-gray-700">
                {typeof column.label === 'string' && column.label.includes('.')
                  ? t(column.label)
                  : column.label}
              </label>
              <p className="text-sm sm:text-base text-gray-900 break-words">
                {column.render ? column.render(data[column.key], data) : data[column.key] || '-'}
              </p>
            </div>
          ))}
        </div>

        {/* Footer Action Button */}
        <div className="mt-8 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-white rounded-lg transition-colors text-sm font-medium"
            aria-label="Cerrar"
          >
            {t('common.close')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default TableDetailModal;
