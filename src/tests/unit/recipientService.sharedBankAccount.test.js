/**
 * Business rule: a recipient can have several bank accounts (the holder can be anyone) and an account should NOT be
 * repeated between recipients. Linking an account another recipient already holds is stopped with a CONFLICT error that
 * carries those recipients' names, so the customer can be asked to confirm; only with an explicit confirmation is it
 * linked to both. Linking twice to the same recipient is idempotent. Retyping a saved number only reuses it when bank
 * and currency match (otherwise it is a typing mistake).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ existingAccount: null, existingLink: null, otherHolders: [], insert: null, update: null, select: null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    functions: { invoke: vi.fn(async () => ({ data: { encrypted: 'enc' }, error: null })) },
    from: vi.fn()
  }
}));

import { supabase } from '@/lib/supabase';
import { createBankAccount, linkBankAccountToRecipient, getBankAccountsByUser } from '@/lib/recipientService';

const accountInput = {
  bankId: 'bank-1',
  accountTypeId: 'type-1',
  currencyId: 'cur-usd-uuid-0000',
  accountNumber: '9225000011112222',
  accountHolderName: 'Titular Otro'
};

const bankAccountsTable = () => ({
  select: (cols) => {
    state.select?.('bank_accounts', cols);
    const chain = {
      eq: () => chain,
      is: () => chain,
      order: async () => ({ data: [], error: null }),
      single: async () => ({ data: state.existingAccount, error: null })
    };
    return chain;
  },
  insert: (rows) => {
    state.insert('bank_accounts', rows);
    return { select: () => ({ single: async () => ({ data: { id: 'acc-new' }, error: null }) }) };
  },
  update: (patch) => ({
    eq: () => {
      state.update('bank_accounts', patch);
      return { select: () => ({ single: async () => ({ data: { id: 'acc-1', ...patch }, error: null }) }) };
    }
  })
});

const linksTable = () => ({
  select: (cols) => {
    state.select?.('recipient_bank_accounts', cols);
    // the "who else holds it" lookup embeds the other recipient's name; the own-link lookup does not
    const wantsHolder = /full_name/.test(cols);
    const chain = {
      eq: () => chain,
      neq: () => chain,
      maybeSingle: async () => ({ data: state.existingLink, error: null }),
      // the "who else holds it" lookup is awaited directly and returns every other active holder
      then: wantsHolder
        ? (resolve) => resolve({ data: state.otherHolders, error: null })
        : undefined
    };
    return chain;
  },
  insert: (rows) => {
    state.insert('recipient_bank_accounts', rows);
    return { select: () => ({ single: async () => ({ data: { id: 'link-new', ...rows[0] }, error: null }) }) };
  },
  update: (patch) => {
    const chain = {
      eq: () => chain,
      select: () => ({ single: async () => ({ data: { id: 'link-1', ...patch }, error: null }) }),
      then: (resolve) => {
        state.update('recipient_bank_accounts', patch);
        resolve({ error: null });
      }
    };
    return chain;
  }
});

beforeEach(() => {
  state.existingAccount = null;
  state.existingLink = null;
  state.otherHolders = [];
  state.insert = vi.fn();
  state.update = vi.fn();
  state.select = vi.fn();
  supabase.from.mockImplementation((name) => (name === 'bank_accounts' ? bankAccountsTable() : linksTable()));
});

describe('createBankAccount: retyping a saved number', () => {
  it('returns the saved account when bank and currency match, without inserting', async () => {
    state.existingAccount = { id: 'acc-1', is_active: true, deleted_at: null, bank_id: 'bank-1', currency_id: 'cur-usd-uuid-0000' };

    await expect(createBankAccount('user-1', accountInput)).resolves.toMatchObject({ id: 'acc-1' });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['another bank', { bank_id: 'bank-2', currency_id: 'cur-usd-uuid-0000' }],
    ['another currency', { bank_id: 'bank-1', currency_id: 'cur-cup-uuid-0000' }]
  ])('does not silently reuse it when the same number is typed with %s', async (_label, differing) => {
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

const holder = (name, id = 'rec-2') => ({ recipient_id: id, recipient: { full_name: name } });

describe('linkBankAccountToRecipient: an account should not repeat between recipients', () => {
  it('stops with a conflict that names the recipients already holding it, and writes nothing', async () => {
    state.otherHolders = [holder('Ana Pérez')];

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      context: { reason: 'BANK_ACCOUNT_SHARED', recipientNames: ['Ana Pérez'] }
    });
    expect(state.insert).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('lists every recipient that holds it', async () => {
    state.otherHolders = [holder('Ana Pérez'), holder('Luis Gómez', 'rec-3')];

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).rejects.toMatchObject({
      context: { recipientNames: ['Ana Pérez', 'Luis Gómez'] }
    });
  });

  it('does not reactivate an old link of this recipient without confirmation either', async () => {
    state.existingLink = { id: 'link-1', is_active: false };
    state.otherHolders = [holder('Ana Pérez')];

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(state.update).not.toHaveBeenCalled();
  });

  it('links it to both recipients once the customer confirmed', async () => {
    state.otherHolders = [holder('Ana Pérez')];

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1', false, { confirmShared: true })).resolves.toMatchObject({ id: 'link-new' });
    expect(state.insert).toHaveBeenCalledWith('recipient_bank_accounts', [expect.objectContaining({ recipient_id: 'rec-1', bank_account_id: 'acc-1' })]);
  });

  it('reactivates this recipient\'s old link once the customer confirmed', async () => {
    state.existingLink = { id: 'link-1', is_active: false };
    state.otherHolders = [holder('Ana Pérez')];

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1', false, { confirmShared: true })).resolves.toMatchObject({ id: 'link-1', is_active: true });
  });

  it('returns the existing active link of the same recipient (idempotent, no question asked)', async () => {
    state.existingLink = { id: 'link-1', is_active: true };
    state.otherHolders = [holder('Ana Pérez')];

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).resolves.toMatchObject({ id: 'link-1' });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('reactivates this recipient\'s inactive link when nobody else holds the account', async () => {
    state.existingLink = { id: 'link-1', is_active: false };

    await expect(linkBankAccountToRecipient('rec-1', 'acc-1')).resolves.toMatchObject({ id: 'link-1', is_active: true });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('inserts a link when the account is free', async () => {
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
