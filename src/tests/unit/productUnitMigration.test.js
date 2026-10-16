import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = resolve(process.cwd(), 'supabase/migrations/20261015140000_products_unit_of_measure.sql');

describe('products.unit migration', () => {
  it('exists', () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  it('adds a nullable text column idempotently, with a lenient length CHECK and a comment', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/ALTER TABLE public\.products\s+ADD COLUMN IF NOT EXISTS unit text/i);
    expect(sql).not.toMatch(/unit text[^;]*NOT NULL/i);
    expect(sql).not.toMatch(/unit text[^;]*DEFAULT/i);
    expect(sql).toMatch(/products_unit_length_check/);
    expect(sql).toMatch(/char_length\(unit\) BETWEEN 1 AND 20/i);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.products\.unit/i);
  });

  it('documents the rollback and does not hardcode unit values as an enum', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/DROP COLUMN IF EXISTS unit/i);
    expect(sql).not.toMatch(/CREATE TYPE/i);
    expect(sql).not.toMatch(/UPDATE public\.products/i);
  });
});
