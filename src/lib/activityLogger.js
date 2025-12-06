import { supabase } from '@/lib/supabase';

const safeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return null;
  try {
    const sanitized = JSON.parse(JSON.stringify(metadata));
    return sanitized;
  } catch (error) {
    console.warn('[activityLogger] Failed to serialize metadata', error);
    return null;
  }
};

export const logActivity = async ({
  action,
  entityType,
  entityId = null,
  performedBy,
  description = '',
  metadata = null
}) => {
  try {
    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData?.session) {
      console.warn('[activityLogger] Skipping log - no active session');
      return;
    }

    if (!action || !entityType) {
      console.warn('[activityLogger] Missing required fields', { action, entityType });
      return;
    }

    const payload = {
      action,
      entity_type: entityType,
      entity_id: entityId,
      performed_by: performedBy || 'anonymous',
      description,
      metadata: safeMetadata(metadata),
      created_at: new Date().toISOString()
    };

    const { error } = await supabase.from('activity_logs').insert([payload]);

    if (error) {
      // Avoid noisy logs if RLS blocks the request
      if (error.code === '42501') {
        console.warn('[activityLogger] Permission denied when inserting activity');
        return;
      }
      console.warn('[activityLogger] Failed to insert activity', error.message);
    }
  } catch (error) {
    console.warn('[activityLogger] Unexpected error while logging activity', error);
  }
};

export const fetchActivityLogs = async ({ search = '', type = 'all', entity = 'all', limit = 200 } = {}) => {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      console.warn('[activityLogger] Skipping fetch - no active session');
      return [];
    }

    let query = supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(limit);

    if (type !== 'all') {
      query = query.eq('action', type);
    }

    if (entity !== 'all') {
      query = query.eq('entity_type', entity);
    }

    if (search) {
      query = query.or(`description.ilike.%${search}%,performed_by.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[activityLogger] Error fetching activity logs', error.message);
      return [];
    }

    return data || [];
  } catch (error) {
    console.warn('[activityLogger] Unexpected error fetching logs', error);
    return [];
  }
};
