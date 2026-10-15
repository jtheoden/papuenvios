/**
 * Seeding helpers (run as the postgres superuser against the LOCAL database).
 * Every test creates its own products/orders and cleans them up afterwards.
 */
import { randomUUID } from 'node:crypto';

export const CUSTOMER_EMAIL = 'e2e.customer@example.test';
export const ADMIN_EMAIL = 'e2e.admin@example.test';

/** Resolve the seeded e2e users. Throws a readable error if the stack was not seeded. */
export const loadActors = async (admin) => {
  const { rows } = await admin.query(
    `SELECT id, email FROM public.user_profiles WHERE email = ANY($1)`,
    [[CUSTOMER_EMAIL, ADMIN_EMAIL]]
  );
  const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.id]));
  if (!byEmail[CUSTOMER_EMAIL] || !byEmail[ADMIN_EMAIL]) {
    throw new Error('Local stack is not seeded. Run: src/tests/e2e/stack/e2e-stack.sh start (see README.md)');
  }
  const base = await admin.query(
    `SELECT category_id, base_currency_id FROM public.products LIMIT 1`
  );
  if (base.rowCount === 0) throw new Error('Local stack has no product to clone category/currency from');
  return {
    customerId: byEmail[CUSTOMER_EMAIL],
    adminId: byEmail[ADMIN_EMAIL],
    categoryId: base.rows[0].category_id,
    currencyId: base.rows[0].base_currency_id
  };
};

/** Tracks everything a test creates so afterEach can remove it. */
export const createTracker = () => ({ products: [], combos: [], orders: [] });

export const seedProduct = async (admin, actors, tracker, { quantity, reserved = 0, expiry = null } = {}) => {
  const productId = randomUUID();
  await admin.query(
    `INSERT INTO public.products (id, sku, name_es, name_en, category_id, base_price, base_currency_id)
     VALUES ($1, $2, 'Stock test', 'Stock test', $3, 5, $4)`,
    [productId, `STK-${productId.slice(0, 8)}`, actors.categoryId, actors.currencyId]
  );
  const inv = await admin.query(
    `INSERT INTO public.inventory (product_id, quantity, reserved_quantity, expiry_date)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [productId, quantity, reserved, expiry]
  );
  tracker.products.push(productId);
  return { productId, inventoryId: inv.rows[0].id };
};

/** Add a second batch for an existing product. */
export const seedBatch = async (admin, productId, { quantity, expiry = null }) => {
  const inv = await admin.query(
    `INSERT INTO public.inventory (product_id, quantity, reserved_quantity, expiry_date)
     VALUES ($1, $2, 0, $3) RETURNING id`,
    [productId, quantity, expiry]
  );
  return inv.rows[0].id;
};

/** components: [{ productId, quantity }] */
export const seedCombo = async (admin, tracker, components) => {
  const comboId = randomUUID();
  await admin.query(
    `INSERT INTO public.combo_products (id, name_es, name_en, base_total_price) VALUES ($1, 'Combo test', 'Combo test', 10)`,
    [comboId]
  );
  for (const c of components) {
    await admin.query(
      `INSERT INTO public.combo_items (combo_id, product_id, quantity) VALUES ($1, $2, $3)`,
      [comboId, c.productId, c.quantity]
    );
  }
  tracker.combos.push(comboId);
  return comboId;
};

/**
 * items: [{ type: 'product' | 'combo', id, quantity }]
 * Inserted as superuser (bypasses owner guards) with a clean pending state.
 */
export const seedOrder = async (admin, actors, tracker, items, overrides = {}) => {
  const orderId = randomUUID();
  const o = {
    userId: actors.customerId,
    status: 'pending',
    paymentStatus: 'pending',
    stockManaged: true,
    ...overrides
  };
  await admin.query(
    `INSERT INTO public.orders (id, user_id, order_type, status, subtotal, total_amount, currency_id,
                                payment_status, payment_method, stock_managed, order_number)
     VALUES ($1, $2, 'product', $3, 10, 10, $4, $5, 'zelle', $6, $7)`,
    // Explicit number: the DB generator pads to 4 digits (LPAD truncates), so after 9999 orders per
    // day on a long-lived local DB it repeats and violates orders_order_number_key.
    [orderId, o.userId, o.status, actors.currencyId, o.paymentStatus, o.stockManaged, `TST-${orderId.slice(0, 13)}`]
  );
  for (const it of items) {
    await admin.query(
      `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, 'x', 'x', $4, 5, $5)`,
      [orderId, it.type, it.id, it.quantity, 5 * it.quantity]
    );
  }
  tracker.orders.push(orderId);
  return orderId;
};

export const cleanup = async (admin, tracker) => {
  const { products, combos, orders } = tracker;
  if (orders.length) {
    await admin.query(`DELETE FROM public.inventory_movements WHERE reference_id = ANY($1)`, [orders]);
    await admin.query(`DELETE FROM public.orders WHERE id = ANY($1)`, [orders]);
  }
  if (combos.length) await admin.query(`DELETE FROM public.combo_products WHERE id = ANY($1)`, [combos]);
  if (products.length) {
    await admin.query(
      `DELETE FROM public.inventory_movements WHERE inventory_id IN (SELECT id FROM public.inventory WHERE product_id = ANY($1))`,
      [products]
    );
    await admin.query(`DELETE FROM public.inventory WHERE product_id = ANY($1)`, [products]);
    // The inventory BEFORE DELETE trigger snapshots every batch; keep the local log clean.
    await admin.query(
      `DELETE FROM public.admin_destructive_ops_log WHERE op_type = 'inventory_batch_deleted' AND details->>'product_id' = ANY($1)`,
      [products.map(String)]
    );
    await admin.query(`DELETE FROM public.products WHERE id = ANY($1)`, [products]);
  }
  tracker.products.length = 0;
  tracker.combos.length = 0;
  tracker.orders.length = 0;
};

export const readInventory = async (admin, productId) => {
  const { rows } = await admin.query(
    `SELECT id, quantity, reserved_quantity AS reserved FROM public.inventory WHERE product_id = $1 ORDER BY id`,
    [productId]
  );
  return rows;
};

export const readOrder = async (admin, orderId) => {
  const { rows } = await admin.query(
    `SELECT status, payment_status, rejection_reason, stock_managed, stock_reserved FROM public.orders WHERE id = $1`,
    [orderId]
  );
  return rows[0];
};

export const readAllocations = async (admin, orderId) => {
  const { rows } = await admin.query(
    `SELECT inventory_id, quantity, state FROM public.order_stock_allocations WHERE order_id = $1 ORDER BY inventory_id`,
    [orderId]
  );
  return rows;
};

const POLICY_DEFAULTS = {
  stock_unpaid_expiry_hours: 48,
  stock_proof_expiry_hours: 168,
  stock_max_open_reservations: 5
};

/** Upsert raw stock policy rows as superuser (bypasses the RPC validation on purpose). */
export const setStockPolicyRows = async (admin, values) => {
  for (const [key, value] of Object.entries(values)) {
    await admin.query(
      `INSERT INTO public.system_config (key, value_numeric, description)
       VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value_numeric = EXCLUDED.value_numeric`,
      [key, value, `Stock policy test row restored by the harness for ${key} (see the migration for the real description).`]
    );
  }
};

/** Put the three stock policy rows back to the approved defaults. */
export const restoreStockPolicyRows = (admin) => setStockPolicyRows(admin, POLICY_DEFAULTS);
