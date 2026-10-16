import { vi } from 'vitest';

/**
 * Minimal PostgREST query-builder double that records every call made against it.
 * Every builder method returns the same chain; awaiting the chain resolves to the
 * canned `{ data, error }` registered for the table (default: no rows, no error).
 */
export const createSupabaseRecorder = () => {
  const queries = [];
  const results = {};

  const from = vi.fn((table) => {
    const record = { table, calls: [] };
    queries.push(record);

    const chain = new Proxy({}, {
      get(_target, method) {
        if (method === 'then') {
          return (resolve, reject) =>
            Promise.resolve(results[table] ? results[table](record) : { data: [], error: null })
              .then(resolve, reject);
        }
        return (...args) => {
          record.calls.push({ method, args });
          return chain;
        };
      }
    });
    return chain;
  });

  return {
    client: { from, rpc: vi.fn() },
    queries,
    results,
    reset() {
      queries.length = 0;
      Object.keys(results).forEach((key) => delete results[key]);
    },
    /** Arguments of every `.select(...)` made against `table`, in call order. */
    selects(table) {
      return queries
        .filter((q) => q.table === table)
        .flatMap((q) => q.calls.filter((c) => c.method === 'select').map((c) => c.args[0]));
    },
    /** Every `.select(...)` argument across all tables. */
    allSelects() {
      return queries.flatMap((q) =>
        q.calls.filter((c) => c.method === 'select').map((c) => ({ table: q.table, arg: c.args[0] }))
      );
    }
  };
};

/** Splits a PostgREST select string into top-level column names (embeds kept whole). */
export const splitSelect = (select) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(select ?? '')) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export const SENSITIVE_COLUMNS = [
  'base_price',
  'cost_price',
  'profit_margin',
  'cost_per_unit',
  'supplier_reference',
  'base_total_price',
  'transport_cost'
];

export const containsSensitiveColumn = (select) =>
  SENSITIVE_COLUMNS.filter((column) => new RegExp(`\\b${column}\\b`).test(String(select ?? '')));
