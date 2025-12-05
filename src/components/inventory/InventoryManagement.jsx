import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Package, Search, RefreshCw, AlertCircle, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import TableDetailModal from '@/components/modals/TableDetailModal';
import { getInventoryTableColumns, getInventoryModalColumns } from './InventoryTableConfig';

/**
 * InventoryManagement Component
 * Displays and manages business inventory with batch-level tracking
 * Responsive across all screen sizes: xs/sm as cards, md+ as table
 */
const InventoryManagement = () => {
  const { t, language } = useLanguage();
  const { products, visualSettings } = useBusiness();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInventory, setSelectedInventory] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all'); // all, lowStock, expired, outOfStock
  const [loading, setLoading] = useState(false);

  // Aggregate inventory data from products
  const inventoryData = React.useMemo(() => {
    if (!products || !Array.isArray(products)) return [];

    return products
      .flatMap(product => {
        // Each product can have multiple inventory batches
        // For now, consolidate all inventory for a product
        if (!product.inventory || product.inventory.length === 0) {
          return {
            id: `${product.id}-no-inventory`,
            product_id: product.id,
            product_name: product.name,
            category: product.category_name || product.category || 'Uncategorized',
            sku: product.sku || '',
            quantity: 0,
            reserved_quantity: 0,
            available_quantity: 0,
            cost_per_unit: product.cost_per_unit || 0,
            base_price: product.base_price || product.price || 0,
            profit_margin: product.profit_margin || 0,
            currency_code: product.currency_code || 'USD',
            received_date: null,
            expiry_date: null,
            batch_number: '',
            supplier_reference: '',
            notes: '',
            min_stock_alert: product.min_stock_alert || 10
          };
        }

        return product.inventory.map(inv => ({
          id: inv.id,
          product_id: product.id,
          product_name: product.name,
          category: product.category_name || product.category || 'Uncategorized',
          sku: product.sku || '',
          quantity: inv.quantity || 0,
          reserved_quantity: inv.reserved_quantity || 0,
          available_quantity: inv.available_quantity || (inv.quantity - (inv.reserved_quantity || 0)),
          cost_per_unit: inv.cost_per_unit || product.cost_per_unit || 0,
          base_price: inv.base_price || product.base_price || product.price || 0,
          profit_margin: product.profit_margin || 0,
          currency_code: inv.currency_code || product.currency_code || 'USD',
          received_date: inv.received_date,
          expiry_date: inv.expiry_date,
          batch_number: inv.batch_number || '',
          supplier_reference: inv.supplier_reference || '',
          notes: inv.notes || '',
          min_stock_alert: product.min_stock_alert || 10
        }));
      })
      .filter(Boolean);
  }, [products]);

  // Filter inventory based on status and search
  const filteredInventory = React.useMemo(() => {
    return inventoryData.filter(item => {
      // Search filter
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        item.product_name.toLowerCase().includes(searchLower) ||
        item.sku.toLowerCase().includes(searchLower) ||
        item.batch_number.toLowerCase().includes(searchLower) ||
        item.supplier_reference.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;

      // Status filter
      if (filterStatus === 'all') return true;

      const isExpired =
        item.expiry_date && new Date(item.expiry_date) < new Date();
      const isExpiringSoon =
        item.expiry_date &&
        new Date(item.expiry_date) > new Date() &&
        Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) <= 30;
      const isLowStock = item.available_quantity > 0 && item.available_quantity <= item.min_stock_alert;
      const isOutOfStock = item.available_quantity === 0;

      switch (filterStatus) {
        case 'lowStock':
          return isLowStock || isExpiringSoon;
        case 'expired':
          return isExpired;
        case 'outOfStock':
          return isOutOfStock;
        default:
          return true;
      }
    });
  }, [inventoryData, searchTerm, filterStatus]);

  // Calculate summary metrics
  const metrics = React.useMemo(() => {
    const totalItems = filteredInventory.reduce((sum, item) => sum + item.quantity, 0);
    const totalAvailable = filteredInventory.reduce((sum, item) => sum + item.available_quantity, 0);
    const totalReserved = filteredInventory.reduce((sum, item) => sum + item.reserved_quantity, 0);
    const expiredCount = filteredInventory.filter(
      item => item.expiry_date && new Date(item.expiry_date) < new Date()
    ).length;
    const outOfStockCount = filteredInventory.filter(item => item.available_quantity === 0).length;
    const lowStockCount = filteredInventory.filter(
      item => item.available_quantity > 0 && item.available_quantity <= item.min_stock_alert
    ).length;

    return { totalItems, totalAvailable, totalReserved, expiredCount, outOfStockCount, lowStockCount };
  }, [filteredInventory]);

  const handleRowClick = (inventory) => {
    setSelectedInventory(inventory);
    setShowDetailModal(true);
  };

  const columns = getInventoryTableColumns(t, language);
  const modalColumns = getInventoryModalColumns(t);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="w-full"
    >
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2 mb-2">
          <Package className="h-6 w-6 sm:h-8 sm:w-8" style={{ color: visualSettings.primaryColor || '#2563eb' }} />
          {language === 'es' ? 'Gestión de Inventario' : 'Inventory Management'}
        </h1>
        <p className="text-sm text-gray-600">
          {language === 'es'
            ? 'Monitorea tu inventario, rastrea lotes y administra existencias'
            : 'Monitor inventory, track batches, and manage stock levels'}
        </p>
      </div>

      {/* Summary Metrics - Responsive Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3 mb-6">
        <div className="glass-effect p-3 sm:p-4 rounded-lg">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{language === 'es' ? 'Total' : 'Total'}</div>
          <div className="text-lg sm:text-2xl font-bold text-gray-900">{metrics.totalItems}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-lg">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{language === 'es' ? 'Disponible' : 'Available'}</div>
          <div className="text-lg sm:text-2xl font-bold text-green-600">{metrics.totalAvailable}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-lg">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{language === 'es' ? 'Reservado' : 'Reserved'}</div>
          <div className="text-lg sm:text-2xl font-bold text-orange-600">{metrics.totalReserved}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-lg">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{language === 'es' ? 'Bajo Stock' : 'Low Stock'}</div>
          <div className="text-lg sm:text-2xl font-bold text-yellow-600">{metrics.lowStockCount}</div>
        </div>
        <div className="glass-effect p-3 sm:p-4 rounded-lg">
          <div className="text-xs sm:text-sm text-gray-600 mb-1">{language === 'es' ? 'Vencido' : 'Expired'}</div>
          <div className="text-lg sm:text-2xl font-bold text-red-600">{metrics.expiredCount}</div>
        </div>
      </div>

      {/* Alerts Section */}
      {(metrics.expiredCount > 0 || metrics.outOfStockCount > 0) && (
        <div className="mb-6 space-y-2">
          {metrics.expiredCount > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
              <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-600 flex-shrink-0" />
              <div className="text-sm text-red-800">
                {language === 'es'
                  ? `${metrics.expiredCount} producto(s) vencido(s) - Considera eliminarlos del inventario`
                  : `${metrics.expiredCount} expired product(s) - Consider removing from inventory`}
              </div>
            </div>
          )}
          {metrics.outOfStockCount > 0 && (
            <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg p-3 sm:p-4">
              <TrendingDown className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600 flex-shrink-0" />
              <div className="text-sm text-orange-800">
                {language === 'es'
                  ? `${metrics.outOfStockCount} producto(s) sin existencias`
                  : `${metrics.outOfStockCount} out-of-stock product(s)`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search and Filter Controls */}
      <div className="glass-effect rounded-xl p-4 sm:p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={language === 'es' ? 'Buscar por nombre, SKU, lote...' : 'Search by name, SKU, batch...'}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input-style w-full pl-10"
            />
          </div>

          {/* Filter Dropdown */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="input-style"
          >
            <option value="all">{language === 'es' ? 'Todos los estados' : 'All statuses'}</option>
            <option value="outOfStock">{language === 'es' ? 'Sin existencias' : 'Out of Stock'}</option>
            <option value="lowStock">{language === 'es' ? 'Bajo stock / Próximo a vencer' : 'Low Stock / Expiring Soon'}</option>
            <option value="expired">{language === 'es' ? 'Vencido' : 'Expired'}</option>
          </select>
        </div>
      </div>

      {/* Inventory Table/List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin" style={{ color: visualSettings.primaryColor || '#2563eb' }} />
        </div>
      ) : filteredInventory.length === 0 ? (
        <div className="glass-effect rounded-xl p-8 sm:p-12 text-center">
          <Package className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg sm:text-xl font-semibold text-gray-700 mb-2">
            {language === 'es' ? 'No hay inventario' : 'No inventory'}
          </h3>
          <p className="text-sm text-gray-600">
            {searchTerm || filterStatus !== 'all'
              ? language === 'es'
                ? 'Intenta ajustar los filtros de búsqueda'
                : 'Try adjusting your search filters'
              : language === 'es'
              ? 'Comienza agregando productos a tu inventario'
              : 'Start by adding products to your inventory'}
          </p>
        </div>
      ) : (
        <ResponsiveTableWrapper
          data={filteredInventory}
          columns={columns}
          onRowClick={handleRowClick}
          isLoading={loading}
          modalTitle={language === 'es' ? 'Detalles del Inventario' : 'Inventory Details'}
          modalColumns={modalColumns}
        />
      )}

      {/* Detail Modal */}
      {selectedInventory && (
        <TableDetailModal
          isOpen={showDetailModal}
          onClose={() => {
            setShowDetailModal(false);
            setTimeout(() => setSelectedInventory(null), 300);
          }}
          title={language === 'es' ? 'Detalles del Inventario' : 'Inventory Details'}
          data={selectedInventory}
          columns={modalColumns}
          maxHeight="80vh"
        />
      )}
    </motion.div>
  );
};

export default InventoryManagement;
