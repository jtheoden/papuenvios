import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { isOwnOperation } from '@/lib/selfDealing';
import { mapTransitionError } from '@/lib/statusTransition';
import { transitionErrorKey, transitionMessage } from '@/lib/statusConflict';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

describe('isOwnOperation', () => {
  it('is true only when both ids exist and match', () => {
    expect(isOwnOperation({ user_id: 'u1' }, 'u1')).toBe(true);
    expect(isOwnOperation({ user_id: 'u1' }, 'u2')).toBe(false);
  });
  it('degrades to false when anything is missing (the server still refuses)', () => {
    expect(isOwnOperation(null, 'u1')).toBe(false);
    expect(isOwnOperation({}, 'u1')).toBe(false);
    expect(isOwnOperation({ user_id: 'u1' }, undefined)).toBe(false);
    expect(isOwnOperation({ user_id: undefined }, undefined)).toBe(false);
  });
});

describe('typed self-dealing errors', () => {
  const ctx = { entity: 'order', id: 'o1' };
  it.each(['admin_self_dealing_not_allowed', 'commission_self_adjust_not_allowed'])('%s maps to a translated key', (reason) => {
    const error = mapTransitionError({ code: '42501', message: reason }, ctx);
    expect(error.context.reason).toBe(reason);
    expect(transitionErrorKey(error)).toBe('common.statusSelfDealing');
    const t = (key) => `T:${key}`;
    expect(transitionMessage(t, error, 'fallback')).toBe('T:common.statusSelfDealing');
  });
});

describe.each([
  ['ES', ES],
  ['EN', EN]
])('%s self-dealing copy', (_name, dict) => {
  it.each(['statusSelfDealing', 'ownOperation', 'ownOperationReason'])('common.%s exists', (key) => {
    expect(typeof dict.common[key]).toBe('string');
    expect(dict.common[key].length).toBeGreaterThan(8);
  });
});

describe('copy register', () => {
  it('ES uses usted (no voseo, no tuteo) and differs from EN', () => {
    for (const key of ['statusSelfDealing', 'ownOperationReason']) {
      expect(ES.common[key]).not.toMatch(/\b(tienes|puedes|tu |vos|podés)\b/i);
      expect(ES.common[key]).not.toBe(EN.common[key]);
    }
  });
});
