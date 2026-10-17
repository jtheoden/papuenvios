/**
 * Phase 0b, migration A (expand): admin-only READ RPCs for cost and margin data.
 *
 * Migration under test:
 *   supabase/migrations/20261016160000_phase0b_admin_cost_read_rpcs.sql
 *
 * Admin and customer share the `authenticated` database role, so cost columns can only be read by an admin
 * through SECURITY DEFINER functions that re-check the role INSIDE the body. Runs against the LOCAL scratch
 * database built by `npm run test:db:bootstrap`. The suite deliberately does NOT list the new functions in
 * `needs`, so a missing migration fails loudly (red phase) instead of skipping.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin'],
  tables: ['products', 'combo_products', 'product_categories', 'inventory', 'shipping_zones']
});
const describeDb = skipReason ? describe.skip : describe;

const FUNCTIONS = {
  products: 'public.admin_list_product_costs(integer, integer, uuid[])',
  combos: 'public.admin_list_combo_costs(integer, integer, uuid[])',
  categories: 'public.admin_list_category_margins(integer, integer, uuid[])',
  inventory: 'public.admin_list_inventory_costs(integer, integer, uuid[])',
  zones: 'public.admin_list_shipping_zone_costs(integer, integer, uuid[])'
};

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('admin cost read RPCs (migration A)', () => {
  let admin;
  let actors;
  const clients = [];
  const tracker = createTracker();
  const seeded = { categories: [], zones: [] };

  const as = async (userId, role = 'authenticated') => {
    const c = await connectAs(userId, role);
    clients.push(c);
    return c;
  };
  const asAnon = async () => {
    const c = await connectAnon();
    clients.push(c);
    return c;
  };

  const call = (client, fn, { limit = 500, offset = 0, ids = null } = {}) =>
    client.query(`SELECT * FROM public.${fn}($1, $2, $3)`, [limit, offset, ids]);

  /** n products sharing ONE created_at so the id tiebreaker is what keeps the pages stable. */
  const seedProducts = async (n, { base = 11.5, margin = 37.5 } = {}) => {
    const ids = [];
    const createdAt = '2026-01-01T00:00:00Z';
    for (let i = 0; i < n; i += 1) {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO public.products (id, sku, name_es, name_en, category_id, base_price, profit_margin, base_currency_id, created_at)
         VALUES ($1, $2, 'Cost RPC', 'Cost RPC', $3, $4, $5, $6, $7)`,
        [id, `CRP-${id.slice(0, 8)}`, actors.categoryId, base + i, margin, actors.currencyId, createdAt]
      );
      tracker.products.push(id);
      ids.push(id);
    }
    return ids;
  };

  const seedCombo = async ({ base = 40.25, margin = 22 } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.combo_products (id, name_es, name_en, base_total_price, profit_margin)
       VALUES ($1, 'Combo cost', 'Combo cost', $2, $3)`,
      [id, base, margin]
    );
    tracker.combos.push(id);
    return id;
  };

  const seedCategory = async (margin = 18.75) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.product_categories (id, name_es, name_en, slug, profit_margin)
       VALUES ($1, 'Cat cost', 'Cat cost', $2, $3)`,
      [id, `cat-cost-${id.slice(0, 8)}`, margin]
    );
    seeded.categories.push(id);
    return id;
  };

  const seedZone = async (transport = 6.4) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.shipping_zones (id, province_name, municipality_name, shipping_cost, transport_cost)
       VALUES ($1, $2, NULL, 9, $3)`,
      [id, `Zone ${id.slice(0, 8)}`, transport]
    );
    seeded.zones.push(id);
    return id;
  };

  const seedInventory = async (productId, cost = 3.33, supplier = 'SUP-77') => {
    const { rows } = await admin.query(
      `INSERT INTO public.inventory (product_id, quantity, cost_per_unit, supplier_reference)
       VALUES ($1, 5, $2, $3) RETURNING id`,
      [productId, cost, supplier]
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    await cleanup(admin, tracker);
    if (seeded.zones.length) await admin.query(`DELETE FROM public.shipping_zones WHERE id = ANY($1)`, [seeded.zones.splice(0)]);
    if (seeded.categories.length) await admin.query(`DELETE FROM public.product_categories WHERE id = ANY($1)`, [seeded.categories.splice(0)]);
  });

  afterAll(async () => {
    await admin.end();
  });

  // --------------------------------------------------------------------------------------------
  describe('admin and super_admin read cost data', () => {
    it('products: only id, base_price, profit_margin (cost_price is never returned)', async () => {
      const [a, b] = await seedProducts(2, { base: 11.5, margin: 37.5 });
      const c = await as(actors.adminId);
      const { rows, fields } = await call(c, 'admin_list_product_costs', { ids: [b, a] });
      expect(fields.map((f) => f.name)).toEqual(['id', 'base_price', 'profit_margin']);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(Number(byId[a].base_price)).toBe(11.5);
      expect(Number(byId[b].base_price)).toBe(12.5);
      expect(Number(byId[a].profit_margin)).toBe(37.5);
      expect(rows).toHaveLength(2);
    });

    it('combos: only id, base_total_price, profit_margin', async () => {
      const id = await seedCombo({ base: 40.25, margin: 22 });
      const c = await as(actors.adminId);
      const { rows, fields } = await call(c, 'admin_list_combo_costs', { ids: [id] });
      expect(fields.map((f) => f.name)).toEqual(['id', 'base_total_price', 'profit_margin']);
      expect(Number(rows[0].base_total_price)).toBe(40.25);
      expect(Number(rows[0].profit_margin)).toBe(22);
    });

    it('categories: only id, profit_margin (NULL stays NULL)', async () => {
      const withMargin = await seedCategory(18.75);
      const noMargin = await seedCategory(null);
      const c = await as(actors.adminId);
      const { rows, fields } = await call(c, 'admin_list_category_margins', { ids: [withMargin, noMargin] });
      expect(fields.map((f) => f.name)).toEqual(['id', 'profit_margin']);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.profit_margin]));
      expect(Number(byId[withMargin])).toBe(18.75);
      expect(byId[noMargin]).toBeNull();
    });

    it('inventory: only id, product_id, cost_per_unit, supplier_reference', async () => {
      const [p] = await seedProducts(1);
      const inv = await seedInventory(p, 3.33, 'SUP-77');
      const c = await as(actors.adminId);
      const { rows, fields } = await call(c, 'admin_list_inventory_costs', { ids: [inv] });
      expect(fields.map((f) => f.name)).toEqual(['id', 'product_id', 'cost_per_unit', 'supplier_reference']);
      expect(rows[0]).toMatchObject({ id: inv, product_id: p, supplier_reference: 'SUP-77' });
      expect(Number(rows[0].cost_per_unit)).toBe(3.33);
    });

    it('shipping zones: only id, transport_cost', async () => {
      const id = await seedZone(6.4);
      const c = await as(actors.adminId);
      const { rows, fields } = await call(c, 'admin_list_shipping_zone_costs', { ids: [id] });
      expect(fields.map((f) => f.name)).toEqual(['id', 'transport_cost']);
      expect(Number(rows[0].transport_cost)).toBe(6.4);
    });

    it('a super_admin is allowed too', async () => {
      const [p] = await seedProducts(1);
      await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
      const c = await as(actors.adminId);
      const { rows } = await call(c, 'admin_list_product_costs', { ids: [p] });
      expect(rows).toHaveLength(1);
    });

    it('without a filter it lists the whole table (p_ids NULL)', async () => {
      const ids = await seedProducts(3);
      const c = await as(actors.adminId);
      const { rows } = await call(c, 'admin_list_product_costs', { limit: 1000 });
      const got = new Set(rows.map((r) => r.id));
      ids.forEach((id) => expect(got.has(id)).toBe(true));
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('everybody else is denied, with no value in the error', () => {
    const CASES = Object.keys(FUNCTIONS).map((key) => [key]);
    const FN_NAME = {
      products: 'admin_list_product_costs',
      combos: 'admin_list_combo_costs',
      categories: 'admin_list_category_margins',
      inventory: 'admin_list_inventory_costs',
      zones: 'admin_list_shipping_zone_costs'
    };

    it.each(CASES)('customer is denied on %s even when passing ids of real rows', async (key) => {
      const [p] = await seedProducts(1, { base: 98765.43 });
      const combo = await seedCombo({ base: 98765.43 });
      const c = await as(actors.customerId);
      const err = await failure(call(c, FN_NAME[key], { ids: [p, combo] }));
      expect(err.code).toBe('42501');
      expect(err.message).not.toMatch(/98765/);
    });

    it.each(CASES)('anon is denied on %s', async (key) => {
      const c = await asAnon();
      const err = await failure(call(c, FN_NAME[key]));
      expect(err.code).toBe('42501');
    });

    it('an authenticated session without a user id (NULL auth.uid()) is denied', async () => {
      const c = await connectAs(actors.customerId);
      clients.push(c);
      await c.query(`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false)`);
      const err = await failure(call(c, 'admin_list_product_costs'));
      expect(err.code).toBe('42501');
    });

    it('a disabled admin (stale JWT) is denied', async () => {
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.adminId]);
      const c = await as(actors.adminId);
      const err = await failure(call(c, 'admin_list_product_costs'));
      expect(err.code).toBe('42501');
    });

    it('a user demoted to customer after sign-in is denied', async () => {
      await admin.query(`UPDATE public.user_profiles SET role = 'user' WHERE id = $1`, [actors.adminId]);
      const c = await as(actors.adminId);
      const err = await failure(call(c, 'admin_list_product_costs'));
      expect(err.code).toBe('42501');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('pagination and bounds', () => {
    it('pages are stable and complete even when every row shares created_at', async () => {
      const ids = await seedProducts(7);
      const c = await as(actors.adminId);
      const collect = async () => {
        const out = [];
        for (let offset = 0; ; offset += 3) {
          const { rows } = await call(c, 'admin_list_product_costs', { limit: 3, offset, ids });
          out.push(...rows.map((r) => r.id));
          if (rows.length < 3) break;
        }
        return out;
      };
      const first = await collect();
      const second = await collect();
      expect(first).toHaveLength(7);
      expect(new Set(first).size).toBe(7);
      expect(second).toEqual(first);
      expect(first).toEqual([...ids].sort());
    });

    it('an offset past the end returns no rows', async () => {
      const ids = await seedProducts(2);
      const c = await as(actors.adminId);
      const { rows } = await call(c, 'admin_list_product_costs', { limit: 5, offset: 50, ids });
      expect(rows).toEqual([]);
    });

    it('a limit above the maximum is clamped (never unbounded)', async () => {
      const c = await as(actors.adminId);
      const { rows } = await call(c, 'admin_list_product_costs', { limit: 1000000 });
      expect(rows.length).toBeLessThanOrEqual(1000);
    });

    it.each([[0, 0], [-1, 0], [null, 0], [10, -1], [10, null]])(
      'invalid limit/offset (%s, %s) is rejected with 22023',
      async (limit, offset) => {
        const c = await as(actors.adminId);
        const err = await failure(c.query(`SELECT * FROM public.admin_list_product_costs($1, $2, NULL)`, [limit, offset]));
        expect(err.code).toBe('22023');
      }
    );

    it('more than 1000 ids in the filter is rejected with 22023', async () => {
      const c = await as(actors.adminId);
      const err = await failure(
        c.query(`SELECT * FROM public.admin_list_product_costs(10, 0, ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 1001)))`)
      );
      expect(err.code).toBe('22023');
    });

    it('an empty id filter returns nothing (it is not "no filter")', async () => {
      await seedProducts(2);
      const c = await as(actors.adminId);
      const { rows } = await call(c, 'admin_list_product_costs', { ids: [] });
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('function hygiene', () => {
    const hygiene = async (signature) =>
      (await admin.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service_role,
                (SELECT COALESCE(bool_or(a.grantee = 0), false) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure) AS public_grant,
                (SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure) AS secdef,
                (SELECT provolatile FROM pg_proc WHERE oid = $1::regprocedure) AS volatility,
                (SELECT proconfig FROM pg_proc WHERE oid = $1::regprocedure) AS config`,
        [signature]
      )).rows[0];

    it.each(Object.entries(FUNCTIONS))('%s: SECURITY DEFINER, pinned search_path, EXECUTE only for authenticated', async (_key, signature) => {
      const h = await hygiene(signature);
      expect(h).toMatchObject({ anon: false, authenticated: true, service_role: false, public_grant: false, secdef: true, volatility: 's' });
      expect(h.config).toContain('search_path=public, pg_temp');
    });

    it('catalog lint: every admin_list_* function in public follows the template', async () => {
      const { rows } = await admin.query(
        `SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'admin\\_list\\_%'`
      );
      expect(rows.length).toBeGreaterThanOrEqual(Object.keys(FUNCTIONS).length);
      rows.forEach((r) => {
        expect(r.prosecdef, r.sig).toBe(true);
        expect(r.proconfig, r.sig).toContain('search_path=public, pg_temp');
      });
    });

    it('the expand migration is additive: table grants are untouched', async () => {
      const { rows } = await admin.query(
        `SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS p
           FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee = 'authenticated'
            AND table_name IN ('products','combo_products','product_categories','inventory','shipping_zones')
          GROUP BY table_name ORDER BY table_name`
      );
      rows.forEach((r) => expect(r.p).toBe('DELETE,INSERT,SELECT,UPDATE'));
    });
  });
});
