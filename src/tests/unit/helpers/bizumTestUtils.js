import { vi } from 'vitest';

/** Echo translator: key plus serialized params, so tests can assert interpolated numbers. */
export const tEcho = (key, params = {}) => {
  const entries = Object.entries(params || {});
  return entries.length ? `${key} ${entries.map(([k, v]) => `${k}=${v}`).join(' ')}` : key;
};

/** Thenable query builder resolving to `result` (mimics a supabase-js filter chain). */
export const queryChain = (result) => {
  const builder = {};
  ['select', 'insert', 'update', 'eq', 'order', 'in', 'limit'].forEach((m) => {
    builder[m] = vi.fn(() => builder);
  });
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
};

/** Realistic PostgREST / Postgres error shapes. */
export const PG_ERRORS = {
  missingFunction: {
    code: 'PGRST202',
    message: 'Could not find the function public.get_bizum_settings without parameters in the schema cache',
    details: null
  },
  missingTable: {
    code: 'PGRST205',
    message: "Could not find the table 'public.bizum_accounts' in the schema cache",
    details: null
  },
  missingRelation: { code: '42P01', message: 'relation "public.bizum_accounts" does not exist', details: null },
  rls: { code: '42501', message: 'new row violates row-level security policy for table "bizum_accounts"', details: null },
  raise: (token, details = null, code = 'P0001') => ({ code, message: token, details }),
  phoneDuplicate: (phone) => ({
    code: '23505',
    message: 'duplicate key value violates unique constraint "bizum_accounts_phone_key"',
    details: `Key (phone)=(${phone}) already exists.`
  }),
  phoneCheck: (phone) => ({
    code: '23514',
    message: 'new row for relation "bizum_accounts" violates check constraint "bizum_accounts_phone_e164"',
    details: `Failing row contains (id-1, Main, Juan, ${phone}, null, t, t, t, 0, 100.00, null).`
  })
};
