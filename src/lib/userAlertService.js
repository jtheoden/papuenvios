/**
 * User Alert Service
 *
 * Manages persistent alerts stored in Supabase database.
 * Ensures ALL users are notified even if they're not online when the event occurs.
 */

import { supabase } from './supabase';

// Alert types
export const ALERT_TYPES = {
  ZELLE_ACCOUNT_DEACTIVATED: 'zelle_account_deactivated',
  PAYMENT_REJECTED: 'payment_rejected',
  ORDER_CANCELLED: 'order_cancelled',
  REMITTANCE_CANCELLED: 'remittance_cancelled'
};

// Alert severities
export const ALERT_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Create a single alert for a user
 * @param {object} alertData - Alert data
 * @returns {Promise<object>} Created alert
 */
export const createUserAlert = async (alertData) => {
  const {
    userId,
    alertType,
    severity = ALERT_SEVERITY.WARNING,
    title,
    message,
    metadata = {},
    actionRequired = true,
    actionUrl = null,
    expiresAt = null
  } = alertData;

  try {
    const { data, error } = await supabase
      .from('user_alerts')
      .insert({
        user_id: userId,
        alert_type: alertType,
        severity,
        title,
        message,
        metadata,
        action_required: actionRequired,
        action_url: actionUrl,
        expires_at: expiresAt
      })
      .select()
      .single();

    if (error) {
      console.error('[UserAlertService] Error creating alert:', error);
      throw error;
    }

    console.log(`[UserAlertService] Alert created for user ${userId}:`, alertType);
    return data;
  } catch (error) {
    console.error('[UserAlertService] Failed to create alert:', error);
    throw error;
  }
};

/**
 * Create alerts for multiple users (batch)
 * Used when deactivating a Zelle account affects multiple users
 * @param {Array} alerts - Array of alert objects
 * @returns {Promise<Array>} Created alerts
 */
export const createUserAlertsBatch = async (alerts) => {
  if (!alerts || alerts.length === 0) return [];

  try {
    const alertsToInsert = alerts.map(alert => ({
      user_id: alert.userId,
      alert_type: alert.alertType,
      severity: alert.severity || ALERT_SEVERITY.WARNING,
      title: alert.title,
      message: alert.message,
      metadata: alert.metadata || {},
      action_required: alert.actionRequired !== false,
      action_url: alert.actionUrl || null,
      expires_at: alert.expiresAt || null
    }));

    const { data, error } = await supabase
      .from('user_alerts')
      .insert(alertsToInsert)
      .select();

    if (error) {
      console.error('[UserAlertService] Error creating batch alerts:', error);
      throw error;
    }

    console.log(`[UserAlertService] ${data.length} alerts created for ${alerts.length} users`);
    return data;
  } catch (error) {
    console.error('[UserAlertService] Failed to create batch alerts:', error);
    throw error;
  }
};

/**
 * Get active alerts for a user (not dismissed, action required)
 * @param {string} userId - User ID
 * @param {object} options - Filter options
 * @returns {Promise<Array>} User's active alerts
 */
