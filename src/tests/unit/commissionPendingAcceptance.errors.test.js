import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { mapTransitionError } from '@/lib/statusTransition';
import { transitionMessage, isStatusConflictError } from '@/lib/statusConflict';

describe('submit proof refused because a commission raise is pending acceptance', () => {
  const error = mapTransitionError(
    { code: '22023', message: 'commission_pending_acceptance' },
    { entity: 'Remittance', id: 'r1' }
  );

  it('maps to a conflict with the dedicated reason (not a generic DB error)', () => {
    expect(error.code).toBe('CONFLICT');
    expect(error.context.reason).toBe('commission_pending_acceptance');
  });

  it('is not an invalid_transition status conflict (the list must not be treated as stale)', () => {
    expect(isStatusConflictError(error)).toBe(false);
  });

  it('is shown with the dedicated translated message, never the raw code', () => {
    const t = (key) => key;
    expect(transitionMessage(t, error, 'fallback')).toBe('remittances.commissionChange.errors.pendingAcceptance');
  });
});
