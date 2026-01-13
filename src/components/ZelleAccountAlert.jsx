import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, RefreshCw, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserAlerts } from '@/hooks/useRealtimeSubscription';

/**
 * ZelleAccountAlert
 *
 * Persistent alert banner shown when user has pending operations
 * whose Zelle account was deactivated.
 *
 * Uses database-based alerts via useUserAlerts hook to ensure
 * ALL users are notified even if they were offline when the event occurred.
 */
const ZelleAccountAlert = ({ onSelectNewAccount, operationType = 'all' }) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(true);

  // Use database-based alerts hook
  const {
    alerts,
    loading,
    hasAlerts,
    dismissAlert,
    dismissByOperation
  } = useUserAlerts({
    userId: user?.id,
    alertType: 'zelle_account_deactivated',
    enabled: !!user?.id
  });

  // Filter by operation type if specified
  const filteredAlerts = operationType === 'all'
    ? alerts
    : alerts.filter(a => a.metadata?.operationType === operationType);

  // Handle select new account action
  const handleSelectNewAccount = useCallback((alert) => {
    if (onSelectNewAccount) {
      onSelectNewAccount(alert);
    }
    // Dismiss this specific alert
    if (alert.metadata?.operationType && alert.metadata?.operationId) {
      dismissByOperation(alert.metadata.operationType, alert.metadata.operationId);
    } else {
      dismissAlert(alert.id);
    }
  }, [onSelectNewAccount, dismissAlert, dismissByOperation]);

  // Handle dismiss all alerts
  const handleDismissAll = useCallback(async () => {
    setIsExpanded(false);
    // Dismiss all visible alerts
    for (const alert of filteredAlerts) {
      await dismissAlert(alert.id);
    }
  }, [filteredAlerts, dismissAlert]);

  // Don't render if loading or no alerts
  if (loading || !hasAlerts || filteredAlerts.length === 0) return null;

  const alertCount = filteredAlerts.length;
  const hasOrders = filteredAlerts.some(a => a.metadata?.operationType === 'order');
  const hasRemittances = filteredAlerts.some(a => a.metadata?.operationType === 'remittance');

  // Calculate total amount affected
  const totalAmount = filteredAlerts.reduce((sum, a) => sum + (a.metadata?.amount || 0), 0);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed top-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-md"
      >
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-2xl overflow-hidden border-2 border-amber-300">
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between bg-amber-600/30">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-white/20 rounded-lg animate-pulse">
                <Bell className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-white text-sm">
                {t('zelle.alert.title')}
              </span>
              {alertCount > 1 && (
                <span className="bg-white/30 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                  {alertCount}
                </span>
              )}
            </div>
            <button
              onClick={handleDismissAll}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              title={t('common.dismiss')}
            >
              <X className="h-4 w-4 text-white/80" />
            </button>
          </div>

          {/* Content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-4 py-3 bg-white"
              >
                {/* Alert message */}
                <p className="text-sm text-gray-700 mb-3">
                  {filteredAlerts[0]?.message || t('zelle.alert.message')}
                </p>

                {/* Affected operations summary */}
                <div className="space-y-2 mb-4">
                  {hasOrders && (
                    <div className="flex items-center justify-between text-xs text-gray-600 bg-orange-50 px-3 py-2 rounded-lg">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-orange-500" />
                        <span>
                          {filteredAlerts.filter(a => a.metadata?.operationType === 'order').length} {t('zelle.alert.ordersAffected')}
                        </span>
                      </div>
                    </div>
                  )}
                  {hasRemittances && (
                    <div className="flex items-center justify-between text-xs text-gray-600 bg-amber-50 px-3 py-2 rounded-lg">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 text-amber-500" />
                        <span>
                          {filteredAlerts.filter(a => a.metadata?.operationType === 'remittance').length} {t('zelle.alert.remittancesAffected')}
                        </span>
                      </div>
                    </div>
                  )}
                  {totalAmount > 0 && (
                    <div className="text-xs text-gray-500 text-center mt-2">
                      {t('zelle.alert.totalAffected')}: <span className="font-semibold">${totalAmount.toFixed(2)} USD</span>
                    </div>
                  )}
                </div>

                {/* Action button */}
                <Button
                  onClick={() => handleSelectNewAccount(filteredAlerts[0])}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {t('zelle.alert.selectNewAccount')}
                </Button>

                <p className="text-xs text-gray-500 mt-2 text-center">
                  {t('zelle.alert.hint')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ZelleAccountAlert;