export const getActiveAlertsForUser = async (userId, options = {}) => {
  const { alertType = null, limit = 50 } = options;

  try {
    let query = supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Filter by alert type if specified
    if (alertType) {
      query = query.eq('alert_type', alertType);
    }

    // Exclude expired alerts
    query = query.or('expires_at.is.null,expires_at.gt.now()');

    const { data, error } = await query;

    if (error) {
      console.error('[UserAlertService] Error fetching alerts:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('[UserAlertService] Failed to fetch alerts:', error);
    return [];
  }
};

/**
 * Get Zelle-related alerts for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Zelle alerts
 */
export const getZelleAlertsForUser = async (userId) => {
  return getActiveAlertsForUser(userId, {
    alertType: ALERT_TYPES.ZELLE_ACCOUNT_DEACTIVATED
  });
};

/**
 * Check if user has any pending alerts
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if user has active alerts
 */
export const hasActiveAlerts = async (userId) => {
  try {
    const { count, error } = await supabase
      .from('user_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_dismissed', false)
      .eq('action_required', true);

    if (error) throw error;

    return (count || 0) > 0;
  } catch (error) {
    console.error('[UserAlertService] Error checking alerts:', error);
    return false;
  }
};

/**
 * Mark alert as read
 * @param {string} alertId - Alert ID
 */
export const markAlertAsRead = async (alertId) => {
  try {
    const { error } = await supabase
      .from('user_alerts')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', alertId);

    if (error) throw error;

    console.log(`[UserAlertService] Alert ${alertId} marked as read`);
  } catch (error) {
    console.error('[UserAlertService] Error marking alert as read:', error);
  }
};

/**
 * Dismiss an alert (user has taken action or chosen to ignore)
 * @param {string} alertId - Alert ID
 */
export const dismissAlert = async (alertId) => {
  try {
    const { error } = await supabase
      .from('user_alerts')
      .update({
        is_dismissed: true,
        dismissed_at: new Date().toISOString(),
        action_required: false
      })
      .eq('id', alertId);

    if (error) throw error;

    console.log(`[UserAlertService] Alert ${alertId} dismissed`);
  } catch (error) {
    console.error('[UserAlertService] Error dismissing alert:', error);
  }
};

/**
 * Dismiss alerts by operation (when user selects new Zelle account)
 * @param {string} userId - User ID
 * @param {string} operationType - 'order' or 'remittance'
 * @param {string} operationId - Operation ID
 */
export const dismissAlertsByOperation = async (userId, operationType, operationId) => {
  try {
    const { error } = await supabase
      .from('user_alerts')
      .update({
        is_dismissed: true,
        dismissed_at: new Date().toISOString(),
        action_required: false
      })
      .eq('user_id', userId)
      .eq('alert_type', ALERT_TYPES.ZELLE_ACCOUNT_DEACTIVATED)
      .contains('metadata', { operationType, operationId });

    if (error) throw error;

    console.log(`[UserAlertService] Alerts dismissed for ${operationType}:${operationId}`);
  } catch (error) {
    console.error('[UserAlertService] Error dismissing alerts by operation:', error);
  }
};

/**
 * Create Zelle deactivation alerts for all affected users
 * Called when a Zelle account is deactivated
 * @param {object} params - Parameters
 * @param {string} params.zelleAccountId - Deactivated Zelle account ID
 * @param {string} params.zelleAccountName - Account name for display
 * @param {Array} params.affectedOrders - Orders affected
 * @param {Array} params.affectedRemittances - Remittances affected
 * @param {string} params.language - Language for messages ('es' or 'en')
 */
export const createZelleDeactivationAlerts = async ({
  zelleAccountId,
  zelleAccountName,
  affectedOrders = [],
  affectedRemittances = [],
  language = 'es'
}) => {
  const alerts = [];

  // Messages by language
  const messages = {
    es: {
      title: 'Cuenta Zelle No Disponible',
      orderMessage: `La cuenta Zelle "${zelleAccountName}" que seleccionaste para tu pedido ya no está disponible. Por favor selecciona otra cuenta para completar tu pago.`,
      remittanceMessage: `La cuenta Zelle "${zelleAccountName}" que seleccionaste para tu remesa ya no está disponible. Por favor selecciona otra cuenta para completar tu pago.`
    },
    en: {
      title: 'Zelle Account Unavailable',
      orderMessage: `The Zelle account "${zelleAccountName}" you selected for your order is no longer available. Please select another account to complete your payment.`,
      remittanceMessage: `The Zelle account "${zelleAccountName}" you selected for your remittance is no longer available. Please select another account to complete your payment.`
    }
  };

  const msg = messages[language] || messages.es;

  // Create alerts for affected orders
  affectedOrders.forEach(order => {
    if (order.user_id) {
      alerts.push({
        userId: order.user_id,
        alertType: ALERT_TYPES.ZELLE_ACCOUNT_DEACTIVATED,
        severity: ALERT_SEVERITY.WARNING,
        title: msg.title,
        message: msg.orderMessage,
        metadata: {
          operationType: 'order',
          operationId: order.id,
          zelleAccountId,
          zelleAccountName,
          amount: order.total_amount
        },
        actionRequired: true,
        actionUrl: '/cart'
      });
    }
  });

  // Create alerts for affected remittances
  affectedRemittances.forEach(remittance => {
    if (remittance.user_id) {
      alerts.push({
        userId: remittance.user_id,
        alertType: ALERT_TYPES.ZELLE_ACCOUNT_DEACTIVATED,
        severity: ALERT_SEVERITY.WARNING,
        title: msg.title,
        message: msg.remittanceMessage,
        metadata: {
          operationType: 'remittance',
          operationId: remittance.id,
          zelleAccountId,
          zelleAccountName,
          amount: remittance.amount_sent
        },
        actionRequired: true,
        actionUrl: '/send-remittance'
      });
    }
  });

  if (alerts.length > 0) {
    return await createUserAlertsBatch(alerts);
  }

  return [];
};

export default {
  ALERT_TYPES,
  ALERT_SEVERITY,
  createUserAlert,
  createUserAlertsBatch,
  getActiveAlertsForUser,
  getZelleAlertsForUser,
  hasActiveAlerts,
  markAlertAsRead,
  dismissAlert,
  dismissAlertsByOperation,
  createZelleDeactivationAlerts
};
