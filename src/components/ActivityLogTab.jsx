import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Clock, Filter, Search, Shield, X, User, Calendar, FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { fetchActivityLogs } from '@/lib/activityLogger';
import { useRealtimeActivityLogs } from '@/hooks/useRealtimeSubscription';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';

const ACTION_OPTIONS = [
  'all',
  'create',
  'update',
  'delete',
  'login',
  'status_change',
  'validate',
  'reject'
];

const ENTITY_OPTIONS = [
  'all',
  'user',
  'order',
  'remittance',
  'product',
  'combo',
  'inventory',
  'offer',
  'coupon',
  'payment'
];

const ActivityLogTab = () => {
  const { t, language } = useLanguage();
  const { isSuperAdmin } = useAuth();
  const { visualSettings } = useBusiness();

  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const data = await fetchActivityLogs({
      search,
      type: actionFilter,
      entity: entityFilter,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
    setLogs(data);
    setCurrentPage(1); // Reset to first page when filters change
    setLoading(false);
  }, [actionFilter, entityFilter, search, startDate, endDate]);

  // Paginated logs (Req 12)
  const paginatedLogs = useMemo(() => {
    return logs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [logs, currentPage, pageSize]);

  const totalPages = Math.ceil(logs.length / pageSize);

  useEffect(() => {
    if (!isSuperAdmin) return;
    loadLogs();
  }, [isSuperAdmin, loadLogs]);

  useRealtimeActivityLogs({
    enabled: isSuperAdmin,
    onUpdate: () => {
      if (!isSuperAdmin) return;
      loadLogs();
    }
  });

  const columns = useMemo(() => ([
    {
      key: 'created_at',
      label: t('activityLog.timestamp') || 'Fecha',
      width: 'w-40',
      render: (value) => {
        const date = new Date(value);
        return (
          <div className="text-sm">
            <div className="font-semibold">{date.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}</div>
            <div className="text-gray-500">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        );
      }
    },
    {
      key: 'performed_by',
      label: t('activityLog.user') || 'Usuario',
      width: 'w-48',
      render: (value) => (
        <div className="font-medium">{value || t('activityLog.unknownUser') || 'Desconocido'}</div>
      )
    },
    {
      key: 'action',
      label: t('activityLog.action') || 'Acción',
      width: 'w-36',
      render: (value) => (
        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 capitalize">
          {value}
        </span>
      )
    },
    {
      key: 'entity_type',
      label: t('activityLog.entity') || 'Entidad',
      width: 'w-32',
      render: (value) => <span className="capitalize">{value}</span>
    },
    {
      key: 'description',
      label: t('activityLog.description') || 'Descripción',
      render: (value, row) => (
        <div className="space-y-1 text-sm">
          <p className="text-gray-800">{value || t('activityLog.noDescription') || 'Sin descripción'}</p>
          {row.metadata?.target && (
            <p className="text-xs text-gray-500">{t('activityLog.target') || 'Objetivo'}: {row.metadata.target}</p>
          )}
        </div>
      )
    }
  ]), [language, t]);

  if (!isSuperAdmin) {
    return (
      <div className="p-6 bg-white rounded-xl border border-gray-200 text-center text-gray-600">
        {t('activityLog.onlySuperAdmin') || 'Solo el super admin puede ver el registro de actividad.'}
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold" style={{ color: visualSettings?.primaryColor || '#111827' }}>
            {t('activityLog.title') || 'Registro de Actividad'}
          </h2>
          <p className="text-gray-600 flex items-center gap-2 mt-1">
            <Shield className="w-4 h-4" />
            {t('activityLog.subtitle') || 'Auditoría completa de eventos críticos y de sesión'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('activityLog.search') || 'Buscar por usuario o detalle'}
              className="pl-9 pr-3 py-2 border rounded-lg shadow-sm focus:ring-2"
              style={{ '--tw-ring-color': visualSettings?.primaryColor || '#9333ea' }}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-white">
              <Filter className="w-4 h-4 text-gray-500" />
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="text-sm focus:outline-none">
                {ACTION_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option === 'all' ? t('common.all') : option}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-white">
              <Activity className="w-4 h-4 text-gray-500" />
              <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="text-sm focus:outline-none">
                {ENTITY_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option === 'all' ? t('common.all') : option}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Date Filters (Req 12) */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-gray-200">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-sm text-gray-600">{language === 'es' ? 'Desde:' : 'From:'}</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1 text-sm border rounded-lg focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{language === 'es' ? 'Hasta:' : 'To:'}</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1 text-sm border rounded-lg focus:ring-2 focus:ring-purple-500"
          />
        </div>
        {(startDate || endDate || actionFilter !== 'all' || entityFilter !== 'all' || search) && (
          <button
            onClick={() => {
              setStartDate('');
              setEndDate('');
              setActionFilter('all');
              setEntityFilter('all');
              setSearch('');
            }}
            className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
            {language === 'es' ? 'Limpiar filtros' : 'Clear filters'}
          </button>
        )}
        <span className="ml-auto text-sm text-gray-500">
          {logs.length} {language === 'es' ? 'registros' : 'records'}
        </span>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-effect p-4 rounded-xl flex items-center gap-3">
          <Clock className="w-10 h-10 text-purple-600" />
          <div>
            <p className="text-sm text-gray-500">{t('activityLog.latest') || 'Últimas 24h'}</p>
            <p className="text-2xl font-bold">{logs.length}</p>
          </div>
        </div>
        <div className="glass-effect p-4 rounded-xl flex items-center gap-3">
          <Activity className="w-10 h-10 text-blue-600" />
          <div>
            <p className="text-sm text-gray-500">{t('activityLog.securityEvents') || 'Eventos de seguridad'}</p>
            <p className="text-xl font-semibold">{logs.filter(l => l.action === 'login' || l.action === 'validate').length}</p>
          </div>
        </div>
      </div>

      <ResponsiveTableWrapper
        data={paginatedLogs}
        columns={columns}
        isLoading={loading}
        onRowClick={(row) => setSelectedLog(row)}
      />

      {/* Pagination (Req 12) */}
      {logs.length > pageSize && (
        <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600">
            {language === 'es'
              ? `Mostrando ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, logs.length)} de ${logs.length}`
              : `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, logs.length)} of ${logs.length}`
            }
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {language === 'es' ? 'Anterior' : 'Previous'}
            </button>
            <span className="text-sm text-gray-600">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {language === 'es' ? 'Siguiente' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal - Responsive for 320px */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
          onClick={() => setSelectedLog(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-3 sm:p-4 flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-bold text-gray-900">
                {t('activityLog.details') || 'Detalles de Actividad'}
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-3 sm:p-4 space-y-4">
              {/* Date/Time */}
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500">{t('activityLog.timestamp') || 'Fecha'}</p>
                  <p className="text-sm font-semibold">
                    {new Date(selectedLog.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')}
                    {' - '}
                    {new Date(selectedLog.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                </div>
              </div>

              {/* User */}
              <div className="flex items-start gap-3">
                <User className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500">{t('activityLog.user') || 'Usuario'}</p>
                  <p className="text-sm font-semibold">{selectedLog.performed_by || t('activityLog.unknownUser') || 'Desconocido'}</p>
                </div>
              </div>

              {/* Action & Entity */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-purple-50 rounded-lg p-3">
                  <p className="text-xs text-purple-600 mb-1">{t('activityLog.action') || 'Acción'}</p>
                  <span className="px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 capitalize">
                    {selectedLog.action}
                  </span>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-600 mb-1">{t('activityLog.entity') || 'Entidad'}</p>
                  <p className="text-sm font-semibold capitalize">{selectedLog.entity_type}</p>
                </div>
              </div>

              {/* Description */}
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-gray-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-gray-500">{t('activityLog.description') || 'Descripción'}</p>
                  <p className="text-sm text-gray-800">{selectedLog.description || t('activityLog.noDescription') || 'Sin descripción'}</p>
                </div>
              </div>

              {/* Metadata */}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-2">{t('activityLog.metadata') || 'Información Adicional'}</p>
                  <div className="space-y-1.5 text-xs">
                    {Object.entries(selectedLog.metadata).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}:</span>
                        <span className="font-medium text-gray-800 text-right break-all">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Entity ID */}
              {selectedLog.entity_id && (
                <div className="text-xs text-gray-400 text-center pt-2 border-t">
                  ID: {selectedLog.entity_id}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 p-3 sm:p-4">
              <button
                onClick={() => setSelectedLog(null)}
                className="w-full py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                {t('common.close') || 'Cerrar'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

export default ActivityLogTab;
