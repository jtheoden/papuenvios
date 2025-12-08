import { supabase } from '@/lib/supabase';

const STORAGE_KEY = 'pending_activity_logs';
const MAX_QUEUE_SIZE = 100;

const logMetric = (event, payload = {}) => {
  console.info(`[activityLogger][metric] ${event}`, payload);
};

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

const isValidUUID = (value) => {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);
};

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const readQueue = () => {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.warn('[activityLogger] Failed to read queue', error);
    return [];
  }
};

const writeQueue = (items) => {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn('[activityLogger] Failed to persist queue', error);
  }
};

const enqueuePayload = (payload, reason = 'pending') => {
  const queue = readQueue();
  const enrichedPayload = { ...payload, _queued_at: new Date().toISOString(), _queue_reason: reason };

  queue.push(enrichedPayload);

  if (queue.length > MAX_QUEUE_SIZE) {
    const trimmed = queue.slice(queue.length - MAX_QUEUE_SIZE);
    logMetric('queue_trimmed', { removed: queue.length - trimmed.length, reason });
    writeQueue(trimmed);
    return;
  }

  writeQueue(queue);
}; 

const resolveActor = (providedActor, sessionData) => {
  const sessionUser = sessionData?.session?.user;
  const sessionActor = sessionUser?.email || sessionUser?.id;
  const sessionUserId = sessionUser?.id;

  const isPlaceholder = !providedActor || ['anonymous', 'vendor_panel'].includes(providedActor);

  // If the caller provided an explicit actor that doesn't match the active session, avoid misattribution
  if (sessionActor && providedActor && !isPlaceholder && providedActor !== sessionActor) {
    return {
      actor: sessionActor,
      actorSource: 'session_override',
      originalActor: providedActor,
      sessionUserId
    };
  }

  // Prefer explicit actor unless it is a known placeholder
  if (providedActor && !isPlaceholder) {
    return { actor: providedActor, actorSource: 'explicit', sessionUserId };
  }

  // Fall back to current session identity when available
  if (sessionActor) {
    return { actor: sessionActor, actorSource: 'session', sessionUserId };
  }

  return { actor: providedActor || 'anonymous', actorSource: 'placeholder', sessionUserId: null };
};

const buildPayload = ({ action, entityType, entityId, performedBy, description, metadata }) => {
  const metadataPayload = safeMetadata(metadata) || {};

  // `entity_id` is a UUID column. If the caller passes a non-UUID (e.g., an offer code),
  // keep it in metadata to avoid insert failures while preserving context.
  let entityIdValue = entityId;
  if (entityId && !isValidUUID(entityId)) {
    metadataPayload._entity_id_fallback = entityId;
    entityIdValue = null;
  }

  return {
    action,
    entity_type: entityType,
    entity_id: entityIdValue,
    performed_by: performedBy || 'anonymous',
    description,
    metadata: Object.keys(metadataPayload).length > 0 ? metadataPayload : null,
    created_at: new Date().toISOString()
  };
};

export const flushQueuedActivityLogs = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    logMetric('flush_skipped_no_session');
    return false;
  }

  const queued = readQueue();
  if (!queued.length) {
    logMetric('flush_noop_empty_queue');
    return true;
  }

  logMetric('flush_started', { queued: queued.length });

  const sessionActor = sessionData.session.user?.email || sessionData.session.user?.id;
  const sessionUserId = sessionData.session.user?.id;

  const payloads = queued.map(({ _queue_reason, _queued_at, _queued_session_user_id, _actor_source, _original_actor, performed_by, ...rest }) => {
    const isPlaceholder = !performed_by || ['anonymous', 'vendor_panel'].includes(performed_by);
    const sessionMatchesQueue = _queued_session_user_id && sessionUserId
      ? _queued_session_user_id === sessionUserId
      : false;

    const shouldUseSessionActor = isPlaceholder && sessionActor && sessionMatchesQueue;

    return {
      ...rest,
      performed_by: shouldUseSessionActor
        ? sessionActor
        : performed_by || 'anonymous'
    };
  });

  const { error } = await supabase.from('activity_logs').insert(payloads);

  if (error) {
    if (error.code === '42501') {
      console.warn('[activityLogger] Permission denied when flushing queued activities');
    } else {
      console.warn('[activityLogger] Failed to flush queued activities', error.message);
    }
    logMetric('flush_failed', { queued: queued.length, code: error.code || 'unknown' });
    return false;
  }

  writeQueue([]);
  logMetric('flush_success', { inserted: queued.length });
  return true;
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
    if (!action || !entityType) {
      console.warn('[activityLogger] Missing required fields', { action, entityType });
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const resolvedActorInfo = resolveActor(performedBy, sessionData);
    const payload = buildPayload({ action, entityType, entityId, performedBy: resolvedActorInfo.actor, description, metadata });

    const queueMetadata = {
      _queued_session_user_id: resolvedActorInfo.sessionUserId || null,
      _actor_source: resolvedActorInfo.actorSource,
      _original_actor: resolvedActorInfo.originalActor
    };

    if (!sessionData?.session) {
      console.warn('[activityLogger] No active session, queueing activity');
      enqueuePayload({ ...payload, ...queueMetadata }, 'no_session');
      logMetric('queued', { reason: 'no_session' });
      return;
    }

    const { error } = await supabase.from('activity_logs').insert([payload]);

    if (error) {
      // Avoid noisy logs if RLS blocks the request
      if (error.code === '42501') {
        console.warn('[activityLogger] Permission denied when inserting activity');
        enqueuePayload({ ...payload, ...queueMetadata }, 'rls_denied');
        logMetric('queued', { reason: 'rls_denied' });
        return;
      }
      console.warn('[activityLogger] Failed to insert activity, queued for retry', error.message);
      enqueuePayload({ ...payload, ...queueMetadata }, 'insert_error');
      logMetric('queued', { reason: 'insert_error' });
      return;
    }

    // Best-effort flush of any pending entries once the current insert succeeded
    flushQueuedActivityLogs();
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
