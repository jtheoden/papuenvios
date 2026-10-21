/**
 * Private order payment proofs (supabase/migrations/20261022100000_private_payment_proofs.sql).
 * Real storage.objects policies on the LOCAL scratch Postgres only (the harness refuses any other host).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const MIGRATION = 'supabase/migrations/20261022100000_private_payment_proofs.sql';

describe('private_payment_proofs migration (static)', () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

  it('makes the bucket private with size and MIME limits, inside an explicit transaction', () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toMatch(/public = false/);
    expect(sql).toMatch(/file_size_limit = 5242880/);
    expect(sql).toMatch(/ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  });

  it('drops the public policy and never grants anything to anon/public', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Anyone can view payment proofs"/);
    const code = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(code).not.toMatch(/CREATE POLICY[^;]*TO (public|anon)/i);
  });

  it('wraps auth helpers in SELECT and documents the exact rollback', () => {
    expect(sql).toMatch(/\(SELECT auth\.uid\(\)\)/);
    expect(sql).toMatch(/\(SELECT public\.is_admin_user\(\)\)/);
    expect(sql).toMatch(/ROLLBACK \(exact/);
    expect(sql).toMatch(/CREATE POLICY "Anyone can view payment proofs"/);
  });
});

const skipReason = await dbSuiteSkipReason({ tables: ['orders', 'user_profiles'] });
const describeDb = skipReason ? describe.skip : describe;

describeDb('order-documents storage policies (local Postgres)', () => {
  let admin;
  let actors;
  const tracker = createTracker();
  const clients = [];
  const users = [];
  const objects = [];

  let ownerId;
  let strangerId;
  let adminUserId;
  let ownerOrder;
  let otherOrder;
  let ownerPath;
  let otherPath;

  const makeUser = async (role) => {
    const id = randomUUID();
    const email = `proofs.${id.slice(0, 8)}@example.test`;
    await admin.query('BEGIN');
    await admin.query('SET LOCAL session_replication_role = replica');
    await admin.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now(), '{}', '{}')`,
      [id, email]
    );
    await admin.query(
      `INSERT INTO public.user_profiles (id, user_id, email, role, full_name, is_enabled) VALUES ($1, $1, $2, $3, 'Proof User', true)`,
      [id, email, role]
    );
    await admin.query('COMMIT');
    users.push(id);
    return id;
  };

  const as = async (id) => {
    const c = await connectAs(id);
    clients.push(c);
    return c;
  };

  const proofPath = (orderId) => `payment-proofs/payment-proof-${orderId}-${Date.now()}.png`;

  const putObject = async (name) => {
    await admin.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('order-documents', $1)`, [name]);
    objects.push(name);
  };

  const visible = async (c) =>
    (await c.query(`SELECT name FROM storage.objects WHERE bucket_id = 'order-documents'`)).rows.map((r) => r.name);

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    ownerId = await makeUser('user');
    strangerId = await makeUser('user');
    adminUserId = await makeUser('admin');
    ownerOrder = await seedOrder(admin, actors, tracker, [], { userId: ownerId });
    otherOrder = await seedOrder(admin, actors, tracker, [], { userId: actors.customerId });
    ownerPath = proofPath(ownerOrder);
    otherPath = proofPath(otherOrder);
    await putObject(ownerPath);
    await putObject(otherPath);
  });

  afterAll(async () => {
    await endAll(clients);
    if (objects.length) await admin.query(`DELETE FROM storage.objects WHERE bucket_id = 'order-documents' AND name = ANY($1)`, [objects]);
    await cleanup(admin, tracker);
    if (users.length) {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query('DELETE FROM public.user_profiles WHERE id = ANY($1)', [users]);
      await admin.query('DELETE FROM auth.users WHERE id = ANY($1)', [users]);
      await admin.query('COMMIT');
    }
    await admin.end();
  });

  it('bucket is private with size and MIME limits', async () => {
    const { rows } = await admin.query(
      `SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'order-documents'`
    );
    expect(rows[0].public).toBe(false);
    expect(Number(rows[0].file_size_limit)).toBe(5242880);
    expect(rows[0].allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('the public SELECT policy is gone', async () => {
    const { rows } = await admin.query(
      `SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname = 'Anyone can view payment proofs'`
    );
    expect(rows).toHaveLength(0);
  });

  it('anon cannot list or read any proof', async () => {
    const anon = await connectAnon();
    clients.push(anon);
    expect(await visible(anon)).toEqual([]);
  });

  it('the owner reads their own proof and not another customer\'s', async () => {
    const names = await visible(await as(ownerId));
    expect(names).toContain(ownerPath);
    expect(names).not.toContain(otherPath);
  });

  it('a user without orders sees nothing', async () => {
    expect(await visible(await as(strangerId))).toEqual([]);
  });

  it('an admin reads every proof', async () => {
    const names = await visible(await as(adminUserId));
    expect(names).toEqual(expect.arrayContaining([ownerPath, otherPath]));
  });

  it('the owner can upload for their own order but not for another\'s or with an arbitrary name', async () => {
    const c = await as(ownerId);
    const insert = (name) =>
      c.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('order-documents', $1, $2)`, [name, ownerId]);
    await insert(`payment-proofs/payment-proof-${ownerOrder}-1.png`);
    objects.push(`payment-proofs/payment-proof-${ownerOrder}-1.png`);
    await expect(insert(`payment-proofs/payment-proof-${otherOrder}-2.png`)).rejects.toThrow(/row-level security/i);
    await expect(insert('payment-proofs/anything.png')).rejects.toThrow(/row-level security/i);
  });

  it('nobody can update or delete proofs (no policy)', async () => {
    const c = await as(ownerId);
    const upd = await c.query(`UPDATE storage.objects SET name = name WHERE bucket_id = 'order-documents' AND name = $1`, [ownerPath]);
    const del = await c.query(`DELETE FROM storage.objects WHERE bucket_id = 'order-documents' AND name = $1`, [ownerPath]);
    expect(upd.rowCount).toBe(0);
    expect(del.rowCount).toBe(0);
  });
});
