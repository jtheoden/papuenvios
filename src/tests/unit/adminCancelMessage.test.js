/**
 * Toast text for a failed admin cancel: always a translated key, never the raw RPC / PostgREST message.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { adminCancelMessage } from '@/lib/statusConflict';
import { AppError, ERROR_CODES, createValidationError, parseSupabaseError } from '@/lib/errorHandler';
import { mapTransitionError } from '@/lib/statusTransition';

const t = (key) => key;
const target = { entity: 'Remittance', id: 'r1' };

describe('adminCancelMessage', () => {
  it('invalid_transition (the customer uploaded a proof meanwhile) -> status changed, reload', () => {
    const error = mapTransitionError({ code: '22023', message: 'invalid_transition', details: '{"status":"payment_proof_uploaded"}' }, target);
    expect(adminCancelMessage(t, error)).toBe('common.statusConflict');
  });

  it('invalid_argument (reason) -> reason message', () => {
    expect(adminCancelMessage(t, mapTransitionError({ code: '22023', message: 'invalid_argument', details: 'reason' }, target)))
      .toBe('remittances.admin.cancelReasonInvalid');
    expect(adminCancelMessage(t, createValidationError({ reason: 'x' }))).toBe('remittances.admin.cancelReasonInvalid');
  });

  it('PGRST202 (RPC not deployed yet) -> unavailable message', () => {
    const error = mapTransitionError({ code: 'PGRST202', message: 'Could not find the function public.remittance_admin_cancel' }, target);
    expect(adminCancelMessage(t, error)).toBe('remittances.admin.cancelUnavailable');
  });

  it('42501 keeps the shared forbidden key; anything else -> generic cancel failure, not the raw message', () => {
    expect(adminCancelMessage(t, mapTransitionError({ code: '42501', message: 'not_authorized' }, target))).toBe('common.statusNotAuthorized');
    expect(adminCancelMessage(t, new AppError('raw boom', ERROR_CODES.DB_ERROR, 500))).toBe('remittances.admin.cancelFailed');
    expect(adminCancelMessage(t, parseSupabaseError({ code: 'XX000', message: 'raw boom' }))).toBe('remittances.admin.cancelFailed');
    expect(adminCancelMessage(t, undefined)).toBe('remittances.admin.cancelFailed');
  });
});
