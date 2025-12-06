/**
 * Notification Settings Service
 * Manages notification settings stored in system_config table via Edge Function
 * - WhatsApp admin phone
 * - WhatsApp group URL
 * - Admin email
 */

import { supabase } from '@/lib/supabase';

const NOTIFICATION_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notification-settings`;

const DEFAULT_SETTINGS = {
  whatsapp: '',
  whatsappGroup: '',
  adminEmail: ''
};

async function callNotificationSettings(method = 'GET', payload) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('[NotificationSettings] Session error:', sessionError);
    throw new Error('No se pudo verificar tu sesión. Intenta iniciar sesión nuevamente.');
  }

  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    throw new Error('Debes iniciar sesión para acceder a la configuración.');
  }

  const response = await fetch(NOTIFICATION_ENDPOINT, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || 'No se pudieron procesar las configuraciones.';
    console.error('[NotificationSettings] API error:', { status: response.status, message, data });
    throw new Error(message);
  }

  return data;
}

/**
 * Load notification settings from Edge Function
 * @returns {Promise<Object>} Settings object with whatsapp, whatsappGroup, adminEmail
 */
export async function loadNotificationSettings() {
  try {
    const data = await callNotificationSettings('GET');
    return {
      whatsapp: data.whatsapp ?? '',
      whatsappGroup: data.whatsappGroup ?? '',
      adminEmail: data.adminEmail ?? ''
    };
  } catch (err) {
    console.error('[NotificationSettings] Load error:', err);
    throw err;
  }
}

/**
 * Save notification settings via Edge Function
 * @param {Object} settings - Settings object with whatsapp, whatsappGroup, adminEmail
 * @returns {Promise<boolean>} Success status
 */
export async function saveNotificationSettings(settings) {
  if (!settings) {
    throw new Error('Debes proporcionar configuraciones para guardar.');
  }

  try {
    await callNotificationSettings('PUT', {
      whatsapp: settings.whatsapp || '',
      whatsappGroup: settings.whatsappGroup || '',
      adminEmail: settings.adminEmail || ''
    });
    return true;
  } catch (err) {
    console.error('[NotificationSettings] Save error:', err);
    throw err;
  }
}

export { DEFAULT_SETTINGS };
