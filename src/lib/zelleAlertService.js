/**
 * Zelle Alert Service
 *
 * Manages persistent alerts for users whose Zelle account was deactivated
 * while they had pending operations (orders/remittances without payment proof)
 */

const ALERT_KEY = 'papuenvios_zelle_alerts';

/**
 * Get all alerts for the current user
 * @returns {Array} Array of alert objects
 */
export const getZelleAlerts = () => {
  try {
    const alerts = localStorage.getItem(ALERT_KEY);
    return alerts ? JSON.parse(alerts) : [];
  } catch (e) {
    console.warn('[ZelleAlertService] Error reading alerts:', e);
    return [];
  }
};

/**
 * Add a new alert for a user
 * @param {object} alert - Alert data
 * @param {string} alert.userId - User ID affected
 * @param {string} alert.type - 'order' or 'remittance'
 * @param {string} alert.operationId - ID of the affected operation
 * @param {string} alert.zelleAccountId - ID of the deactivated account
 * @param {number} alert.amount - Amount of the operation
 */
export const addZelleAlert = (alert) => {
  try {
    const alerts = getZelleAlerts();
    const newAlert = {
      ...alert,
      id: `${alert.type}-${alert.operationId}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      dismissed: false
    };
    alerts.push(newAlert);
    localStorage.setItem(ALERT_KEY, JSON.stringify(alerts));
    return newAlert;
  } catch (e) {
    console.warn('[ZelleAlertService] Error adding alert:', e);
    return null;
  }
};

/**
 * Add multiple alerts at once (batch)
 * @param {Array} alertsData - Array of alert objects
 */
export const addZelleAlertsBatch = (alertsData) => {
  try {
    const existingAlerts = getZelleAlerts();
    const newAlerts = alertsData.map(alert => ({
      ...alert,
      id: `${alert.type}-${alert.operationId}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      dismissed: false
    }));
    const combined = [...existingAlerts, ...newAlerts];
    localStorage.setItem(ALERT_KEY, JSON.stringify(combined));
    return newAlerts;
  } catch (e) {
    console.warn('[ZelleAlertService] Error adding alerts batch:', e);
    return [];
  }
};

/**
 * Dismiss an alert (mark as seen but keep for reference)
 * @param {string} alertId - ID of the alert to dismiss
 */
export const dismissZelleAlert = (alertId) => {
  try {
    const alerts = getZelleAlerts();
    const updated = alerts.map(alert =>
      alert.id === alertId ? { ...alert, dismissed: true } : alert
    );
    localStorage.setItem(ALERT_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('[ZelleAlertService] Error dismissing alert:', e);
  }
};

/**
 * Remove an alert completely (when user takes action)
 * @param {string} alertId - ID of the alert to remove
 */
export const removeZelleAlert = (alertId) => {
  try {
    const alerts = getZelleAlerts();
    const filtered = alerts.filter(alert => alert.id !== alertId);
    localStorage.setItem(ALERT_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[ZelleAlertService] Error removing alert:', e);
  }
};

/**
 * Remove alerts for a specific operation (when user selects new Zelle account)
 * @param {string} type - 'order' or 'remittance'
 * @param {string} operationId - ID of the operation
 */
export const removeAlertsByOperation = (type, operationId) => {
  try {
    const alerts = getZelleAlerts();
    const filtered = alerts.filter(alert =>
      !(alert.type === type && alert.operationId === operationId)
    );
    localStorage.setItem(ALERT_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[ZelleAlertService] Error removing alerts by operation:', e);
  }
};

/**
 * Get active (non-dismissed) alerts for current user
 * @param {string} userId - User ID to filter by
 * @returns {Array} Active alerts for the user
 */
export const getActiveAlertsForUser = (userId) => {
  const alerts = getZelleAlerts();
  return alerts.filter(alert =>
    alert.userId === userId && !alert.dismissed
  );
};

/**
 * Check if user has any pending alerts
 * @param {string} userId - User ID to check
 * @returns {boolean} True if user has active alerts
 */
export const hasActiveAlerts = (userId) => {
  return getActiveAlertsForUser(userId).length > 0;
};

/**
 * Clear all alerts (for testing/admin purposes)
 */
export const clearAllAlerts = () => {
  localStorage.removeItem(ALERT_KEY);
};

/**
 * Check if a specific Zelle account is still active
 * Used to determine if user needs to select a new account
 * @param {string} accountId - Zelle account ID
 * @param {Array} activeAccounts - List of currently active accounts
 * @returns {boolean} True if account is still active
 */
export const isZelleAccountActive = (accountId, activeAccounts) => {
  return activeAccounts.some(acc => acc.id === accountId && acc.is_active);
};

export default {
  getZelleAlerts,
  addZelleAlert,
  addZelleAlertsBatch,
  dismissZelleAlert,
  removeZelleAlert,
  removeAlertsByOperation,
  getActiveAlertsForUser,
  hasActiveAlerts,
  clearAllAlerts,
  isZelleAccountActive
};
