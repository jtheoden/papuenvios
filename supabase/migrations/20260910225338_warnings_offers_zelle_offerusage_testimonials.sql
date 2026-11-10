-- Warnings de la auditoría 2026-09-10 (Etapa 7 del plan), resueltos con
-- evidencia real de call-sites (grep repo-wide) antes de escribir cada policy.

-- ── 7.1 (WARN-3.4): offers legible sin restricción alguna ──────────────────
-- offers_select (roles={public}, qual=true) exponía TODO (ofertas inactivas,
-- vencidas, en borrador) a cualquiera, incluido anon. HomePage.jsx:207 (landing
-- pública sin auth) sí necesita ver ofertas activas y vigentes — decisión del
-- usuario: público solo para esas, resto exclusivo de authenticated.
DROP POLICY IF EXISTS "offers_select" ON public.offers;

CREATE POLICY "offers_select_public_active" ON public.offers
  FOR SELECT
  USING (
    is_active = true
    AND (start_date IS NULL OR start_date <= now())
    AND (end_date IS NULL OR end_date >= now())
  );

CREATE POLICY "offers_select_authenticated" ON public.offers
  FOR SELECT TO authenticated
  USING (true);

-- ── 7.2 (WARN-3.5): zelle_transaction_history sin dueño ─────────────────────
-- La tabla NO tiene columna de usuario propietario (ledger interno de cuentas
-- Zelle del negocio: zelle_account_id, reference_id, status, validated_by —
-- no user_id). El único SELECT real en app code es DashboardPage.jsx (ruta
-- admin-only). El único INSERT real de un `user` regular es
-- registerZelleTransaction (CartPage.jsx / remittanceService.js) durante
-- checkout — no se puede exigir rol admin en INSERT sin romper ese flujo.
-- Fix real: SELECT admin-only (no hay lectura legítima para `user`); INSERT
-- sigue abierto a authenticated pero exige status='pending' (nadie puede
-- auto-insertar una fila ya 'validated'/'rejected', bypaseando la validación
-- del admin).
DROP POLICY IF EXISTS "zth_select_authenticated" ON public.zelle_transaction_history;
CREATE POLICY "zth_select_admin" ON public.zelle_transaction_history
  FOR SELECT TO authenticated
  USING (is_admin_user());

DROP POLICY IF EXISTS "zth_insert_authenticated" ON public.zelle_transaction_history;
CREATE POLICY "zth_insert_pending_only" ON public.zelle_transaction_history
  FOR INSERT TO authenticated
  WITH CHECK (status = 'pending');

-- order_status_history: osh_select ya estaba bien acotado (join a orders,
-- ownership OR is_admin_user()) — no es parte de este warning. osh_insert
-- (with_check=true) sí estaba abierto; ambos flujos reales (cancelOrder de
-- un user sobre su propia orden, y updateOrderStatus de un admin) quedan
-- cubiertos por el mismo criterio que ya usa osh_select.
DROP POLICY IF EXISTS "osh_insert" ON public.order_status_history;
CREATE POLICY "osh_insert_owner_or_admin" ON public.order_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND (o.user_id = auth.uid() OR is_admin_user())
    )
  );

-- ── 7.3 (WARN-3.6): offer_usage INSERT sin user_id = auth.uid() ────────────
-- orderDiscountService.js:261 inserta user_id directo desde el cliente sin
-- que RLS lo valide — un usuario podía insertar con el user_id de otro.
DROP POLICY IF EXISTS "authenticated users can insert usage" ON public.offer_usage;
CREATE POLICY "offer_usage_insert_own" ON public.offer_usage
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── 7.5 (WARN-3.8): 3 funciones SECURITY DEFINER sin chequeo de rol ────────
-- Evidencia de call-sites (grep + has_function_privilege, confirmado anon=true
-- en las 3): get_daily_operational_cost/refresh_user_category sin caller real
-- en src/ ni supabase/functions/ → admin-only. get_testimonial_author_profiles
-- SÍ tiene caller público real (testimonialService.js, sección pública de
-- testimonios) → no se le exige rol, se acota el WHERE a autores de
-- testimonios visibles.
CREATE OR REPLACE FUNCTION public.get_daily_operational_cost()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_daily_cost DECIMAL := 0;
  cost_record RECORD;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  FOR cost_record IN
    SELECT amount, frequency FROM operational_costs WHERE is_active = true
  LOOP
    CASE cost_record.frequency
      WHEN 'daily' THEN total_daily_cost := total_daily_cost + cost_record.amount;
      WHEN 'weekly' THEN total_daily_cost := total_daily_cost + (cost_record.amount / 7);
      WHEN 'biweekly' THEN total_daily_cost := total_daily_cost + (cost_record.amount / 14);
      WHEN 'monthly' THEN total_daily_cost := total_daily_cost + (cost_record.amount / 30);
      WHEN 'yearly' THEN total_daily_cost := total_daily_cost + (cost_record.amount / 365);
    END CASE;
  END LOOP;
  RETURN total_daily_cost;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_user_category(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_interaction_count integer;
  v_new_category text;
  v_old_category text;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT category_name INTO v_old_category
  FROM public.user_categories
  WHERE user_id = p_user_id;

  v_old_category := COALESCE(v_old_category, 'regular');
  v_interaction_count := public.count_user_interactions(p_user_id);
  v_new_category := public.get_category_from_interactions(v_interaction_count);

  IF v_new_category != v_old_category THEN
    INSERT INTO public.user_categories (user_id, category_name, assignment_reason, assigned_by)
    VALUES (p_user_id, v_new_category, 'automatic', NULL)
    ON CONFLICT (user_id) DO UPDATE
    SET category_name = v_new_category,
        updated_at = now();

    INSERT INTO public.user_category_history (user_id, old_category, new_category, change_reason)
    VALUES (p_user_id, v_old_category, v_new_category, 'Automatic recalculation');

    RETURN json_build_object(
      'success', true,
      'message', 'Category updated automatically',
      'old_category', v_old_category,
      'new_category', v_new_category,
      'interactions', v_interaction_count
    );
  ELSE
    RETURN json_build_object(
      'success', true,
      'message', 'Category unchanged',
      'category', v_new_category,
      'interactions', v_interaction_count
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_daily_operational_cost() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_user_category(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_operational_cost() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_category(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_testimonial_author_profiles(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.user_id, up.full_name, up.avatar_url
  FROM public.user_profiles up
  WHERE up.user_id = ANY(p_user_ids)
    AND up.user_id IN (
      SELECT t.user_id FROM public.testimonials t WHERE t.is_visible = true
    );
$$;
-- EXECUTE se mantiene para anon/authenticated (sección pública de testimonios)
-- — el gate real pasó a ser el WHERE, no el rol.
