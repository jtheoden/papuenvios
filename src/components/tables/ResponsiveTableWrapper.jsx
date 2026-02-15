import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader } from 'lucide-react';
import TableDetailModal from '@/components/modals/TableDetailModal';
import { semanticColors } from '@/lib/colorTokens';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';

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
 * @prop {number} pageSize - Items per page (enables pagination when > 0)
 * @prop {array} pageSizeOptions - Page size options (e.g. [10, 20, 50])
 */
const ResponsiveTableWrapper = ({
  data = [],
  columns = [],
  onRowClick,
  isLoading = false,
  modalTitle,
  modalColumns = [],
  className = '',
  pageSize = 0,
  pageSizeOptions = []
}) => {
  const { t } = useLanguage();
  const { visualSettings } = useBusiness();
  const primaryColor = visualSettings?.primaryColor || semanticColors.primary.main;
  const [selectedRow, setSelectedRow] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);

  // Reset to page 1 when data changes (e.g. filter applied)
  useEffect(() => {
    setCurrentPage(1);
  }, [data.length]);

  const isPaginated = currentPageSize > 0;
  const totalPages = isPaginated ? Math.max(1, Math.ceil(data.length / currentPageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginatedData = isPaginated
    ? data.slice((safePage - 1) * currentPageSize, safePage * currentPageSize)
    : data;

  const handleRowClick = (row) => {
    setSelectedRow(row);
    setShowModal(true);
    onRowClick?.(row);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size={32} className="animate-spin" style={{ color: primaryColor }} />
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
        {paginatedData.map((row, idx) => (
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
          {paginatedData.map((row, idx) => (
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
              <button className="text-xs sm:text-sm font-medium" style={{ color: primaryColor }} onMouseEnter={(e) => { e.currentTarget.style.color = visualSettings?.buttonHoverBgColor || semanticColors.primary.dark; }} onMouseLeave={(e) => { e.currentTarget.style.color = primaryColor; }}>
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
            {paginatedData.map((row, idx) => (
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

      {/* Pagination Controls */}
      {isPaginated && data.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
          <div className="flex items-center gap-2 text-sm" style={{ color: semanticColors.neutral[500] }}>
            {pageSizeOptions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span>{t('tables.rowsPerPage')}</span>
                <select
                  value={currentPageSize}
                  onChange={(e) => {
                    setCurrentPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="border rounded px-2 py-1 text-sm bg-white"
                  style={{ borderColor: semanticColors.neutral[300], color: semanticColors.neutral[700] }}
                >
                  {pageSizeOptions.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            )}
            <span>
              {t('tables.pageInfo')
                .replace('{from}', data.length === 0 ? 0 : (safePage - 1) * currentPageSize + 1)
                .replace('{to}', Math.min(safePage * currentPageSize, data.length))
                .replace('{total}', data.length)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safePage <= 1}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: semanticColors.neutral[600] }}
              title={t('tables.firstPage')}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: semanticColors.neutral[600] }}
              title={t('tables.prevPage')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 py-1 text-sm font-medium" style={{ color: semanticColors.neutral[700] }}>
              {safePage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: semanticColors.neutral[600] }}
              title={t('tables.nextPage')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safePage >= totalPages}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: semanticColors.neutral[600] }}
              title={t('tables.lastPage')}
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

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
