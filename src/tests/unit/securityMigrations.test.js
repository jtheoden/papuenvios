import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');
const REMITTANCE_SERVICE_PATH = resolve(ROOT, 'src/lib/remittanceService.js');

const DEFINER_MIGRATION = '20261002000001_fix_activity_logs_redact_pii_definer.sql';
const GUARD_MIGRATION = '20261002000002_guard_remittance_owner_update.sql';

const readMigration = (fileName) => {
  const fullPath = resolve(MIGRATIONS_DIR, fileName);
  if (!existsSync(fullPath)) {
    throw new Error(`Migration not found: ${fileName}`);
  }
  return readFileSync(fullPath, 'utf8');
};

/** Strips `-- ...` line comments so assertions only match executable SQL. */
const stripSqlComments = (sql) => sql.replace(/--.*$/gm, '');

/** Removes every whitespace character: assertions become formatting-agnostic. */
const compact = (text) => text.replace(/\s+/g, '');

const compactSql = (fileName) => compact(stripSqlComments(readMigration(fileName)));

/** Asserts the migration contains `fragment`, ignoring all whitespace differences. */
const expectSqlToContain = (fileName, fragment) => {
  expect(compactSql(fileName)).toContain(compact(fragment));
};

/** Returns every `v_allowed := ARRAY[...]` list of the guard, in source order. */
const parseGuardAllowLists = () => {
  const sql = stripSqlComments(readMigration(GUARD_MIGRATION));
  return [...sql.matchAll(/v_allowed\s*:=\s*ARRAY\s*\[([^\]]+)\]/g)].map((match) =>
    match[1]
      .split(',')
      .map((key) => key.trim().replace(/'/g, ''))
      .filter(Boolean)
  );
};

/**
 * Returns the keys of the first `.from('remittances').update({...})` object literal
 * inside the exported function `functionName` of remittanceService.js.
 */
const parseOwnerUpdateKeys = (functionName) => {
  const source = readFileSync(REMITTANCE_SERVICE_PATH, 'utf8');
  const start = source.indexOf(`export const ${functionName} = `);
  if (start === -1) {
    throw new Error(`Function not found in remittanceService.js: ${functionName}`);
  }
  const nextExport = source.indexOf('\nexport const ', start + 1);
  const body = source.slice(start, nextExport === -1 ? undefined : nextExport);
  const match = body.match(/\.from\('remittances'\)\s*\.update\(\{([^}]*)\}\)/);
  if (!match) {
    throw new Error(`No remittances .update({...}) literal found in ${functionName}`);
  }
  return match[1]
    .split('\n')
    .map((line) => line.trim().match(/^([a-z_]+)\s*:/))
    .filter(Boolean)
    .map((keyMatch) => keyMatch[1]);
};

const withoutUpdatedAt = (keys) => keys.filter((key) => key !== 'updated_at').sort();

describe(DEFINER_MIGRATION, () => {
  it('switches the redaction trigger function to SECURITY DEFINER', () => {
    expectSqlToContain(
      DEFINER_MIGRATION,
      'ALTER FUNCTION public.activity_logs_redact_pii() SECURITY DEFINER;'
    );
  });

  it('pins search_path to public, pg_temp on the SECURITY DEFINER function', () => {
    expectSqlToContain(
      DEFINER_MIGRATION,
      'ALTER FUNCTION public.activity_logs_redact_pii() SET search_path = public, pg_temp;'
    );
  });

  it('does not widen the ACL of redact_pii_jsonb', () => {
    expect(compactSql(DEFINER_MIGRATION)).not.toMatch(/GRANTEXECUTE/i);
  });

  it('runs inside a single transaction', () => {
    expect(compactSql(DEFINER_MIGRATION)).toMatch(/^BEGIN;.*COMMIT;$/);
  });
});

