import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Loader } from 'lucide-react';
import TableDetailModal from '@/components/modals/TableDetailModal';
import { semanticColors } from '@/lib/colorTokens';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Responsive table wrapper that adapts display based on screen size
 * xs (< 640px): Icon buttons with modal
 * sm-md (640-1024px): Card layout with key fields
 * lg+ (1024px+): Standard table layout
 *
 * @prop {array} data - Array of row objects
 * @prop {array} columns - Column configuration: {key, label, render, sortable, width}
 * @prop {function} onRowClick - Callback when row is clicked/expanded
 * @prop {boolean} isLoading - Loading state
 * @prop {string} modalTitle - i18n key for modal title
 * @prop {array} modalColumns - Column config for modal detail view
 * @prop {string} className - Additional CSS classes
 */
const ResponsiveTableWrapper = ({
  data = [],
  columns = [],
  onRowClick,
  isLoading = false,
  modalTitle,
  modalColumns = [],
  className = ''
}) => {
  const { t } = useLanguage();
  const [selectedRow, setSelectedRow] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const handleRowClick = (row) => {
    setSelectedRow(row);
    setShowModal(true);
    onRowClick?.(row);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size={32} className="animate-spin" style={{ color: semanticColors.primary.main }} />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12" style={{ color: semanticColors.neutral[500] }}>
        <p className="text-sm sm:text-base">{t('tables.noData') || 'No data available'}</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile View: xs screens */}
      <div className="block sm:hidden space-y-2">
        {data.map((row, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            onClick={() => handleRowClick(row)}
            className="bg-white rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
            style={{ borderColor: semanticColors.neutral[200], border: `1px solid ${semanticColors.neutral[200]}` }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                {/* Show first two columns on xs */}
                {columns.slice(0, 2).map((col) => (
                  <div key={col.key} className="text-xs font-medium" style={{ color: semanticColors.neutral[600] }}>
                    <span className="font-medium">{col.label}:</span>{' '}
                    {col.render ? col.render(row[col.key], row) : row[col.key] || '-'}
                  </div>
                ))}
              </div>
              <ChevronRight size={20} className="flex-shrink-0" style={{ color: semanticColors.neutral[400] }} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Tablet View: sm-md screens */}
      <div className="hidden sm:block md:hidden">
        <div className="space-y-3">
          {data.map((row, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            onClick={() => handleRowClick(row)}
            className="bg-white rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer"
            style={{ border: `1px solid ${semanticColors.neutral[200]}` }}
          >
            <div className="grid grid-cols-2 gap-4">
              {columns.slice(0, 4).map((col) => (
                <div key={col.key}>
                  <div className="text-xs sm:text-sm font-medium mb-1" style={{ color: semanticColors.neutral[700] }}>{col.label}</div>
                  <div className="text-sm sm:text-base break-words" style={{ color: semanticColors.neutral[900] }}>
                    {col.render ? col.render(row[col.key], row) : row[col.key] || '-'}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button className="text-xs sm:text-sm font-medium" style={{ color: semanticColors.primary.main }} onMouseEnter={(e) => { e.currentTarget.style.color = semanticColors.primary.dark; }} onMouseLeave={(e) => { e.currentTarget.style.color = semanticColors.primary.main; }}>
                {t('tables.viewDetails') || 'View Details'} →
              </button>
            </div>
          </motion.div>
          ))}
        </div>
      </div>

      {/* Desktop View: md+ screens - Show full table with all columns */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead style={{ backgroundColor: semanticColors.neutral[50], borderBottom: `1px solid ${semanticColors.neutral[200]}` }}>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-xs sm:text-sm font-medium"
                  style={{ width: col.width, color: semanticColors.neutral[700] }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ borderTopColor: semanticColors.neutral[200] }}>
            {data.map((row, idx) => (
              <motion.tr
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                className="transition-colors"
                style={{ borderBottom: `1px solid ${semanticColors.neutral[200]}` }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = semanticColors.neutral[50]; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-4 py-3 text-sm"
                    style={{ color: semanticColors.neutral[900] }}
                    onClick={() => col.key !== 'actions' && onRowClick?.(row)}
                  >
                    {col.render ? col.render(row[col.key], row) : row[col.key] || '-'}
                  </td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Detail Modal (xs only) */}
      {modalTitle && modalColumns.length > 0 && (
        <TableDetailModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          title={modalTitle}
          data={selectedRow}
          columns={modalColumns}
        />
      )}
    </>
  );
};

export default ResponsiveTableWrapper;
