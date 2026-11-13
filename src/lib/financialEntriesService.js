/**
 * Manual financial entries (super admin): incomes and expenses that add to or subtract from the dashboard net profit.
 * Writes go through SECURITY DEFINER RPCs; the table is read-only for clients (RLS: super admin only).
 */
import { supabase } from './supabase';
import { handleError, createValidationError, parseSupabaseError, ERROR_CODES } from './errorHandler';
import { validateFinancialEntry, businessToday } from './financialEntryRules';
import { fetchAllRows } from './fetchAllRows';
import { REASON_MIN_LENGTH, REASON_MAX_LENGTH } from './commissionOverrideRules';

const run = async (operation, call) => {
  try {
    const { data, error } = await call();
    if (error) throw parseSupabaseError(error);
    return data;
  } catch (error) {
    if (error.code) throw error;
    throw handleError(error, ERROR_CODES.DB_ERROR, { operation });
  }
};

export const listFinancialEntries = () =>
  run('listFinancialEntries', () =>
    fetchAllRows((from, to) =>
      supabase
        .from('financial_entries')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)
    )
  ).then((rows) => rows || []);

export const addFinancialEntry = async (values) => {
  const errors = validateFinancialEntry(values, businessToday());
  if (Object.keys(errors).length > 0) throw createValidationError(errors, 'Invalid financial entry');
  return run('addFinancialEntry', () =>
    supabase.rpc('superadmin_add_financial_entry', {
      p_kind: values.kind,
      p_amount: Number(values.amount),
      p_entry_date: values.entryDate,
      p_category: String(values.category || '').trim(),
      p_reason: String(values.reason).trim()
    })
  );
};

export const voidFinancialEntry = async (entryId, reason) => {
  const length = String(reason || '').trim().length;
  if (!entryId || length < REASON_MIN_LENGTH || length > REASON_MAX_LENGTH) {
    throw createValidationError({ entryId: entryId ? undefined : 'required', reason: 'length' }, 'Invalid void request');
  }
  return run('voidFinancialEntry', () =>
    supabase.rpc('superadmin_void_financial_entry', { p_entry_id: entryId, p_reason: String(reason).trim() })
  );
};
