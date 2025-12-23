import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Clock, Filter, Search, Shield } from 'lucide-react';
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
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const data = await fetchActivityLogs({
      search,
      type: actionFilter,
      entity: entityFilter
    });
    setLogs(data);
    setLoading(false);
  }, [actionFilter, entityFilter, search]);

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
              className="pl-9 pr-3 py-2 border rounded-lg shadow-sm focus:ring-2 focus:ring-purple-500"
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

      <ResponsiveTableWrapper data={logs} columns={columns} isLoading={loading} />
    </motion.div>
  );
};

export default ActivityLogTab;
