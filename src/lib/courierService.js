/**
 * Client of the courier-management backend (tables couriers, messenger_payment_types, courier_margin_settings,
 * courier_accruals, delivery_assignments, courier_payments; RPCs admin_*). Admin only: the database enforces it.
 *
 * The front is deployed BEFORE the migrations are applied in production: while the objects do not exist
 * (42P01 / 42883 / PGRST202 / PGRST205) READS answer "module unavailable" (no toast, no log, no console noise) and the
 * module stops asking for 5 minutes, then tries again, so applying the migrations is picked up without a reload.
 * WRITES never degrade silently: they throw an error carrying an i18n key (`error.i18nKey`).
 */
import { supabase } from './supabase';
import { logError } from './errorHandler';
import { isBackendMissingError } from './commissionProposalRules';
import { courierErrorKey, shortId } from './courierRules';

const MISSING_RETRY_MS = 5 * 60 * 1000;
let missingAt = null;
const backendKnownMissing = () => missingAt !== null && Date.now() - missingAt < MISSING_RETRY_MS;
const markMissing = () => { missingAt = Date.now(); };
export const resetCourierBackendForTests = () => { missingAt = null; };

const toError = (error, operation) => {
  const e = new Error(error?.message || `${operation}_failed`);
  e.code = error?.code;
  e.i18nKey = courierErrorKey(error);
  // A non-admin hitting an RPC is expected (refused, not logged); nothing here carries personal data.
  if (error?.code !== '42501') logError(e, { operation });
  return e;
};

/** Runs a read; backend missing => { available:false, ...empty }. Other failures are thrown. */
const read = async (operation, run, empty) => {
  if (backendKnownMissing()) return { available: false, ...empty };
  const { data, error } = await run();
  if (error) {
    if (isBackendMissingError(error)) {
      markMissing();
      return { available: false, ...empty };
    }
    throw toError(error, operation);
  }
  return { available: true, data };
};

const write = async (operation, rpcName, args) => {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) {
    if (isBackendMissingError(error)) {
      markMissing();
      const e = new Error('courier_backend_unavailable');
      e.i18nKey = 'couriers.errors.unavailable';
      throw e;
    }
    throw toError(error, operation);
  }
  return data;
};

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

const COURIER_COLS = 'id, name, phone, notes, is_active, created_at';
const RULE_COLS = 'id, code, name, version, applies_to, method, fixed_cup, cup_per_usd, percent, base, courier_id, shipping_zone_id, remittance_type_id, amount_from, amount_to, valid_from, valid_to, is_active, created_at';
const ACCRUAL_COLS = 'id, source_kind, component, courier_id, amount_cup, amount_usd, fx_used, status, delivered_at, margin_status, payment_id, adjusts_accrual_id';

// ---------------------------------------------------------------------------------------------- reads
export const listCouriers = async () => {
  const r = await read('listCouriers', () => supabase.from('couriers').select(COURIER_COLS).order('name', { ascending: true }), { items: [] });
  return r.available ? { available: true, items: r.data || [] } : { available: false, items: [] };
};

export const listPaymentTypes = async () => {
  const r = await read('listPaymentTypes', () => supabase.from('messenger_payment_types').select(RULE_COLS).order('code', { ascending: true }).order('version', { ascending: false }), { items: [] });
  return r.available ? { available: true, items: r.data || [] } : { available: false, items: [] };
};

const toThresholds = (row) => ({
  targetPct: numOrNull(row?.target_pct), warningPct: numOrNull(row?.warning_pct), criticalPct: numOrNull(row?.critical_pct)
});

export const getMarginSettings = async () => {
  const r = await read('getMarginSettings', () => supabase.from('courier_margin_settings').select('kind, target_pct, warning_pct, critical_pct'), { settings: null });
  if (!r.available) return { available: false, settings: null };
  const byKind = Object.fromEntries((r.data || []).map((row) => [row.kind, row]));
  return { available: true, settings: { remittance: toThresholds(byKind.remittance), order: toThresholds(byKind.order) } };
};

/** Accruals by state ('calculated' = pending payment, 'paid'), newest first. */
export const listAccruals = async ({ status = 'calculated', limit = 500 } = {}) => {
  const r = await read('listAccruals', () => supabase.from('courier_accruals').select(ACCRUAL_COLS).eq('status', status).order('delivered_at', { ascending: false }).limit(limit), { items: [] });
  return r.available ? { available: true, items: r.data || [] } : { available: false, items: [] };
};

export const getCourierReport = async ({ from = null, to = null, courierId = null } = {}) => {
  const r = await read('getCourierReport', () => supabase.rpc('admin_courier_report', { p_from: from, p_to: to, p_courier_id: courierId }), { rows: [] });
  return r.available ? { available: true, rows: Array.isArray(r.data) ? r.data : [] } : { available: false, rows: [] };
};

export const listDeliveriesWithoutAccrual = async ({ from = null, to = null } = {}) => {
  const r = await read('listDeliveriesWithoutAccrual', () => supabase.rpc('admin_list_deliveries_without_accrual', { p_from: from, p_to: to }), { items: [] });
  return r.available ? { available: true, items: Array.isArray(r.data) ? r.data : [] } : { available: false, items: [] };
};

