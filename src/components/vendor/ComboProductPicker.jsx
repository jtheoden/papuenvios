import React, { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Search, X } from 'lucide-react';
import { filterProducts } from '@/lib/productSearch';

const productLabel = (p) => p.name_es || p.name;

/**
 * Product selector for the combo form: search bar, pinned chips of the current
 * selection and the filterable checklist. Search state is local and never touches
 * the selection owned by the parent form.
 */
const ComboProductPicker = ({ products, selectedIds, quantities, onToggle, onQuantityChange, t }) => {
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);

  const visibleProducts = useMemo(() => {
    const matches = filterProducts(products, query);
    return onlySelected ? matches.filter((p) => selectedIds.includes(p.id)) : matches;
  }, [products, query, onlySelected, selectedIds]);

  const selectedProducts = useMemo(
    () => selectedIds.map((id) => products.find((p) => p.id === id)).filter(Boolean),
    [selectedIds, products]
  );

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('vendor.combos.searchProducts')}
          placeholder={t('vendor.combos.searchProductsPlaceholder')}
          autoComplete="off"
          className="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('vendor.combos.clearSearch')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {selectedProducts.length > 0 && (
        <div
          role="group"
          aria-label={t('vendor.combos.selectedProducts')}
          className="flex flex-wrap gap-1.5 mb-2"
        >
          {selectedProducts.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-0.5 text-xs rounded-full bg-purple-50 border border-purple-200 text-purple-800"
            >
              <span className="truncate">{productLabel(p)} ×{quantities[p.id] || 1}</span>
              <button
                type="button"
                onClick={() => onToggle(p.id)}
                aria-label={t('vendor.combos.removeProduct', { name: productLabel(p) })}
                className="p-1.5 -mr-1 rounded-full hover:bg-purple-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-gray-600">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(e) => setOnlySelected(e.target.checked)}
          />
          {t('vendor.combos.onlySelected')}
        </label>
        <span aria-live="polite">
          {t('vendor.combos.resultsCount', { shown: visibleProducts.length, total: products.length })}
        </span>
      </div>

      <div className="max-h-96 overflow-y-auto space-y-2 p-2 border rounded-lg bg-white">
        {visibleProducts.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">{t('vendor.combos.noProductResults')}</p>
        )}
        {visibleProducts.map((p) => {
          const stock = p.stock !== undefined ? p.stock : 0;
          const minStock = p.min_stock_alert || 10;
          const isOutOfStock = stock === 0;
          const isLowStock = stock > 0 && stock <= minStock;
          const isSelected = selectedIds.includes(p.id);
          const requiredQuantity = quantities[p.id] || 1;
          const hasInsufficientStock = isSelected && stock < requiredQuantity;

          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 p-2 rounded ${
                isOutOfStock ? 'bg-red-50 border border-red-200' :
                isLowStock || hasInsufficientStock ? 'bg-yellow-50 border border-yellow-200' :
                'border border-transparent'
              }`}
            >
              <input
                type="checkbox"
                id={`p-${p.id}`}
                checked={isSelected}
                onChange={() => onToggle(p.id)}
                disabled={isOutOfStock}
                className="flex-shrink-0"
              />
              <label
                htmlFor={`p-${p.id}`}
                className={`cursor-pointer flex-1 ${isOutOfStock ? 'text-gray-400 line-through' : ''}`}
              >
                {productLabel(p)}
              </label>
              {isOutOfStock && <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />}
              {isLowStock && !isOutOfStock && <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />}
              {hasInsufficientStock && <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0" />}
              {isSelected && (
                <input
                  type="number"
                  min="1"
                  value={requiredQuantity}
                  onChange={(e) => onQuantityChange(p.id, e.target.value)}
                  aria-label={`${t('vendor.combos.quantity')} ${productLabel(p)}`}
                  className="w-16 px-2 py-1 border rounded text-sm"
                  placeholder={t('vendor.combos.quantity')}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ComboProductPicker;
