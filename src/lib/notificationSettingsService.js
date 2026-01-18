import { supabase } from '@/lib/supabase';

// Las configuraciones de notificación están protegidas por RLS y se gestionan
// a través de la Edge Function `notification-settings`, que usa la service role.
// Este servicio obtiene el token del usuario, invoca la función con CORS y
// devuelve errores manejables cuando la función no está disponible.
const DEFAULT_SETTINGS = {
  whatsapp: '',
  whatsappGroup: '',
  adminEmail: '',
  whatsappTarget: 'whatsapp'
};

const NOTIFICATION_KEYS = {
  whatsapp: 'whatsapp_admin_phone',
  whatsappGroup: 'whatsapp_group',
  adminEmail: 'admin_email',
  whatsappTarget: 'whatsapp_target'
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
      Authorization: `Bearer ${accessToken}`
    }
  };

  // Para métodos que envían body, pasamos el objeto directamente
  // El SDK de Supabase se encarga de serializar y establecer Content-Type
  if (method !== 'GET' && payload) {
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
    adminEmail: getValue(NOTIFICATION_KEYS.adminEmail),
    whatsappTarget: getValue(NOTIFICATION_KEYS.whatsappTarget) || 'whatsapp'
  };
};

const mapSettingsFromTable = (rows = []) => {
  const getValue = (key) => rows.find((row) => row.setting_type === key)?.value ?? '';

  return {
    whatsapp: getValue(NOTIFICATION_KEYS.whatsapp),
    whatsappGroup: getValue(NOTIFICATION_KEYS.whatsappGroup),
    adminEmail: getValue(NOTIFICATION_KEYS.adminEmail),
    whatsappTarget: getValue(NOTIFICATION_KEYS.whatsappTarget)
  };
};

const resolveWhatsappTarget = (settings) => {
  if (settings?.whatsappTarget) {
    return settings.whatsappTarget;
  }
  if (settings?.whatsappGroup && !settings?.whatsapp) {
    return 'whatsappGroup';
  }
  return 'whatsapp';
};

const loadNotificationSettingsFromTable = async () => {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('setting_type, value, is_active')
    .in('setting_type', Object.values(NOTIFICATION_KEYS));

  if (error) {
    throw error;
  }

  const settings = mapSettingsFromTable(data || []);
  return {
    ...settings,
    whatsappTarget: resolveWhatsappTarget(settings)
  };
};

/**
 * Load notification settings from system_config table
 * @returns {Promise<Object>} Settings object with whatsapp, whatsappGroup, adminEmail
 */
export async function loadNotificationSettings() {
  try {
    const settings = await loadNotificationSettingsFromTable();
    if (settings.whatsapp || settings.whatsappGroup || settings.adminEmail) {
      return settings;
    }
  } catch (err) {
    console.warn('[NotificationSettings] Table load failed, falling back to function:', err);
  }

  const data = await callNotificationFunction('GET');
  if (Array.isArray(data)) {
    const mapped = mapSettingsFromRows(data);
    return {
      ...mapped,
      whatsappTarget: resolveWhatsappTarget(mapped)
    };
  }

  const mapped = {
    whatsapp: data?.whatsapp ?? '',
    whatsappGroup: data?.whatsappGroup ?? '',
    adminEmail: data?.adminEmail ?? '',
    whatsappTarget: data?.whatsappTarget ?? ''
  };
  return {
    ...mapped,
    whatsappTarget: resolveWhatsappTarget(mapped)
  };
}

/**
 * Save notification settings into notification_settings and sync system_config when available
 * @param {Object} settings - Settings object with whatsapp, whatsappGroup, adminEmail
 * @returns {Promise<boolean>} Success status
 */
export async function saveNotificationSettings(settings) {
  if (!settings) {
    throw new Error('Debes proporcionar configuraciones para guardar.');
  }

  try {
    const payload = {
      whatsapp: settings.whatsapp || '',
      whatsappGroup: settings.whatsappGroup || '',
      adminEmail: settings.adminEmail || '',
      whatsappTarget: resolveWhatsappTarget(settings)
    };

    const { error } = await supabase
      .from('notification_settings')
      .upsert([
        { setting_type: NOTIFICATION_KEYS.whatsapp, value: payload.whatsapp, is_active: true },
        { setting_type: NOTIFICATION_KEYS.whatsappGroup, value: payload.whatsappGroup, is_active: true },
        { setting_type: NOTIFICATION_KEYS.adminEmail, value: payload.adminEmail, is_active: true },
        { setting_type: NOTIFICATION_KEYS.whatsappTarget, value: payload.whatsappTarget, is_active: true }
      ], { onConflict: 'setting_type' });

    if (error) {
      throw error;
    }

    try {
      await callNotificationFunction('PUT', payload);
    } catch (syncError) {
      console.warn('[NotificationSettings] Edge function sync failed:', syncError);
    }
    return true;
  } catch (err) {
    console.error('[NotificationSettings] Save error:', err);
    throw err;
  }
}

export const getActiveWhatsappRecipient = (settings = {}) => {
  const target = resolveWhatsappTarget(settings);
  if (target === 'whatsappGroup' && settings.whatsappGroup) {
    return settings.whatsappGroup;
  }
  return settings.whatsapp || settings.whatsappGroup || '';
};

/**
 * Fetch fresh notification settings directly from the database (bypasses cache)
 * Use this function when you need the most up-to-date settings (e.g., before sending notifications)
 * @returns {Promise<Object>} Fresh settings object with whatsapp, whatsappGroup, adminEmail, whatsappTarget
 */
export async function getFreshNotificationSettings() {
  try {
    // Always fetch fresh from notification_settings table (primary source of truth)
    const { data, error } = await supabase
      .from('notification_settings')
      .select('setting_type, value, is_active')
      .in('setting_type', Object.values(NOTIFICATION_KEYS));

    if (error) {
      console.error('[NotificationSettings] Fresh fetch error:', error);
      throw error;
    }

    if (data && data.length > 0) {
      const settings = mapSettingsFromTable(data);
      return {
        ...settings,
        whatsappTarget: resolveWhatsappTarget(settings)
      };
    }

    // Fallback: return defaults if no data found
    console.warn('[NotificationSettings] No settings found in notification_settings table');
    return { ...DEFAULT_SETTINGS };
  } catch (err) {
    console.error('[NotificationSettings] getFreshNotificationSettings error:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Get the active WhatsApp recipient from fresh database data (bypasses all caches)
 * Use this when sending critical notifications to ensure correct recipient
 * @returns {Promise<string>} The phone number or group URL to send notifications to
 */
export async function getFreshWhatsappRecipient() {
  const settings = await getFreshNotificationSettings();
  return getActiveWhatsappRecipient(settings);
}

export { DEFAULT_SETTINGS };
