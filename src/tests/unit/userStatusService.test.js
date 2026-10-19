import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

import {
  setUserEnabled,
  classifyUserStatusError,
  USER_STATUS_ERROR,
  USER_DISABLE_REASON_MIN,
  USER_DISABLE_REASON_MAX,
  UserStatusError
} from '@/lib/userStatusService';

const USER_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => rpc.mockReset());

describe('classifyUserStatusError', () => {
  it.each([
    [{ message: 'insufficient_privilege', code: '42501' }, USER_STATUS_ERROR.FORBIDDEN],
    [{ message: 'user_disable_self' }, USER_STATUS_ERROR.SELF],
    [{ message: 'user_disable_last_super_admin' }, USER_STATUS_ERROR.LAST_SUPER_ADMIN],
    [{ message: 'user_disable_reason_required' }, USER_STATUS_ERROR.REASON_REQUIRED],
    [{ message: 'user_disable_reason_too_long' }, USER_STATUS_ERROR.REASON_TOO_LONG],
    [{ message: 'user_not_found' }, USER_STATUS_ERROR.NOT_FOUND],
    [{ message: 'boom' }, USER_STATUS_ERROR.UNKNOWN],
    [null, USER_STATUS_ERROR.UNKNOWN]
  ])('maps %j to %s', (error, kind) => {
    expect(classifyUserStatusError(error)).toBe(kind);
  });
});

describe('setUserEnabled', () => {
  it('disables through the RPC with a trimmed reason', async () => {
    rpc.mockResolvedValue({ data: { changed: true, is_enabled: false }, error: null });
    const result = await setUserEnabled(USER_ID, false, '  chargeback abuse  ');
    expect(rpc).toHaveBeenCalledWith('set_user_enabled', {
      p_user_id: USER_ID,
      p_enabled: false,
      p_reason: 'chargeback abuse'
    });
    expect(result).toEqual({ changed: true, is_enabled: false });
  });

  it('enables without sending a reason', async () => {
    rpc.mockResolvedValue({ data: { changed: true, is_enabled: true }, error: null });
    await setUserEnabled(USER_ID, true);
    expect(rpc).toHaveBeenCalledWith('set_user_enabled', { p_user_id: USER_ID, p_enabled: true, p_reason: null });
  });

  it('rejects locally, without a round trip, when the reason is out of range', async () => {
    await expect(setUserEnabled(USER_ID, false, ' ab ')).rejects.toMatchObject({
      kind: USER_STATUS_ERROR.REASON_REQUIRED
    });
    await expect(setUserEnabled(USER_ID, false, 'x'.repeat(USER_DISABLE_REASON_MAX + 1))).rejects.toMatchObject({
      kind: USER_STATUS_ERROR.REASON_TOO_LONG
    });
    expect(USER_DISABLE_REASON_MIN).toBe(3);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws a typed error carrying the kind returned by the database', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'user_disable_self', code: '22023' } });
    const error = await setUserEnabled(USER_ID, false, 'some reason').catch((e) => e);
    expect(error).toBeInstanceOf(UserStatusError);
    expect(error.kind).toBe(USER_STATUS_ERROR.SELF);
  });
});
