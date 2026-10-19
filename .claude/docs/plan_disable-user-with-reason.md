# Plan: disable a user with a reason (super_admin only)

Branch: `feat/disable-user-with-reason`. Migration: `supabase/migrations/20261019130000_disable_user_with_reason.sql` (NOT applied to prod).

## Request
"Apartado gestion de usuario: opcion de deshabilitar algun usuario por x motivo; que la opcion la tengan los super admin."

## Decisions
1. `user_profiles` gets `disabled_reason`, `disabled_at`, `disabled_by` (no FK). CHECK is conditional on `disabled_at IS NOT NULL` because prod already has 1 user with `is_enabled=false` and no reason: a plain CHECK would reject any later UPDATE of that row.
2. Only app write path: RPC `set_user_enabled(uuid, boolean, text)` (SECURITY DEFINER, super_admin only, advisory lock, audit in `activity_logs`, idempotent). The profile guard trigger now also protects the three new columns.
3. Enforcement in the DB: RESTRICTIVE `FOR ALL TO authenticated` policy `<table>_block_disabled_user` on 12 tables, using a new `current_user_is_blocked()` (profile exists AND `is_enabled IS FALSE`).
4. UI: `UserStatusAction` (button + accessible dialog) replaces the old direct `UPDATE user_profiles` toggle in `UserManagement`. Super_admin only, never shown for self or other super_admins (same rule as the existing "Protected" row).
5. YAGNI: no Edge Function, no Supabase Auth ban in this stage.

## Tables protected (evidence: prod `pg_policies`, 2026-10-19)
orders, order_items, order_status_history, remittances, remittance_status_history, recipients, recipient_addresses, recipient_bank_accounts, shopping_carts, cart_items, user_alerts, testimonials. All have RLS enabled with user-owned policies. `user_profiles` is NOT restricted (AuthContext needs to read `is_enabled`).
Not touched: `remittance_bank_transfers`, `payment_reviews` (admin-only already), `order_stock_allocations` (SELECT only).

## Devil's advocate
- Live session: a disabled user keeps a valid JWT (up to ~1 h) and refresh tokens. The policies make that JWT useless for the business tables immediately; login/refresh still succeed. Future: Supabase Auth ban (`ban_duration`) via an Edge Function with the service key to close login and refresh.
- `current_user_is_enabled()` fails closed when there is no profile: a new user between `auth.users` INSERT and `handle_new_user()` would be locked out. Prod has 3 auth users without profile. Hence `current_user_is_blocked()` fails open for "no profile" and closed for `is_enabled = false` (tested).
- False positives: admins/super_admins stay enabled (`is_admin_user()` already requires `is_enabled=true`), `service_role` and the owner bypass RLS, staff processing a disabled customer's order is unaffected because the check uses `auth.uid()` of the caller (tested). `is_enabled IS NULL` is treated as not blocked (prod has none).
- Orders in progress of a disabled user: they stay in the DB and staff can keep processing/cancelling them; the customer just cannot read or write them. Nothing is cancelled automatically.
- SECURITY DEFINER RPCs callable by customers bypass RLS (e.g. `create_bizum_quote`): residual gap, closed only by the Auth ban.
- Last super_admin rule: unreachable through the RPC today (caller must be an enabled super_admin different from the target), kept as a defensive invariant; the real race (two super_admins disabling each other) is covered by the advisory lock + re-check (tested: exactly one wins).
- Reason visible to the disabled user: they can read their own profile row (needed for "Cuenta deshabilitada"), so `disabled_reason` is technically readable by them through the API. AuthContext does not display it. If that is not acceptable, move the columns to a staff-only table.
- Front deployed before the migration would break the user list (new columns in the SELECT): deploy order below.

## Order of application and "dales"
1. Review/merge the PR (no commit/push done by the agent).
2. Dale 1: apply the migration to prod (`supabase db push` or `apply_migration`), then verify (SELECT only): columns exist, 12 `*_block_disabled_user` policies, `set_user_enabled` has no anon EXECUTE, the legacy disabled user is unchanged.
3. Dale 2: deploy the front (Vercel) after step 2.
4. Smoke: as super_admin disable a test user with a reason; confirm the user cannot create orders; enable again.
5. Later: Auth ban Edge Function.

## Rollback
See the migration header (exact). The old guard body must be restored BEFORE dropping the columns.
