/**
 * useRealtimeSubscription Hook
 *
 * Custom hook to manage Supabase Realtime subscriptions for live updates.
 * Allows multiple components to subscribe to table changes without reloading the page.
 *
 * Features:
 * - Automatic subscription management (subscribe/unsubscribe)
 * - Support for INSERT, UPDATE, DELETE events
 * - Configurable filters
 * - Cleanup on component unmount
 *
 * @example
 * const { data, loading } = useRealtimeSubscription({
 *   table: 'orders',
 *   event: '*', // or 'INSERT', 'UPDATE', 'DELETE'
 *   filter: 'status=eq.pending',
 *   onUpdate: (payload) => console.log('Order updated:', payload)
 * });
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export const useRealtimeSubscription = ({
  table,
  event = '*', // 'INSERT', 'UPDATE', 'DELETE', or '*' for all
  filter = null,
  enabled = true,
  onInsert = null,
  onUpdate = null,
  onDelete = null,
  onError = null
}) => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const onInsertRef = useRef(onInsert);
  const onUpdateRef = useRef(onUpdate);
  const onDeleteRef = useRef(onDelete);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onInsertRef.current = onInsert;
  }, [onInsert]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onDeleteRef.current = onDelete;
  }, [onDelete]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || !table) return;

    let channel;

    const subscribe = async () => {
      try {
        const sanitizedFilter =
          typeof filter === 'string' && filter.trim().length > 0 ? filter.trim() : null;

        // Create channel name (unique per table/filter/event to avoid collisions)
        const uniqueToken = Math.random().toString(36).slice(2, 8);
        const channelName = `realtime:${table}:${event}:${sanitizedFilter || 'all'}:${uniqueToken}`;

        // Build subscription options
        const changeOptions = {
          event: event,
          schema: 'public',
          table: table
        };

        // Only apply filter if one is explicitly provided
        // No filter = subscribe to ALL changes on the table
        if (sanitizedFilter) {
          changeOptions.filter = sanitizedFilter;
        }

        let subscription = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            changeOptions,
            (payload) => {
              console.log(`[Realtime] ${table} ${payload.eventType}:`, payload.new?.id || payload.old?.id);
              setLastUpdate(new Date());

              // Call specific handlers based on event type
              if (payload.eventType === 'INSERT') {
                const handler = onInsertRef.current || onUpdateRef.current;
                if (handler) handler(payload);
              } else if (payload.eventType === 'UPDATE') {
                if (onUpdateRef.current) onUpdateRef.current(payload);
              } else if (payload.eventType === 'DELETE') {
                const handler = onDeleteRef.current || onUpdateRef.current;
                if (handler) handler(payload);
              }
            }
          )
          .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
              setIsSubscribed(true);
              console.log(`[Realtime] Subscribed to ${table}`);
              return;
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setIsSubscribed(false);
              if (channel) {
                supabase.removeChannel(channel);
              }

              const error =
                err instanceof Error
                  ? err
                  : new Error(`Subscription ${status.toLowerCase()} for ${table}`);

              if (onErrorRef.current) {
                onErrorRef.current(error);
              }

              console.error(`[Realtime] Subscription ${status.toLowerCase()} for ${table}`, {
                filter: sanitizedFilter || undefined,
                event,
                error: err || undefined
              });
            }
          });

        channel = subscription;
      } catch (error) {
        console.error(`[Realtime] Error subscribing to ${table}:`, error);
        if (onErrorRef.current) {
          onErrorRef.current(error);
        }
      }
    };

    subscribe();

    // Cleanup: unsubscribe when component unmounts or dependencies change
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        setIsSubscribed(false);
        console.log(`[Realtime] Unsubscribed from ${table}`);
      }
    };
  }, [table, event, filter, enabled]);

  return {
    isSubscribed,
    lastUpdate
  };
};

/**
 * useRealtimeOrders Hook
 * Specialized hook for real-time order updates
 */
export const useRealtimeOrders = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'orders',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeRemittances Hook
 * Specialized hook for real-time remittance updates
 */
