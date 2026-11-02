/**
 * BusinessClosedBanner Component
 * Displays a banner when the business is closed
 * Shows customizable message and expected reopen time
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, AlertCircle, Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getBusinessStatus, subscribeToBusinessStatus } from '@/lib/businessStatusService';

const BusinessClosedBanner = ({ variant = 'banner', onStatusChange }) => {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const businessStatus = await getBusinessStatus();
        setStatus(businessStatus);
        onStatusChange?.(businessStatus);
      } catch (error) {
        console.error('Failed to load business status:', error);
      } finally {
        setLoading(false);
      }
    };

    loadStatus();

    // Subscribe to realtime changes
    const unsubscribe = subscribeToBusinessStatus((newStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    });

    return () => unsubscribe();
  }, [onStatusChange]);

  // Don't show anything if loading or business is open
  if (loading || status?.is_open !== false) {
    return null;
  }

  const message = language === 'es'
    ? status.closed_message_es
    : status.closed_message_en;

  const formatReopenTime = (dateStr) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleString(language === 'es' ? 'es-ES' : 'en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return null;
    }
  };

  const expectedReopen = formatReopenTime(status.expected_reopen_at);

  // Full-page overlay variant
  if (variant === 'overlay') {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 25 }}
            className="max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
              <div className="flex items-center gap-3 mb-2">
                <Clock className="w-8 h-8" />
                <h2 className="text-2xl font-bold">
                  {language === 'es' ? 'Temporalmente Cerrado' : 'Temporarily Closed'}
                </h2>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-gray-700 text-lg">{message}</p>
              </div>

              {expectedReopen && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-sm text-blue-600 font-medium">
                      {language === 'es' ? 'Reapertura esperada:' : 'Expected to reopen:'}
                    </p>
                    <p className="text-blue-800 font-semibold">{expectedReopen}</p>
                  </div>
                </div>
              )}

              <p className="mt-4 text-sm text-gray-500 text-center">
                {language === 'es'
                  ? 'Puedes seguir navegando el catálogo. Tu pedido será procesado cuando abramos.'
                  : 'You can continue browsing the catalog. Your order will be processed when we open.'}
              </p>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Banner variant (default)
  return (
    <motion.div
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 px-4 shadow-lg"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 text-center">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 animate-pulse" />
          <span className="font-semibold">
            {language === 'es' ? 'Temporalmente Cerrado' : 'Temporarily Closed'}
          </span>
        </div>
        <span className="hidden sm:inline">•</span>
        <span className="text-sm sm:text-base opacity-90">{message}</span>
        {expectedReopen && (
          <>
            <span className="hidden sm:inline">•</span>
            <span className="text-sm flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              {language === 'es' ? 'Reabre:' : 'Reopens:'} {expectedReopen}
            </span>
          </>
        )}
      </div>
    </motion.div>
  );
};

export default BusinessClosedBanner;
