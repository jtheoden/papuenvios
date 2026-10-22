import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ existing: [], insertResult: null, insert: null, selectCalls: 0, update: null, updateResult: null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    functions: { invoke: vi.fn() },
    from: vi.fn()
  }
}));

import { supabase } from '@/lib/supabase';
import { createRecipient, updateRecipient } from '@/lib/recipientService';

const defaultTable = () => ({
  select: () => ({
    eq: async () => {
      state.selectCalls += 1;
      return { data: state.existing, error: null };
    }
  }),
  insert: (rows) => {
    state.insert(rows);
    return { select: () => ({ single: async () => state.insertResult }) };
  },
  update: (patch) => ({
    eq: (col, id) => {
      state.update(patch, col, id);
      return { select: () => ({ single: async () => state.updateResult(patch) }) };
    }
  })
});

const ana = { id: 'r-1', user_id: 'user-1', full_name: 'Ana Pérez', phone: '+53 5555 5555', addresses: [] };

beforeEach(() => {
  supabase.from.mockImplementation(defaultTable);
  state.existing = [];
  state.selectCalls = 0;
  state.insert = vi.fn();
  state.update = vi.fn();
  state.updateResult = (patch) => ({ data: { id: 'r-1', ...patch }, error: null });
  state.insertResult = { data: { id: 'r-new', full_name: 'Nueva', phone: '5300000000' }, error: null };
});

describe('createRecipient dedupe', () => {
  it('returns the existing recipient (normalized name + phone) without inserting', async () => {
    state.existing = [ana];
    const result = await createRecipient({ full_name: '  ana   PÉREZ ', phone: '5355555555' });

    expect(result).toMatchObject({ success: true, existing: true, recipient: { id: 'r-1' } });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('inserts when only the phone matches (a family can share a phone)', async () => {
    state.existing = [ana];
    const result = await createRecipient({ full_name: 'Luis Pérez', phone: '5355555555' });

    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, recipient: { id: 'r-new' } });
    expect(result.existing).toBeFalsy();
  });

  it('maps a 23505 on insert (race / unique index) to the existing recipient', async () => {
    state.insertResult = { data: null, error: { code: '23505', message: 'duplicate key value' } };
    // first lookup: nothing yet; after the failed insert the twin is visible
    const lookups = [[], [ana]];
    const { supabase } = await import('@/lib/supabase');
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: async () => ({ data: lookups[Math.min(state.selectCalls++, 1)], error: null }) }),
      insert: (rows) => {
        state.insert(rows);
        return { select: () => ({ single: async () => state.insertResult }) };
      }
    }));

    const result = await createRecipient({ full_name: 'Ana Pérez', phone: '5355555555' });

    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, existing: true, recipient: { id: 'r-1' } });
  });
});

describe('createRecipient existing row: non-destructive merge', () => {
  it('fills only the empty id_number / email / notes of the existing row and never overwrites present values', async () => {
    state.existing = [{ ...ana, id_number: null, email: '', notes: 'keep me' }];

    const result = await createRecipient({
      full_name: 'Ana Pérez', phone: '5355555555', id_number: '12345678901', email: 'ana@example.com', notes: 'overwrite attempt'
    });

    expect(state.insert).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledWith({ id_number: '12345678901', email: 'ana@example.com' }, 'id', 'r-1');
    expect(result).toMatchObject({
      success: true,
      existing: true,
      recipient: { id: 'r-1', id_number: '12345678901', email: 'ana@example.com', notes: 'keep me' }
    });
  });

  it('does not update when there is nothing to complete', async () => {
    state.existing = [{ ...ana, id_number: '999', email: 'old@example.com', notes: 'n' }];

    await createRecipient({ full_name: 'Ana Pérez', phone: '5355555555', id_number: '1', email: 'x@y.z', notes: 'm' });
    await createRecipient({ full_name: 'Ana Pérez', phone: '5355555555' });

    expect(state.update).not.toHaveBeenCalled();
  });
});

describe('updateRecipient unique violation', () => {
  it('maps a 23505 to a unique-violation error instead of the generic one', async () => {
    const { supabase } = await import('@/lib/supabase');
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { user_id: 'user-1' }, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }) })
    }));

    const result = await updateRecipient('r-1', { full_name: 'Ana Pérez' });

    expect(result.success).toBeFalsy();
    expect(result.code).toBe('DB_UNIQUE_VIOLATION');
  });
});
