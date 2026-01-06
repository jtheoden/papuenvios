/**
 * SearchFilterBar Component
 * Reusable search and filter bar for lists
 * Supports search input, status filters, and results counter
 */

import { useState, useEffect, useCallback } from 'react';
import { Search, X, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

const SearchFilterBar = ({
  onSearch,
  onFilterChange,
  filters = [],
  activeFilter = 'all',
  placeholder,
  resultsCount = null,
  debounceMs = 300
}) => {
  const { language } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [searchTerm, debounceMs]);

  // Call onSearch when debounced value changes
  useEffect(() => {
    if (onSearch) {
      onSearch(debouncedSearch);
    }
  }, [debouncedSearch, onSearch]);

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
    if (onSearch) {
      onSearch('');
    }
  }, [onSearch]);

  const defaultFilters = [
    { id: 'all', label: language === 'es' ? 'Todos' : 'All' },
    { id: 'pending', label: language === 'es' ? 'Pendientes' : 'Pending' },
    { id: 'processing', label: language === 'es' ? 'En Proceso' : 'Processing' },
    { id: 'completed', label: language === 'es' ? 'Completados' : 'Completed' },
    { id: 'rejected', label: language === 'es' ? 'Rechazados' : 'Rejected' }
  ];

  const filterOptions = filters.length > 0 ? filters : defaultFilters;

  return (
    <div className="space-y-4 mb-6">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={placeholder || (language === 'es' ? 'Buscar por nombre o referencia...' : 'Search by name or reference...')}
          className="w-full pl-10 pr-10 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white shadow-sm"
        />
        <AnimatePresence>
          {searchTerm && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100 transition-colors"
              aria-label={language === 'es' ? 'Limpiar busqueda' : 'Clear search'}
            >
              <X className="h-4 w-4 text-gray-400" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Filter Buttons and Results Counter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Filter Buttons */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="h-4 w-4 text-gray-500 flex-shrink-0" />
          {filterOptions.map((filter) => (
            <button
              key={filter.id}
              onClick={() => onFilterChange && onFilterChange(filter.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeFilter === filter.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filter.label}
              {filter.count !== undefined && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                  activeFilter === filter.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {filter.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Results Counter */}
        {resultsCount !== null && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-gray-500 whitespace-nowrap"
          >
            {resultsCount === 0
              ? (language === 'es' ? 'Sin resultados' : 'No results')
              : (language === 'es'
                  ? `${resultsCount} resultado${resultsCount !== 1 ? 's' : ''}`
                  : `${resultsCount} result${resultsCount !== 1 ? 's' : ''}`
                )
            }
          </motion.p>
        )}
      </div>
    </div>
  );
};

export default SearchFilterBar;