/** Active couriers for the delivery dialogs. Never throws: an unavailable module simply shows no selector. */
export const listDeliveryCouriers = async () => {
  try {
    const r = await listCouriers();
    return r.available ? r.items.filter((c) => c.is_active) : [];
  } catch {
    return [];
  }
};

/**
 * Counts of the month for the Dashboard card. thresholdsSet false => the owner has not set any threshold: no alerts.
 * Never throws (the Dashboard must not break because of this card).
 */
export const getMarginSummary = async (now = new Date()) => {
  const none = { available: false, thresholdsSet: false, counts: null };
  try {
    const s = await getMarginSettings();
    if (!s.available) return none;
    const set = ['remittance', 'order'].some((k) => s.settings[k].warningPct !== null || s.settings[k].criticalPct !== null);
    if (!set) return { available: true, thresholdsSet: false, counts: null };
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const rep = await getCourierReport({ from, to });
    if (!rep.available) return none;
    const sum = (key) => rep.rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
    return {
      available: true, thresholdsSet: true,
      counts: { warning: sum('margin_warning_count'), critical: sum('margin_critical_count'), unknown: sum('margin_unknown_count'), unknownAmount: sum('unknown_amount_count') }
    };
  } catch {
    return none;
  }
};

// Form options from existing tables (not part of the module): a failed read leaves the list empty, the form keeps working.
export const listZoneOptions = async () => {
  const { data, error } = await supabase.from('shipping_zones').select('id, province_name, municipality_name').order('province_name', { ascending: true });
  return error ? [] : (data || []).map((z) => ({ id: z.id, label: [z.province_name, z.municipality_name].filter(Boolean).join(' - ') }));
};

export const listRemittanceTypeOptions = async () => {
  const { data, error } = await supabase.from('remittance_types').select('id, name, delivery_currency').order('name', { ascending: true });
  return error ? [] : (data || []).map((r) => ({ id: r.id, label: r.name, deliveryCurrency: r.delivery_currency }));
};

// ---------------------------------------------------------------------------------------------- writes
export const upsertCourier = ({ id = null, name, phone = null, notes = null, isActive = true }) =>
  write('upsertCourier', 'admin_upsert_courier', { p_id: id, p_name: String(name ?? '').trim(), p_phone: text(phone), p_notes: text(notes), p_is_active: isActive });

/** args = buildRuleArgs(form) */
export const setPaymentType = (args) => write('setPaymentType', 'admin_set_messenger_payment_type', args);
export const deactivatePaymentType = (code) => write('deactivatePaymentType', 'admin_deactivate_messenger_payment_type', { p_code: code });

export const setMarginThresholds = (kind, { targetPct, warningPct, criticalPct }) =>
  write('setMarginThresholds', 'admin_set_margin_thresholds', {
    p_kind: kind, p_target: numOrNull(targetPct), p_warning: numOrNull(warningPct), p_critical: numOrNull(criticalPct)
  });

export const registerPayment = ({ courierId = null, accrualIds, method, reference = null, paidAt = null, notes = null }) =>
  write('registerPayment', 'admin_register_courier_payment', {
    p_courier_id: courierId, p_accrual_ids: accrualIds, p_method: String(method ?? '').trim(),
    p_reference: text(reference), p_paid_at: paidAt || null, p_notes: text(notes)
  });

export const voidAccrual = (id, reason) => write('voidAccrual', 'admin_void_accrual', { p_id: id, p_reason: String(reason ?? '').trim() });
export const adjustAccrual = (id, amountCup, reason) => write('adjustAccrual', 'admin_adjust_accrual', { p_id: id, p_amount_cup: Number(amountCup), p_reason: String(reason ?? '').trim() });
export const reassignAccrual = (id, courierId, reason) => write('reassignAccrual', 'admin_reassign_accrual', { p_id: id, p_courier_id: courierId || null, p_reason: String(reason ?? '').trim() });
export const recalculateAccrual = (id) => write('recalculateAccrual', 'admin_recalculate_accrual', { p_id: id });
export const backfillMissingAccruals = (from) => write('backfillMissingAccruals', 'admin_backfill_missing_accruals', { p_from: from });

/**
 * Sets who delivered an operation. Must run BEFORE the delivery transition (the amount is frozen at delivery).
 * No selection => nothing to do. Module not deployed yet => nothing to do (never blocks the delivery). Any other
 * failure is thrown so the caller does not confirm the delivery.
 */
export const assignDeliveryCourier = async (kind, operationId, courierId) => {
  if (!courierId) return undefined;
  try {
    await write('assignDeliveryCourier', 'admin_assign_delivery_courier', { p_kind: kind, p_id: operationId, p_courier_id: courierId });
  } catch (error) {
    if (error?.i18nKey === 'couriers.errors.unavailable') return undefined;
    error.operationRef = shortId(operationId);
    throw error;
  }
  return undefined;
};
