/**
 * Anti-drift: the status sets in JS must equal the literals of the CHECK constraints in the E1 migration
 * (20261024100000_status_check_constraints.sql). Adding a status in JS without a migration fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { ORDER_STATUS, PAYMENT_STATUS } from '@/lib/orderService';
import { REMITTANCE_STATUS } from '@/lib/remittanceService';
import { ZELLE_STATUS } from '@/lib/zelleService';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261024100000_status_check_constraints.sql'), 'utf8');

const checkLiterals = (constraint) => {
  const m = SQL.match(new RegExp(`${constraint}[\\s\\S]*?CHECK\\s*\\(\\s*\\w+\\s+IN\\s*\\(([^)]*)\\)`));
  if (!m) throw new Error(`constraint ${constraint} not found in the migration`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
};

describe('status CHECK constraints vs JS constants', () => {
  it.each([
    ['orders_status_check', ORDER_STATUS],
    ['orders_payment_status_check', PAYMENT_STATUS],
    ['remittances_status_check', REMITTANCE_STATUS],
    ['zelle_transaction_history_status_check', ZELLE_STATUS]
  ])('%s equals the JS constant', (constraint, constant) => {
    expect(checkLiterals(constraint)).toEqual(Object.values(constant).sort());
  });

  it('offers_discount_type_check allows exactly the two types the form writes', () => {
    expect(checkLiterals('offers_discount_type_check')).toEqual(['fixed_amount', 'percentage']);
  });
});
