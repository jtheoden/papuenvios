/**
 * One bank account can serve several recipients of the same customer: typing a number that is already
 * saved reuses that account (instead of "already registered"), and linking twice to the same recipient
 * is idempotent. getBankAccountsByUser feeds the "use one of my accounts" list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ existingAccount: null, existingLink: null, insert: null, update: null, select: null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    functions: { invoke: vi.fn(async () => ({ data: { ciphertext: 'enc' }, error: null })) },
    from: vi.fn()
  }
}));

import { supabase } from '@/lib/supabase';
import { createBankAccount, linkBankAccountToRecipient, getBankAccountsByUser } from '@/lib/recipientService';

const accountInput = {
  bankId: 'bank-1',
  accountTypeId: 'type-1',
  currencyId: 'cur-usd-uuid-0000',
  accountNumber: '9225 0000 1111 2222'.replace(/\s/g, ''),
  accountHolderName: 'Titular Otro'
};

const table = (name) => {
  if (name === 'bank_accounts') {
    return {
      select: (cols) => {
        state.select?.(name, cols);
        const chain = {
          eq: () => chain,
          is: () => chain,
          order: async () => ({ data: [], error: null }),
          single: async () => ({ data: state.existingAccount, error: null })
        };
        return chain;
      },
      insert: (rows) => {
        state.insert(name, rows);
        return { select: () => ({ single: async () => ({ data: { id: 'acc-new' }, error: null }) }) };
      },
      update: (patch) => ({
        eq: () => {
          state.update(name, patch);
          return { select: () => ({ single: async () => ({ data: { id: 'acc-1', ...patch }, error: null }) }) };
        }
      })
    };
  }
  // recipient_bank_accounts
  return {
    select: () => {
      const chain = { eq: () => chain, maybeSingle: async () => ({ data: state.existingLink, error: null }) };
      return chain;
    },
    insert: (rows) => {
      state.insert(name, rows);
      return { select: () => ({ single: async () => ({ data: { id: 'link-new', ...rows[0] }, error: null }) }) };
    },
    update: (patch) => {
      const chain = {
        eq: () => chain,
        select: () => ({ single: async () => ({ data: { id: 'link-1', ...patch }, error: null }) }),
        then: (resolve) => {
          state.update(name, patch);
          resolve({ error: null });
        }
      };
      return chain;
    }
  };
};

beforeEach(() => {
  state.existingAccount = null;
  state.existingLink = null;
  state.insert = vi.fn();
  state.update = vi.fn();
  state.select = vi.fn();
  supabase.from.mockImplementation(table);
});

describe('createBankAccount reuses an account the customer already saved', () => {
  it('returns the existing active account instead of failing as duplicate, without inserting', async () => {
    state.existingAccount = { id: 'acc-1', is_active: true, deleted_at: null, bank_id: 'bank-1', currency_id: 'cur-usd-uuid-0000' };

    await expect(createBankAccount('user-1', accountInput)).resolves.toMatchObject({ id: 'acc-1' });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['another bank', { bank_id: 'bank-2', currency_id: 'cur-usd-uuid-0000' }],
    ['another currency', { bank_id: 'bank-1', currency_id: 'cur-cup-uuid-0000' }]
  ])('does not silently reuse the saved account when the same number is typed with %s', async (_label, differing) => {
    state.existingAccount = { id: 'acc-1', is_active: true, deleted_at: null, ...differing };

    await expect(createBankAccount('user-1', accountInput)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      context: { fieldErrors: { accountNumber: expect.any(String) } }
    });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('still creates the account when the number is new', async () => {
    await expect(createBankAccount('user-1', accountInput)).resolves.toMatchObject({ id: 'acc-new' });
    expect(state.insert).toHaveBeenCalledWith('bank_accounts', [expect.objectContaining({ user_id: 'user-1' })]);
  });
});

describe('linkBankAccountToRecipient is idempotent', () => {
  it('returns the existing active link and does not insert a second one', async () => {
    state.existingLink = { id: 'link-1', is_active: true };

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).resolves.toMatchObject({ id: 'link-1' });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('reactivates an inactive link instead of hitting the unique constraint', async () => {
    state.existingLink = { id: 'link-1', is_active: false };

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).resolves.toMatchObject({ id: 'link-1', is_active: true });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('inserts a link when the recipient does not have it yet', async () => {
    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).resolves.toMatchObject({ id: 'link-new' });
    expect(state.insert).toHaveBeenCalledWith('recipient_bank_accounts', [expect.objectContaining({ recipient_id: 'rec-1', bank_account_id: 'acc-1' })]);
  });
});

describe('getBankAccountsByUser', () => {
  it('selects columns that exist: currencies has name_es/name_en, not name', async () => {
    await getBankAccountsByUser('user-1');

    const [, cols] = state.select.mock.calls[0];
    expect(cols).toMatch(/currencies/);
    expect(cols).not.toMatch(/currencies[^)]*\bname\b(?!_)/);
    expect(cols).toMatch(/code/);
  });
});