describe(GUARD_MIGRATION, () => {
  it('creates the guard function idempotently with a pinned search_path', () => {
    expectSqlToContain(
      GUARD_MIGRATION,
      'CREATE OR REPLACE FUNCTION public.guard_remittance_owner_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public'
    );
  });

  it('attaches it as a BEFORE INSERT OR UPDATE row trigger on remittances, idempotently', () => {
    expectSqlToContain(
      GUARD_MIGRATION,
      'DROP TRIGGER IF EXISTS guard_remittance_owner_update ON public.remittances;'
    );
    expectSqlToContain(
      GUARD_MIGRATION,
      'CREATE TRIGGER guard_remittance_owner_update BEFORE INSERT OR UPDATE ON public.remittances FOR EACH ROW EXECUTE FUNCTION public.guard_remittance_owner_update();'
    );
  });

  it('bypasses service role and admins', () => {
    expectSqlToContain(GUARD_MIGRATION, 'IF auth.uid() IS NULL THEN RETURN NEW;');
    expectSqlToContain(
      GUARD_MIGRATION,
      'IF public.is_admin_user() OR public.is_super_admin() THEN RETURN NEW;'
    );
  });

  it('rejects anything else with SQLSTATE 42501', () => {
    const raises = stripSqlComments(readMigration(GUARD_MIGRATION)).match(/RAISE EXCEPTION[^;]+;/g) || [];
    expect(raises.length).toBeGreaterThanOrEqual(3);
    raises.forEach((raise) => expect(compact(raise)).toContain("USINGERRCODE='42501'"));
  });

  describe('INSERT by a non-admin owner', () => {
    it('handles TG_OP = INSERT in its own branch', () => {
      expectSqlToContain(GUARD_MIGRATION, "IF TG_OP = 'INSERT' THEN");
    });

    it('requires the initial status to be payment_pending', () => {
      expectSqlToContain(GUARD_MIGRATION, "NEW.status IS DISTINCT FROM 'payment_pending'");
    });

    it('requires payment_validated not to be true', () => {
      expectSqlToContain(GUARD_MIGRATION, 'NEW.payment_validated IS TRUE');
    });

    it.each([
      'payment_validated_at',
      'payment_validated_by',
      'payment_rejection_reason',
      'delivery_proof_url',
      'delivery_notes_admin',
      'delivered_to_name',
      'delivered_to_id',
      'delivered_at',
      'delivered_by',
      'processing_started_at',
      'completed_at',
      'cancelled_at',
      'cancellation_reason',
      'cancelled_by'
    ])('requires %s to be NULL', (column) => {
      expectSqlToContain(GUARD_MIGRATION, `NEW.${column} IS NOT NULL`);
    });
  });

  describe('UPDATE by a non-admin owner', () => {
    it('compares OLD and NEW outside the per-transition allow-list', () => {
      expectSqlToContain(
        GUARD_MIGRATION,
        'IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN'
      );
    });

    it('never lets the owner change identity or validation columns', () => {
      const allowLists = parseGuardAllowLists();
      expect(allowLists).toHaveLength(3);
      const forbidden = [
        'user_id',
        'amount_sent',
        'payment_validated',
        'payment_validated_at',
        'payment_validated_by',
        'delivered_at',
        'completed_at',
        'delivery_proof_url',
        'zelle_account_id',
        'discount_amount'
      ];
      allowLists.forEach((keys) => {
        forbidden.forEach((column) => expect(keys).not.toContain(column));
        expect(keys).toContain('updated_at');
      });
    });

    it('encodes the payment proof upload transition (uploadPaymentProof)', () => {
      expectSqlToContain(
        GUARD_MIGRATION,
        "OLD.status IN ('payment_pending', 'payment_rejected') AND NEW.status = 'payment_proof_uploaded'"
      );
    });

    it('encodes the owner cancellation transition (cancelRemittance)', () => {
      expectSqlToContain(
        GUARD_MIGRATION,
        "OLD.status IN ('payment_pending', 'payment_rejected') AND NEW.status = 'cancelled'"
      );
    });

    it('encodes the rate recalculation transition (recalculateRemittanceAtCurrentRate)', () => {
      expectSqlToContain(
        GUARD_MIGRATION,
        "NEW.status = OLD.status AND OLD.status IN ('payment_pending', 'payment_rejected')"
      );
    });
  });

  it('does not touch existing policies or grants', () => {
    const sql = stripSqlComments(readMigration(GUARD_MIGRATION));
    expect(sql).not.toMatch(/\b(CREATE|DROP|ALTER)\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });
});

describe('client ↔ guard drift (remittanceService.js vs guard allow-lists)', () => {
  // Allow-lists appear in the migration in this order.
  const OWNER_TRANSITIONS = [
    ['uploadPaymentProof', 0],
    ['cancelRemittance', 1],
    ['recalculateRemittanceAtCurrentRate', 2]
  ];

  it.each(OWNER_TRANSITIONS)(
    'columns written by %s match the guard allow-list exactly',
    (functionName, allowListIndex) => {
      const clientKeys = parseOwnerUpdateKeys(functionName);
      const guardKeys = parseGuardAllowLists()[allowListIndex];

      expect(clientKeys.length).toBeGreaterThan(0);
      expect(withoutUpdatedAt(guardKeys)).toEqual(withoutUpdatedAt(clientKeys));
    }
  );

  it('createRemittance never sends a column the INSERT guard requires to be NULL', () => {
    const source = readFileSync(REMITTANCE_SERVICE_PATH, 'utf8');
    const start = source.indexOf('export const createRemittance = ');
    const end = source.indexOf('\nexport const ', start + 1);
    const body = source.slice(start, end);
    const guardedColumns = [
      ...stripSqlComments(readMigration(GUARD_MIGRATION)).matchAll(/NEW\.([a-z_]+)\s+IS\s+NOT\s+NULL/g)
    ].map((match) => match[1]);

    expect(guardedColumns.length).toBeGreaterThanOrEqual(14);
    [...guardedColumns, 'payment_validated'].forEach((column) => {
      expect(body).not.toMatch(new RegExp(`\\b${column}\\s*[:=]`));
      expect(body).not.toMatch(new RegExp(`insertData\\.${column}\\b`));
    });
    expect(body).toMatch(/status:\s*REMITTANCE_STATUS\.PAYMENT_PENDING/);
  });
});
