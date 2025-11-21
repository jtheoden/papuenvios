import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, ChevronDown, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * REUSABLE DataTable Component
 *
 * Generic table component for displaying tabular data with:
 * - Sorting (single column)
 * - Filtering/search
 * - Pagination
 * - Row actions (edit, delete, custom)
 * - Loading states
 * - Empty states
 * - Responsive design
 *
 * This component consolidates table logic from:
 * - UserManagement.jsx
 * - AdminRemittancesTab.jsx
 * - AdminOrdersTab.jsx
 * - VendorPage.jsx (testimonials)
 *
 * @component
 * @example
 * const columns = [
 *   { key: 'email', label: 'Email', sortable: true, width: '30%' },
 *   { key: 'role', label: 'Role', render: (val) => <Badge>{val}</Badge> },
 *   { key: 'is_enabled', label: 'Status', render: (val) => <span>{val ? '✓' : '✗'}</span> }
 * ];
 *
 * return (
 *   <DataTable
 *     columns={columns}
 *     data={users}
 *     onEdit={handleEdit}
 *     onDelete={handleDelete}
 *     loading={loading}
 *     emptyMessage="No users found"
 *     searchPlaceholder="Search by email or name..."
 *     searchFields={['email', 'full_name']}
 *   />
 * );
 */
export const DataTable = ({
  columns = [],
  data = [],
  onEdit = null,
  onDelete = null,
  onRowClick = null,
  onRefresh = null,
  loading = false,
  emptyMessage = 'No data available',
  searchPlaceholder = 'Search...',
  searchFields = [],
  pageSize = 10,
  striped = true,
  hoverable = true,
  compact = false,
  accentColor = 'blue'
}) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // TODO: Add filtering by multiple columns
  // TODO: Add bulk actions (select multiple rows)
  // TODO: Add column visibility toggle
  // TODO: Add export to CSV functionality

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!searchTerm || searchFields.length === 0) return data;

    return data.filter(row =>
      searchFields.some(field => {
        const value = row[field];
        if (value === null || value === undefined) return false;
        return value
          .toString()
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
      })
    );
  }, [data, searchTerm, searchFields]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig.key) return filteredData;

    const sorted = [...filteredData].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'string') {
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number') {
        return sortConfig.direction === 'asc'
          ? aVal - bVal
          : bVal - aVal;
      }

      return 0;
    });

    return sorted;
  }, [filteredData, sortConfig]);

  // Paginate data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSort = (columnKey) => {
    setSortConfig(prev => ({
      key: columnKey,
      direction: prev.key === columnKey && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
    setCurrentPage(1);
  };

  const handleSearch = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return null;
    return sortConfig.direction === 'asc'
      ? <ChevronUp className="w-4 h-4 inline ml-1" />
      : <ChevronDown className="w-4 h-4 inline ml-1" />;
  };

  const accentColorClasses = {
    blue: 'text-blue-600 hover:bg-blue-50',
    green: 'text-green-600 hover:bg-green-50',
    red: 'text-red-600 hover:bg-red-50',
    purple: 'text-purple-600 hover:bg-purple-50'
  };

  return (
    <div className="w-full space-y-4">
      {/* Header with Search and Refresh */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        {searchFields.length > 0 && (
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>
        )}

        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-effect rounded-lg overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            {/* Header */}
            <thead className="bg-gray-50 border-b">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider ${
                      column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                    }`}
                    onClick={() => column.sortable && handleSort(column.key)}
                    style={{ width: column.width }}
                  >
                    <div className="flex items-center">
                      {column.label}
                      {column.sortable && getSortIcon(column.key)}
                    </div>
                  </th>
                ))}
                {(onEdit || onDelete) && (
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>

            {/* Body */}
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={columns.length + (onEdit || onDelete ? 1 : 0)}
                    className="px-6 py-12 text-center"
                  >
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-500">Loading...</p>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (onEdit || onDelete ? 1 : 0)}
                    className="px-6 py-12 text-center"
                  >
                    <p className="text-gray-500">{emptyMessage}</p>
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, rowIndex) => (
                  <motion.tr
                    key={row.id || rowIndex}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: rowIndex * 0.05 }}
                    className={`
                      ${striped && rowIndex % 2 === 1 ? 'bg-gray-50' : ''}
                      ${hoverable ? 'hover:bg-gray-50 transition-colors' : ''}
                      ${onRowClick ? 'cursor-pointer' : ''}
                    `}
                    onClick={() => onRowClick && onRowClick(row)}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className="px-6 py-4">
                        {column.render
                          ? column.render(row[column.key], row)
                          : row[column.key] === null || row[column.key] === undefined
                          ? '-'
                          : String(row[column.key])}
                      </td>
                    ))}

                    {(onEdit || onDelete) && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {onEdit && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onEdit(row)}
                              className="text-blue-600 hover:text-blue-700"
                            >
                              Edit
                            </Button>
                          )}
                          {onDelete && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onDelete(row)}
                              className="text-red-600 hover:text-red-700"
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-600">
            Showing {paginatedData.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
            {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length} results
          </p>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>

            {/* Page Numbers */}
            <div className="flex gap-1">
              {[...Array(totalPages)].map((_, i) => (
                <Button
                  key={i + 1}
                  variant={currentPage === i + 1 ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCurrentPage(i + 1)}
                  className={currentPage === i + 1 ? accentColorClasses[accentColor] : ''}
                >
                  {i + 1}
                </Button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataTable;