export const useRealtimeRemittances = ({ onUpdate, enabled = true, filter = null }) => {
  return useRealtimeSubscription({
    table: 'remittances',
    event: '*',
    enabled,
    filter,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeOffers Hook
 * Specialized hook for real-time offer updates
 */
export const useRealtimeOffers = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'offers',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeZelleTransactions Hook
 * Specialized hook for real-time Zelle transaction updates
 */
export const useRealtimeZelleTransactions = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'zelle_transaction_history',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeActivityLogs Hook
 * Specialized hook for real-time activity log updates
 */
export const useRealtimeActivityLogs = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'activity_logs',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeProducts Hook
 * Specialized hook for real-time product updates
 */
export const useRealtimeProducts = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'products',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeCombos Hook
 * Specialized hook for real-time combo updates
 */
export const useRealtimeCombos = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'combo_products',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeCategories Hook
 * Specialized hook for real-time product category updates
 */
export const useRealtimeCategories = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'product_categories',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useRealtimeZelleAccounts Hook
 * Specialized hook for real-time Zelle account updates
 * Propagates account changes immediately across all components
 */
export const useRealtimeZelleAccounts = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'zelle_accounts',
    event: '*',
    enabled,
    onInsert: onUpdate,
    onUpdate: onUpdate,
    onDelete: onUpdate
  });
};

/**
 * useUserAlerts Hook
 * Loads and manages user alerts from database with real-time updates.
 * Ensures ALL users receive persistent notifications even if offline when event occurred.
 *
 * @param {object} options - Hook options
 * @param {string} options.userId - User ID to fetch alerts for
 * @param {string} options.alertType - Filter by specific alert type (optional)
 * @returns {object} { alerts, loading, hasAlerts, dismissAlert, markAsRead, refresh }
 */
export const useUserAlerts = ({ userId, alertType = null, enabled = true }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load alerts from database
  const loadAlerts = async () => {
    if (!userId || !enabled) {
      setAlerts([]);
      setLoading(false);
      return;
    }

    try {
      let query = supabase
        .from('user_alerts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false });

      if (alertType) {
        query = query.eq('alert_type', alertType);
      }

      // Exclude expired alerts
      query = query.or('expires_at.is.null,expires_at.gt.now()');

      const { data, error } = await query;

      if (error) {
        console.error('[useUserAlerts] Error loading alerts:', error);
        setAlerts([]);
      } else {
        setAlerts(data || []);
      }
    } catch (error) {
      console.error('[useUserAlerts] Exception loading alerts:', error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadAlerts();
  }, [userId, alertType, enabled]);

  // Subscribe to real-time updates for this user's alerts
  useRealtimeSubscription({
    table: 'user_alerts',
    event: '*',
    filter: userId ? `user_id=eq.${userId}` : null,
    enabled: enabled && !!userId,
    onInsert: () => {
      console.log('[useUserAlerts] New alert received');
      loadAlerts();
    },
    onUpdate: () => {
      console.log('[useUserAlerts] Alert updated');
      loadAlerts();
    },
    onDelete: () => {
      console.log('[useUserAlerts] Alert deleted');
      loadAlerts();
    }
  });

  // Dismiss an alert
  const dismissAlert = async (alertId) => {
    try {
      const { error } = await supabase
        .from('user_alerts')
        .update({
          is_dismissed: true,
          dismissed_at: new Date().toISOString(),
          action_required: false
        })
        .eq('id', alertId);

      if (error) {
        console.error('[useUserAlerts] Error dismissing alert:', error);
        return false;
      }

      // Optimistically update local state
      setAlerts(prev => prev.filter(a => a.id !== alertId));
      return true;
    } catch (error) {
      console.error('[useUserAlerts] Exception dismissing alert:', error);
      return false;
    }
  };

  // Mark alert as read (but don't dismiss)
  const markAsRead = async (alertId) => {
    try {
      const { error } = await supabase
        .from('user_alerts')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) {
        console.error('[useUserAlerts] Error marking alert as read:', error);
        return false;
      }

      // Optimistically update local state
      setAlerts(prev => prev.map(a =>
        a.id === alertId ? { ...a, is_read: true, read_at: new Date().toISOString() } : a
      ));
      return true;
    } catch (error) {
      console.error('[useUserAlerts] Exception marking alert as read:', error);
      return false;
    }
  };

  // Dismiss alerts by operation (when user selects new Zelle account)
  const dismissByOperation = async (operationType, operationId) => {
    try {
      const { error } = await supabase
        .from('user_alerts')
        .update({
          is_dismissed: true,
          dismissed_at: new Date().toISOString(),
          action_required: false
        })
        .eq('user_id', userId)
        .eq('alert_type', 'zelle_account_deactivated')
        .contains('metadata', { operationType, operationId });

      if (error) {
        console.error('[useUserAlerts] Error dismissing by operation:', error);
        return false;
      }

      // Reload to get updated state
      loadAlerts();
      return true;
    } catch (error) {
      console.error('[useUserAlerts] Exception dismissing by operation:', error);
      return false;
    }
  };

  return {
    alerts,
    loading,
    hasAlerts: alerts.length > 0,
    alertCount: alerts.length,
    dismissAlert,
    markAsRead,
    dismissByOperation,
    refresh: loadAlerts
  };
};
