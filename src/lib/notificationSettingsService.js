import { supabase } from '@/lib/supabase';

// Las configuraciones de notificación están protegidas por RLS y se gestionan
// a través de la Edge Function `notification-settings`, que usa la service role.
// Este servicio obtiene el token del usuario, invoca la función con CORS y
// devuelve errores manejables cuando la función no está disponible.
const DEFAULT_SETTINGS = {
  whatsapp: '',
  whatsappGroup: '',
  adminEmail: ''
};

const NOTIFICATION_KEYS = {
  whatsapp: 'whatsapp_admin_phone',
  whatsappGroup: 'whatsapp_group',
  adminEmail: 'admin_email'
};

const getSessionToken = async () => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('[NotificationSettings] Session error:', sessionError);
    throw new Error('No se pudo verificar tu sesión. Intenta iniciar sesión nuevamente.');
  }

  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Debes iniciar sesión para acceder a la configuración.');
  }

  return token;
};

const callNotificationFunction = async (method, payload) => {
  const accessToken = await getSessionToken();

  const invokeOptions = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };

  if (method !== 'GET') {
    invokeOptions.body = payload;
  }

  const { data, error } = await supabase.functions.invoke('notification-settings', invokeOptions);

  if (error) {
    console.error(`[NotificationSettings] Function error (${method})`, error);
    const isNetworkOrCors =
      error?.name === 'FunctionsFetchError' ||
      error?.message?.includes('Failed to send a request');

    const message = isNetworkOrCors
      ? 'No se pudo contactar la función de notificaciones. Verifica tu conexión o los permisos de CORS.'
      : (error?.message || 'No se pudieron procesar las configuraciones.');

    throw new Error(message);
  }

  // Edge function may respond with { message } for success cases
  return data;
};

const mapSettingsFromRows = (rows = []) => {
  const getValue = (key) => rows.find((row) => row.key === key)?.value_text ?? '';

  return {
    whatsapp: getValue(NOTIFICATION_KEYS.whatsapp),
    whatsappGroup: getValue(NOTIFICATION_KEYS.whatsappGroup),
    adminEmail: getValue(NOTIFICATION_KEYS.adminEmail)
  };
};

/**
 * Load notification settings from system_config table
 * @returns {Promise<Object>} Settings object with whatsapp, whatsappGroup, adminEmail
 */
export async function loadNotificationSettings() {
  try {
    const data = await callNotificationFunction('GET');
    // If edge function returns array-like fallback, map it; otherwise expect object with fields
    if (Array.isArray(data)) {
      return mapSettingsFromRows(data);
    }
    return {
      whatsapp: data?.whatsapp ?? '',
      whatsappGroup: data?.whatsappGroup ?? '',
      adminEmail: data?.adminEmail ?? ''
    };
  } catch (err) {
    console.error('[NotificationSettings] Load error:', err);
    throw err;
  }
}

/**
 * Save notification settings directly into system_config
 * @param {Object} settings - Settings object with whatsapp, whatsappGroup, adminEmail
 * @returns {Promise<boolean>} Success status
 */
export async function saveNotificationSettings(settings) {
  if (!settings) {
    throw new Error('Debes proporcionar configuraciones para guardar.');
  }

  try {
    await callNotificationFunction('PUT', {
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
