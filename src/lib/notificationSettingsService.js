/**
 * Notification Settings Service
 * Manages notification settings stored in system_config table
 * - WhatsApp admin phone
 * - WhatsApp group URL
 * - Admin email
 */

import { supabase } from '@/lib/supabase';

const NOTIFICATION_KEYS = {
  WHATSAPP_PHONE: 'whatsapp_admin_phone',
  WHATSAPP_GROUP: 'whatsapp_group',
  ADMIN_EMAIL: 'admin_email'
};

const DEFAULT_SETTINGS = {
  whatsapp: '',
  whatsappGroup: '',
  adminEmail: ''
};

/**
 * Initialize notification settings in system_config if they don't exist
 * @returns {Promise<void>}
 */
async function initializeNotificationSettings() {
  try {
    const keysToCreate = Object.values(NOTIFICATION_KEYS);

    for (const key of keysToCreate) {
      const { data: existing } = await supabase
        .from('system_config')
        .select('id')
        .eq('key', key)
        .single();

      if (!existing) {
        let description = '';
        switch (key) {
          case NOTIFICATION_KEYS.WHATSAPP_PHONE:
            description = 'Número de WhatsApp para notificaciones de administrador';
            break;
          case NOTIFICATION_KEYS.WHATSAPP_GROUP:
            description = 'URL del grupo de WhatsApp para notificaciones de pedidos';
            break;
          case NOTIFICATION_KEYS.ADMIN_EMAIL:
            description = 'Email del administrador para recibir notificaciones de nuevos pedidos';
            break;
        }

        await supabase
          .from('system_config')
          .insert({
            key,
            value_text: '',
            description
          });
      }
    }
  } catch (err) {
    console.error('[NotificationSettings] Initialize error:', err);
  }
}

/**
 * Load notification settings from system_config
 * @returns {Promise<Object>} Settings object with whatsapp, whatsappGroup, adminEmail
 */
export async function loadNotificationSettings() {
  try {
    // Ensure settings exist
    await initializeNotificationSettings();

    const { data: configs, error } = await supabase
      .from('system_config')
      .select('key, value_text')
      .in('key', Object.values(NOTIFICATION_KEYS));

    if (error) {
      console.error('[NotificationSettings] Load error:', error);
      return DEFAULT_SETTINGS;
    }

    // Map system_config keys to notification settings keys
    const settings = { ...DEFAULT_SETTINGS };
    if (Array.isArray(configs)) {
      configs.forEach(config => {
        if (config.key === NOTIFICATION_KEYS.WHATSAPP_PHONE) {
          settings.whatsapp = config.value_text || '';
        } else if (config.key === NOTIFICATION_KEYS.WHATSAPP_GROUP) {
          settings.whatsappGroup = config.value_text || '';
        } else if (config.key === NOTIFICATION_KEYS.ADMIN_EMAIL) {
          settings.adminEmail = config.value_text || '';
        }
      });
    }

    return settings;
  } catch (err) {
    console.error('[NotificationSettings] Load error:', err);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save notification settings to system_config
 * @param {Object} settings - Settings object with whatsapp, whatsappGroup, adminEmail
 * @returns {Promise<boolean>} Success status
 */
export async function saveNotificationSettings(settings) {
  try {
    if (!settings) {
      throw new Error('Settings object is required');
    }

    // Ensure settings exist first
    await initializeNotificationSettings();

    // Update each setting
    const updates = [
      {
        key: NOTIFICATION_KEYS.WHATSAPP_PHONE,
        value_text: settings.whatsapp || ''
      },
      {
        key: NOTIFICATION_KEYS.WHATSAPP_GROUP,
        value_text: settings.whatsappGroup || ''
      },
      {
        key: NOTIFICATION_KEYS.ADMIN_EMAIL,
        value_text: settings.adminEmail || ''
      }
    ];

    for (const update of updates) {
      const { error } = await supabase
        .from('system_config')
        .update({ value_text: update.value_text })
        .eq('key', update.key);

      if (error) {
        console.error(`[NotificationSettings] Save error for ${update.key}:`, error);
        throw error;
      }
    }

    return true;
  } catch (err) {
    console.error('[NotificationSettings] Save error:', err);
    throw err;
  }
}
