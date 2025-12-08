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

import { useEffect, useState, useCallback } from 'react';
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

  useEffect(() => {
    if (!enabled || !table) return;

    let channel;

    const subscribe = async () => {
      try {
        // Create channel name
        const channelName = `realtime:${table}`;

        // Build subscription
        const changeOptions = {
          event: event,
          schema: 'public',
          table: table
        };

        if (filter) {
          changeOptions.filter = filter;
        }

        let subscription = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            changeOptions,
            (payload) => {
              setLastUpdate(new Date());

              // Call specific handlers based on event type
              if (payload.eventType === 'INSERT' && onInsert) {
                onInsert(payload);
              } else if (payload.eventType === 'UPDATE' && onUpdate) {
                onUpdate(payload);
              } else if (payload.eventType === 'DELETE' && onDelete) {
                onDelete(payload);
              }
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              setIsSubscribed(true);
              console.log(`[Realtime] Subscribed to ${table}`);
            } else if (status === 'CHANNEL_ERROR') {
              setIsSubscribed(false);
              if (onError) {
                onError(new Error(`Subscription error for ${table}`));
              }
              console.error(`[Realtime] Subscription error for ${table}`);
            } else if (status === 'TIMED_OUT') {
              setIsSubscribed(false);
              if (onError) {
                onError(new Error(`Subscription timeout for ${table}`));
              }
              console.error(`[Realtime] Subscription timeout for ${table}`);
            }
          });

        channel = subscription;
      } catch (error) {
        console.error(`[Realtime] Error subscribing to ${table}:`, error);
        if (onError) {
          onError(error);
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
  }, [table, event, filter, enabled, onInsert, onUpdate, onDelete, onError]);

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
export const useRealtimeRemittances = ({ onUpdate, enabled = true }) => {
  return useRealtimeSubscription({
    table: 'remittances',
    event: '*',
    enabled,
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
