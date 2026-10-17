/**
 * Phase 0b, contract file (B): hide cost and margin columns from anon and authenticated.
 *
 *   supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql          (the contract)
 *   supabase/rollbacks/20261016160100_phase0b_contract_revoke_cost_columns_down.sql    (its rollback)
 *
 * The contract file is NOT a migration: it lives outside supabase/migrations so `supabase db push` and the
 * bootstrap replay never apply it by accident. This suite applies it INSIDE ONE TRANSACTION that is always
 * rolled back, so the scratch database (and every other suite) is never left contracted:
 *
 *   BEGIN -> snapshot grants -> apply B -> assert per role (SET LOCAL ROLE + JWT claims, one SAVEPOINT per
 *   probe) -> apply the rollback -> assert the grants equal the snapshot -> ROLLBACK.
 *
 * Admin cost reads go through the migration A RPCs, which the bootstrap already replayed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin } from './db';
import { loadActors } from './fixtures';

const CONTRACT = readFileSync('supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql', 'utf8');
const ROLLBACK = readFileSync('supabase/rollbacks/20261016160100_phase0b_contract_revoke_cost_columns_down.sql', 'utf8');

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'admin_list_product_costs'],
  tables: ['products', 'combo_products', 'product_categories', 'inventory', 'shipping_zones', 'remittance_services']
});
const describeDb = skipReason ? describe.skip : describe;

const SENSITIVE = {
  products: ['base_price', 'cost_price', 'profit_margin'],
  combo_products: ['base_total_price', 'profit_margin'],
  product_categories: ['profit_margin'],
  inventory: ['cost_per_unit', 'supplier_reference'],
  shipping_zones: ['transport_cost']
};
const GUARDED = Object.keys(SENSITIVE);

describeDb('contract file B: column-level SELECT (applied in a rolled-back transaction)', () => {
  let db;
  let actors;
  let preSnapshot;
  let columnsByTable;
  const seeded = {};

  /** Runs `sql` as the given database role / user inside a savepoint; never aborts the outer transaction. */
  const attempt = async (who, sql, params = []) => {
    const claims = who.userId ? JSON.stringify({ sub: who.userId, role: who.role }) : '{}';
    await db.query('SAVEPOINT probe');
    try {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
      await db.query(`SET LOCAL ROLE ${who.role}`);
      const res = await db.query(sql, params);
      await db.query('RESET ROLE');
      await db.query('RELEASE SAVEPOINT probe');
      return { rows: res.rows, rowCount: res.rowCount };
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT probe');
      await db.query('RELEASE SAVEPOINT probe');
      return { error };
    }
  };

  const grantsSnapshot = async () => {
    const tables = await db.query(
      `SELECT table_name AS t, grantee, privilege_type AS p
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
          AND table_name IN ('products','combo_products','combo_items','product_categories','inventory','shipping_zones','remittance_services','order_analytics')
        ORDER BY 1, 2, 3`
    );
    const cols = await db.query(
      `SELECT table_name AS t, column_name AS c, grantee, privilege_type AS p
         FROM information_schema.column_privileges
        WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
          AND table_name IN ('products','combo_products','combo_items','product_categories','inventory','shipping_zones','remittance_services','order_analytics')
        ORDER BY 1, 2, 3, 4`
    );
    return { tables: tables.rows, cols: cols.rows };
  };

  const customer = () => ({ role: 'authenticated', userId: actors.customerId });
  const adminUser = () => ({ role: 'authenticated', userId: actors.adminId });
  const anon = () => ({ role: 'anon', userId: null });

  beforeAll(async () => {
    db = await connectAdmin();
    actors = await loadActors(db);
    columnsByTable = {};
    for (const t of GUARDED) {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [t]
      );
      columnsByTable[t] = rows.map((r) => r.column_name);
    }
    await db.query('BEGIN');
    preSnapshot = await grantsSnapshot();

    // Rows seeded INSIDE the transaction (rolled back at the end).
    const productId = randomUUID();
    const inactiveId = randomUUID();
    await db.query(
      `INSERT INTO public.products (id, sku, name_es, name_en, category_id, base_price, profit_margin, base_currency_id, is_active)
       VALUES ($1, $2, 'B active', 'B active', $3, 20, 50, $4, true), ($5, $6, 'B inactive', 'B inactive', $3, 21, 50, $4, false)`,
      [productId, `B-${productId.slice(0, 8)}`, actors.categoryId, actors.currencyId, inactiveId, `B-${inactiveId.slice(0, 8)}`]
    );
    const comboId = randomUUID();
    await db.query(
      `INSERT INTO public.combo_products (id, name_es, name_en, base_total_price, profit_margin) VALUES ($1, 'B combo', 'B combo', 30, 10)`,
      [comboId]
    );
    const zoneId = randomUUID();
    await db.query(
      `INSERT INTO public.shipping_zones (id, province_name, shipping_cost, transport_cost, is_active) VALUES ($1, $2, 9, 4, true)`,
      [zoneId, `B Zone ${zoneId.slice(0, 6)}`]
    );
    const inv = await db.query(
      `INSERT INTO public.inventory (product_id, quantity, cost_per_unit, supplier_reference) VALUES ($1, 5, 3.3, 'SUP-B') RETURNING id`,
      [productId]
    );
    Object.assign(seeded, { productId, inactiveId, comboId, zoneId, inventoryId: inv.rows[0].id });
  });

  afterAll(async () => {
    try {
      await db.query('ROLLBACK');
    } finally {
      await db.end();
    }
  });

  it('before B: the production grant shape holds (anon SELECT, authenticated full DML) and cost is readable', async () => {
    const r = await attempt(customer(), `SELECT base_price FROM public.products WHERE id = $1`, [seeded.productId]);
    expect(r.error).toBeUndefined();
    const anonRead = await attempt(anon(), `SELECT cost_per_unit FROM public.inventory WHERE id = $1`, [seeded.inventoryId]);
    expect(anonRead.error).toBeUndefined();
    GUARDED.forEach((t) => {
      const forTable = preSnapshot.tables.filter((g) => g.t === t);
      expect(forTable.filter((g) => g.grantee === 'anon').map((g) => g.p)).toEqual(['SELECT']);
      expect(forTable.filter((g) => g.grantee === 'authenticated').map((g) => g.p).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    });
  });

  it('applies cleanly and is idempotent (second run changes nothing)', async () => {
    await db.query(CONTRACT);
    const once = await grantsSnapshot();
    await db.query(CONTRACT);
    const twice = await grantsSnapshot();
    expect(twice).toEqual(once);
  });

  describe('after B', () => {
    it.each(GUARDED)('%s: has_column_privilege is false for every sensitive column and true for every other column (anon + authenticated)', async (table) => {
      const hidden = SENSITIVE[table];
      for (const role of ['anon', 'authenticated']) {
        for (const column of columnsByTable[table]) {
          const { rows } = await db.query(`SELECT has_column_privilege($1, $2, $3, 'SELECT') AS ok`, [role, `public.${table}`, column]);
          expect(rows[0].ok, `${role} ${table}.${column}`).toBe(!hidden.includes(column));
        }
        const { rows } = await db.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [role, `public.${table}`]);
        expect(rows[0].ok, `${role} table-level SELECT on ${table}`).toBe(false);
      }
    });

    it.each(GUARDED.flatMap((t) => SENSITIVE[t].map((c) => [t, c])))(
      '%s.%s: anon, customer and even admin get 42501 on a direct read',
      async (table, column) => {
        for (const who of [anon(), customer(), adminUser()]) {
          const r = await attempt(who, `SELECT ${column} FROM public.${table} LIMIT 1`);
          expect(r.error?.code, `${who.role}/${who.userId ? 'user' : 'none'} ${table}.${column}`).toBe('42501');
        }
      }
    );

    it.each(GUARDED)('%s: select * and a filter or order on a hidden column are denied', async (table) => {
      for (const who of [anon(), customer(), adminUser()]) {
        expect((await attempt(who, `SELECT * FROM public.${table} LIMIT 1`)).error?.code).toBe('42501');
        const hidden = SENSITIVE[table][0];
        expect((await attempt(who, `SELECT id FROM public.${table} WHERE ${hidden} IS NOT NULL LIMIT 1`)).error?.code).toBe('42501');
        expect((await attempt(who, `SELECT id FROM public.${table} ORDER BY ${hidden} LIMIT 1`)).error?.code).toBe('42501');
      }
    });

    it('the public catalog reads keep working for anon and customer (explicit lists, filters, order, count)', async () => {
      const reads = [
        `SELECT id, sku, name_es, name_en, final_price, unit, is_active FROM public.products WHERE is_active = true ORDER BY created_at DESC`,
        `SELECT final_price FROM public.products WHERE id = '${seeded.productId}'`,
        `SELECT count(*) AS n FROM public.products`,
        `SELECT id, final_price, shipping_free, is_active FROM public.combo_products WHERE is_active = true ORDER BY created_at DESC`,
        `SELECT id, slug, name_es, display_order FROM public.product_categories WHERE is_active = true ORDER BY display_order`,
        `SELECT product_id, quantity, available_quantity, expiry_date FROM public.inventory WHERE is_active = true ORDER BY created_at DESC`,
        `SELECT id, province_name, municipality_name, shipping_cost, free_shipping, is_active FROM public.shipping_zones WHERE is_active = true`,
        `SELECT combo_id, product_id, quantity FROM public.combo_items`
      ];
      for (const who of [anon(), customer()]) {
        for (const sql of reads) {
          const r = await attempt(who, sql);
          expect(r.error, `${who.role}: ${sql}`).toBeUndefined();
        }
      }
    });

    it('row-level security is unchanged: a customer still cannot see inactive products, an admin can', async () => {
      const asCustomer = await attempt(customer(), `SELECT id FROM public.products WHERE id = ANY($1)`, [[seeded.productId, seeded.inactiveId]]);
      expect(asCustomer.rows.map((r) => r.id)).toEqual([seeded.productId]);
      const asAdmin = await attempt(adminUser(), `SELECT id FROM public.products WHERE id = ANY($1)`, [[seeded.productId, seeded.inactiveId]]);
      expect(asAdmin.rows.map((r) => r.id).sort()).toEqual([seeded.productId, seeded.inactiveId].sort());
    });

    it('SECURITY INVOKER helpers that read shipping_zones still work for a customer', async () => {
      const a = await attempt(customer(), `SELECT * FROM public.get_shipping_cost_for_location($1, NULL)`, [`B Zone`]);
      expect(a.error).toBeUndefined();
      const b = await attempt(customer(), `SELECT public.calculate_order_total(10, $1, 0) AS total`, [seeded.zoneId]);
      expect(b.error).toBeUndefined();
      expect(Number(b.rows[0].total)).toBe(19);
    });

    it('an admin still reads cost, and ONLY through the RPCs', async () => {
      const p = await attempt(adminUser(), `SELECT * FROM public.admin_list_product_costs(10, 0, $1)`, [[seeded.productId]]);
      expect(Number(p.rows[0].base_price)).toBe(20);
      expect(Number(p.rows[0].profit_margin)).toBe(50);
      const c = await attempt(adminUser(), `SELECT * FROM public.admin_list_combo_costs(10, 0, $1)`, [[seeded.comboId]]);
      expect(Number(c.rows[0].base_total_price)).toBe(30);
      const z = await attempt(adminUser(), `SELECT * FROM public.admin_list_shipping_zone_costs(10, 0, $1)`, [[seeded.zoneId]]);
      expect(Number(z.rows[0].transport_cost)).toBe(4);
      const i = await attempt(adminUser(), `SELECT * FROM public.admin_list_inventory_costs(10, 0, $1)`, [[seeded.inventoryId]]);
      expect(Number(i.rows[0].cost_per_unit)).toBe(3.3);
      const cu = await attempt(customer(), `SELECT * FROM public.admin_list_product_costs(10, 0, $1)`, [[seeded.productId]]);
      expect(cu.error?.code).toBe('42501');
    });

    it('admin writes still work with an explicit RETURNING list (cost columns stay writable)', async () => {
      const upd = await attempt(
        adminUser(),
        `UPDATE public.products SET base_price = 25, profit_margin = 40, name_es = 'B edited' WHERE id = $1 RETURNING id, final_price, is_active`,
        [seeded.productId]
      );
      expect(upd.error).toBeUndefined();
      expect(Number(upd.rows[0].final_price)).toBe(35);

      const newId = randomUUID();
      const ins = await attempt(
        adminUser(),
        `INSERT INTO public.products (id, sku, name_es, name_en, category_id, base_price, profit_margin, base_currency_id)
         VALUES ($1, $2, 'B new', 'B new', $3, 10, 20, $4) RETURNING id, final_price`,
        [newId, `BN-${newId.slice(0, 8)}`, actors.categoryId, actors.currencyId]
      );
      expect(ins.error).toBeUndefined();

      const combo = await attempt(
        adminUser(),
        `UPDATE public.combo_products SET base_total_price = 31, profit_margin = 12 WHERE id = $1 RETURNING id, final_price`,
        [seeded.comboId]
      );
      expect(combo.error).toBeUndefined();

      const cat = await attempt(
        adminUser(),
        `UPDATE public.product_categories SET profit_margin = 15 WHERE id = $1 RETURNING id, slug`,
        [actors.categoryId]
      );
      expect(cat.error).toBeUndefined();

      const zone = await attempt(
        adminUser(),
        `UPDATE public.shipping_zones SET transport_cost = 5, delivery_days = 3 WHERE id = $1 RETURNING id, shipping_cost, delivery_days, delivery_note, updated_at`,
        [seeded.zoneId]
      );
      expect(zone.error).toBeUndefined();

      const inv = await attempt(
        adminUser(),
        `UPDATE public.inventory SET quantity = 8 WHERE id = $1 RETURNING id, quantity`,
        [seeded.inventoryId]
      );
      expect(inv.error).toBeUndefined();
      const invInsert = await attempt(
        adminUser(),
        `INSERT INTO public.inventory (product_id, quantity, batch_number) VALUES ($1, 2, 'B-NEW')`,
        [seeded.productId]
      );
      expect(invInsert.error).toBeUndefined();
    });

    it('a RETURNING * (or an empty .select()) on a guarded write is denied: the front must name its columns', async () => {
      const r = await attempt(adminUser(), `UPDATE public.products SET name_es = 'x' WHERE id = $1 RETURNING *`, [seeded.productId]);
      expect(r.error?.code).toBe('42501');
    });

    it('a customer still cannot write (row-level security is the gate, unchanged)', async () => {
      const r = await attempt(customer(), `UPDATE public.products SET name_es = 'hacked' WHERE id = $1`, [seeded.productId]);
      expect(r.error?.code === '42501' || r.rowCount === 0).toBe(true);
    });

    it('order_analytics and remittance_services are closed to anon and authenticated', async () => {
      for (const who of [anon(), customer(), adminUser()]) {
        expect((await attempt(who, `SELECT 1 FROM public.order_analytics LIMIT 1`)).error?.code).toBe('42501');
        expect((await attempt(who, `SELECT 1 FROM public.remittance_services LIMIT 1`)).error?.code).toBe('42501');
      }
    });

    it('no guarded table is published to realtime', async () => {
      const { rows } = await db.query(
        `SELECT tablename FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
        [[...GUARDED, 'combo_items', 'remittance_services']]
      );
      expect(rows).toEqual([]);
    });

    it('the grant lists plus the hidden columns cover every column of the table (no silent drift)', async () => {
      for (const table of GUARDED) {
        const { rows } = await db.query(
          `SELECT column_name FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'anon' AND privilege_type = 'SELECT'`,
          [table]
        );
        const granted = rows.map((r) => r.column_name).sort();
        expect([...granted, ...SENSITIVE[table]].sort()).toEqual([...columnsByTable[table]].sort());
      }
    });
  });

  it('the rollback file restores the exact pre-B grants (table and column level)', async () => {
    await db.query(ROLLBACK);
    const after = await grantsSnapshot();
    expect(after).toEqual(preSnapshot);
    const r = await attempt(customer(), `SELECT base_price FROM public.products WHERE id = $1`, [seeded.productId]);
    expect(r.error).toBeUndefined();
  });

  it('B can be applied again after its own rollback (up / down / up)', async () => {
    await db.query(CONTRACT);
    const r = await attempt(customer(), `SELECT base_price FROM public.products LIMIT 1`);
    expect(r.error?.code).toBe('42501');
    await db.query(ROLLBACK);
    expect(await grantsSnapshot()).toEqual(preSnapshot);
  });
});
