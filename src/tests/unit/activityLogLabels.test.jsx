import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { getActivityActionLabel, getActivityEntityLabel } from '@/lib/activityLogLabels';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// Inventory of every action/entity written by logActivity callers and by DB functions
// (activity_logs inserts in supabase/migrations). Keep in sync when a new one is added.
const STATIC_ACTIONS = [
  'create', 'update', 'delete', 'login', 'reject', 'status_change', 'validate',
  'order_created', 'order_submitted', 'order_dispatched', 'order_delivered', 'order_completed',
  'order_cancelled', 'order_reopened', 'checkout_initiated',
  'payment_proof_uploaded', 'payment_proof_upload_failed', 'payment_validated', 'payment_rejected',
  'coupon_applied', 'coupon_removed', 'coupon_validation_blocked', 'coupon_validation_failed',
  'offer_usage_recorded',
  'category_created', 'category_updated', 'category_deleted',
  'combo_created', 'combo_updated', 'combo_activated', 'combo_deactivated', 'combo_deleted',
  'product_created', 'product_updated', 'product_activated', 'product_deactivated', 'product_deleted',
  'remittance_pricing_guard_mode_changed', 'order_items_pricing_guard_mode_changed',
  'offer_id_guard_mode_changed', 'stock_policy_updated', 'stock_policy_reset',
  'bizum_settings_updated', 'payment_fx_rate_set', 'payment_method_toggled',
  'user_enabled', 'user_disabled',
  'refund_resolved', 'refund_event_failed', 'refund_capture_failed', 'refund_close_failed'
];

// UserManagement.jsx logs `user_management_${action}` for these.
const USER_MANAGEMENT_SUB_ACTIONS = [
  'delete_user_blocked_super_admin', 'delete_user_cancelled', 'delete_user_error', 'delete_user_start',
  'delete_user_success', 'edit_discount_cancelled', 'edit_discount_start', 'fetch_categories_error',
  'fetch_categories_success', 'fetch_users_error', 'fetch_users_start', 'fetch_users_success',
  'open_user_modal', 'recalculate_all_cancelled', 'recalculate_all_error', 'recalculate_all_start',
  'recalculate_all_success', 'save_discount_error', 'save_discount_start', 'save_discount_success',
  'tab_change', 'update_category_error', 'update_category_start', 'update_category_success',
  'update_role_error', 'update_role_start', 'update_role_success'
];

const ENTITIES = [
  'user', 'order', 'remittance', 'product', 'combo', 'inventory', 'offer', 'coupon', 'payment',
  'user_management', 'cart', 'category', 'system_config', 'refund_request', 'bizum_settings',
  'payment_fx_rate', 'payment_method', 'user_profile',
  // refund_capture_failed / refund_close_failed write TG_TABLE_NAME
  'orders', 'remittances'
];

const ALL_ACTIONS = [
  ...STATIC_ACTIONS,
  ...USER_MANAGEMENT_SUB_ACTIONS.map((a) => `user_management_${a}`)
];

const getT = (lang) => {
  localStorage.setItem('preferredLanguage', lang);
  return renderHook(() => useLanguage(), { wrapper: LanguageProvider }).result.current.t;
};

const isRaw = (label, raw) =>
  !label || label.includes('activityLog.') || label.includes(raw) || /[a-z]_[a-z]/.test(label);

describe.each(['es', 'en'])('activity log labels (%s)', (lang) => {
  const t = getT(lang);

  it.each(ALL_ACTIONS)('action %s has a human label', (action) => {
    const label = getActivityActionLabel(t, action);
    expect(isRaw(label, action), `${action} -> ${label}`).toBe(false);
  });

  it.each(ENTITIES)('entity %s has a human label', (entity) => {
    const label = getActivityEntityLabel(t, entity);
    expect(isRaw(label, entity), `${entity} -> ${label}`).toBe(false);
  });

  it('humanizes an unknown action instead of showing a raw key', () => {
    const label = getActivityActionLabel(t, 'brand_new_thing');
    expect(label).toBe('Brand new thing');
  });

  it('humanizes an unknown entity instead of showing a raw key', () => {
    expect(getActivityEntityLabel(t, 'weird_entity')).toBe('Weird entity');
  });

  it('labels an unknown user_management_* action with the generic prefix', () => {
    const label = getActivityActionLabel(t, 'user_management_export_csv_start');
    expect(label).toContain('Export csv start');
    expect(label).not.toContain('user_management');
    expect(label).not.toContain('activityLog.');
  });

  it('survives empty and prototype-like values', () => {
    for (const v of [null, undefined, '', 'constructor', '__proto__', 'a.b.c']) {
      const a = getActivityActionLabel(t, v);
      const e = getActivityEntityLabel(t, v);
      expect(typeof a).toBe('string');
      expect(typeof e).toBe('string');
      expect(a).not.toContain('activityLog.');
      expect(e).not.toContain('activityLog.');
    }
  });
});

describe('activity log translations', () => {
  it('has translated labels in both languages for the whole inventory', () => {
    for (const [name, dict] of [['ES', ES], ['EN', EN]]) {
      const actions = dict.activityLog.actions;
      const entities = dict.activityLog.entities;
      for (const a of STATIC_ACTIONS) expect(actions[a], `${name} action ${a}`).toBeTruthy();
      for (const e of ENTITIES) expect(entities[e], `${name} entity ${e}`).toBeTruthy();
      for (const s of USER_MANAGEMENT_SUB_ACTIONS) {
        expect(dict.activityLog.userManagementActions[s], `${name} um ${s}`).toBeTruthy();
      }
    }
  });

  it('keeps ES and EN activityLog keys and placeholders in parity', () => {
    const flatten = (obj, prefix = '') =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]]
      );
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const es = Object.fromEntries(flatten(ES.activityLog));
    const en = Object.fromEntries(flatten(EN.activityLog));
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(es)) {
      expect(es[k].trim(), `ES ${k}`).not.toBe('');
      expect(en[k].trim(), `EN ${k}`).not.toBe('');
      expect(ph(es[k]), k).toEqual(ph(en[k]));
    }
  });
});
