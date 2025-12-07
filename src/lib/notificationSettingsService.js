import { supabase } from '@/lib/supabase';

// Las configuraciones de notificación se leen/escriben directamente en `system_config`.
// Ventajas de este enfoque:
// - Elimina la dependencia de la Edge Function ausente y evita errores de CORS.
// - Respeta el modelo de datos real (columnas `key`, `value_text`) y los defaults existentes.
// - Garantiza que los valores visibles en la UI provienen de la tabla fuente y se actualizan con `upsert`.
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

const ensureAuthenticated = async () => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('[NotificationSettings] Session error:', sessionError);
    throw new Error('No se pudo verificar tu sesión. Intenta iniciar sesión nuevamente.');
  }

  if (!sessionData?.session?.access_token) {
    throw new Error('Debes iniciar sesión para acceder a la configuración.');
  }
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
    const { data, error } = await supabase
      .from('system_config')
      .select('key, value_text')
      .in('key', Object.values(NOTIFICATION_KEYS));

    if (error) {
      console.error('[NotificationSettings] Load error:', error);
      return DEFAULT_SETTINGS;
    }

    return mapSettingsFromRows(data || []);
  } catch (err) {
    console.error('[NotificationSettings] Load error:', err);
    return DEFAULT_SETTINGS;
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
    await ensureAuthenticated();

    const now = new Date().toISOString();
    const rows = [
      {
        key: NOTIFICATION_KEYS.whatsapp,
        value_text: settings.whatsapp || '',
        updated_at: now
      },
      {
        key: NOTIFICATION_KEYS.whatsappGroup,
        value_text: settings.whatsappGroup || '',
        updated_at: now
      },
      {
        key: NOTIFICATION_KEYS.adminEmail,
        value_text: settings.adminEmail || '',
        updated_at: now
      }
    ];

    const { error } = await supabase
      .from('system_config')
      .upsert(rows, { onConflict: 'key' });

    if (error) {
      console.error('[NotificationSettings] Save error:', error);
      throw new Error('No se pudieron guardar las configuraciones.');
    }

    return true;
  } catch (err) {
    console.error('[NotificationSettings] Save error:', err);
    throw err;
  }
}

export { DEFAULT_SETTINGS };
