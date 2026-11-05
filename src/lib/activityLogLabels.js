// Human-readable labels for the `action` / `entity_type` columns of activity_logs.
// Values come from the database, so any string may show up: known ones are translated
// (activityLog.actions / activityLog.entities), unknown ones are humanized, and a raw
// translation key or snake_case identifier is never returned.

const SAFE_KEY = /^[a-z][a-z0-9_]*$/;
const USER_MANAGEMENT_PREFIX = 'user_management_';

// 'order_submitted' -> 'Order submitted'
const humanize = (raw) => {
  const words = String(raw ?? '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const translateOrHumanize = (t, namespace, raw) => {
  const fallback = humanize(raw);
  if (!SAFE_KEY.test(raw)) return fallback;
  const label = t(`${namespace}.${raw}`, { defaultValue: fallback });
  return typeof label === 'string' ? label : fallback;
};

export const getActivityActionLabel = (t, action) => {
  const raw = String(action ?? '');
  if (raw.startsWith(USER_MANAGEMENT_PREFIX) && raw.length > USER_MANAGEMENT_PREFIX.length) {
    const detail = translateOrHumanize(t, 'activityLog.userManagementActions', raw.slice(USER_MANAGEMENT_PREFIX.length));
    return t('activityLog.userManagementAction', { detail });
  }
  return translateOrHumanize(t, 'activityLog.actions', raw);
};

export const getActivityEntityLabel = (t, entity) =>
  translateOrHumanize(t, 'activityLog.entities', String(entity ?? ''));
