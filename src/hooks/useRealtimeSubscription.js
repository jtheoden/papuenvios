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
        const effectiveFilter = sanitizedFilter ?? 'id=not.is.null';

        // Create channel name (unique per table/filter/event to avoid collisions)
        const uniqueToken = Math.random().toString(36).slice(2, 8);
        const channelName = `realtime:${table}:${event}:${effectiveFilter}:${uniqueToken}`;

        // Build subscription
        const changeOptions = {
          event: event,
          schema: 'public',
          table: table
        };

        changeOptions.filter = effectiveFilter;

        let subscription = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            changeOptions,
            (payload) => {
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
