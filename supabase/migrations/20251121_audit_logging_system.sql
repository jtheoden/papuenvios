-- ============================================================================
-- AUDIT LOGGING SYSTEM
-- ============================================================================
-- Purpose: Implement comprehensive audit trail for all critical operations
-- Severity: HIGH (required for compliance, security, and debugging)
-- Created: 2025-11-21
--
-- Features:
-- - Tracks all CREATE, UPDATE, DELETE operations on critical tables
-- - Records user ID, timestamp, old/new values
-- - Automatic trigger-based capture
-- - Query-optimized for audit log searches
-- - Immutable (no DELETE allowed on audit_logs)
-- ============================================================================

-- ============================================================================
-- 1. CREATE AUDIT_LOGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What happened
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,

  -- Who did it
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- When
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Data changes
  old_values JSONB, -- NULL for CREATE
  new_values JSONB, -- NULL for DELETE

  -- Change reason/notes
  change_reason TEXT,

  -- Context
  ip_address INET,
  user_agent TEXT,
  session_id UUID
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON public.audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);

-- Full-text search on values
CREATE INDEX IF NOT EXISTS idx_audit_logs_old_values_gin ON public.audit_logs USING GIN (old_values);
CREATE INDEX IF NOT EXISTS idx_audit_logs_new_values_gin ON public.audit_logs USING GIN (new_values);

-- ============================================================================
-- 2. AUDIT LOG FUNCTIONS
-- ============================================================================

/**
 * Function to log operation
 * Called by triggers to record changes
 */
CREATE OR REPLACE FUNCTION public.log_audit_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_old_values JSONB;
  v_new_values JSONB;
BEGIN
  -- Convert row to JSONB
  IF TG_OP = 'DELETE' THEN
    v_old_values = to_jsonb(OLD);
    v_new_values = NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_values = to_jsonb(OLD);
    v_new_values = to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    v_old_values = NULL;
    v_new_values = to_jsonb(NEW);
  END IF;

  -- Insert into audit_logs
  INSERT INTO public.audit_logs (
    action,
    table_name,
    record_id,
    user_id,
    old_values,
    new_values
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    CASE
      WHEN TG_OP = 'DELETE' THEN OLD.id
      ELSE NEW.id
    END,
    auth.uid(),
    v_old_values,
    v_new_values
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Function to get audit history for a record
 */
CREATE OR REPLACE FUNCTION public.get_audit_history(
  p_table_name TEXT,
  p_record_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  action TEXT,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE,
  old_values JSONB,
  new_values JSONB,
  change_reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    audit_logs.action,
    audit_logs.user_id,
    audit_logs.created_at,
    audit_logs.old_values,
    audit_logs.new_values,
    audit_logs.change_reason
  FROM public.audit_logs
  WHERE
    audit_logs.table_name = p_table_name
    AND audit_logs.record_id = p_record_id
  ORDER BY audit_logs.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

/**
 * Function to get audit entries for a user
 */
CREATE OR REPLACE FUNCTION public.get_user_audit_log(
  p_user_id UUID,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  action TEXT,
  table_name TEXT,
  record_id UUID,
  created_at TIMESTAMP WITH TIME ZONE,
  change_reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    audit_logs.action,
    audit_logs.table_name,
    audit_logs.record_id,
    audit_logs.created_at,
    audit_logs.change_reason
  FROM public.audit_logs
  WHERE audit_logs.user_id = p_user_id
  ORDER BY audit_logs.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. TRIGGERS ON CRITICAL TABLES
-- ============================================================================

-- USER_PROFILES changes (role, is_enabled, status)
DROP TRIGGER IF EXISTS audit_user_profiles_changes ON public.user_profiles;
CREATE TRIGGER audit_user_profiles_changes
AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_entry();

-- REMITTANCES changes (status, delivery)
DROP TRIGGER IF EXISTS audit_remittances_changes ON public.remittances;
CREATE TRIGGER audit_remittances_changes
AFTER INSERT OR UPDATE OR DELETE ON public.remittances
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_entry();

-- ORDERS changes (status, payment)
DROP TRIGGER IF EXISTS audit_orders_changes ON public.orders;
CREATE TRIGGER audit_orders_changes
AFTER INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_entry();

-- ZELLE_ACCOUNTS changes (security sensitive)
DROP TRIGGER IF EXISTS audit_zelle_accounts_changes ON public.zelle_accounts;
CREATE TRIGGER audit_zelle_accounts_changes
AFTER INSERT OR UPDATE OR DELETE ON public.zelle_accounts
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_entry();

-- BANK_ACCOUNTS changes (security sensitive)
DROP TRIGGER IF EXISTS audit_bank_accounts_changes ON public.bank_accounts;
CREATE TRIGGER audit_bank_accounts_changes
AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_entry();

-- OPERATIONAL_COSTS changes
DROP TRIGGER IF EXISTS audit_operational_costs_changes ON public.operational_costs;
CREATE TRIGGER audit_operational_costs_changes
AFTER INSERT OR UPDATE OR DELETE ON public.operational_costs
FOR EACH ROW
EXECUTE FUNCTION public.log_audit_entry();

-- ============================================================================
-- 4. RLS POLICIES FOR AUDIT LOGS
-- ============================================================================

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Super admins can view all audit logs
CREATE POLICY "super_admins_view_all_audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  IN ('super_admin', 'admin')
);

-- Users can view audit logs for their own records
CREATE POLICY "users_view_own_audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Prevent deletion of audit logs (immutable)
CREATE POLICY "audit_logs_no_delete"
ON public.audit_logs
FOR DELETE
TO authenticated
USING (FALSE);

-- Prevent direct updates (immutable)
CREATE POLICY "audit_logs_no_update"
ON public.audit_logs
FOR UPDATE
TO authenticated
USING (FALSE);

-- Only system can insert (via trigger)
CREATE POLICY "audit_logs_no_direct_insert"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (FALSE);

-- ============================================================================
-- 5. HELPER FUNCTION: LOG OPERATION WITH REASON
-- ============================================================================

/**
 * Manually log an operation with change reason
 * For operations that need explicit audit trail
 */
CREATE OR REPLACE FUNCTION public.manual_audit_log(
  p_table_name TEXT,
  p_record_id UUID,
  p_action TEXT,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_change_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  INSERT INTO public.audit_logs (
    table_name,
    record_id,
    user_id,
    action,
    old_values,
    new_values,
    change_reason
  ) VALUES (
    p_table_name,
    p_record_id,
    auth.uid(),
    p_action,
    p_old_values,
    p_new_values,
    p_change_reason
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. CLEANUP POLICIES (Optional)
-- ============================================================================

/**
 * Function to archive old audit logs
 * Run monthly to move logs older than 90 days to archive
 * TODO: Create audit_logs_archive table first
 */
CREATE OR REPLACE FUNCTION public.archive_old_audit_logs(
  p_days_old INT DEFAULT 90
)
RETURNS TABLE (
  archived_count BIGINT,
  remaining_count BIGINT
) AS $$
DECLARE
  v_archive_date DATE;
  v_archived BIGINT;
  v_remaining BIGINT;
BEGIN
  v_archive_date := CURRENT_DATE - (p_days_old || ' days')::INTERVAL;

  -- TODO: Move to archive table when implemented
  -- For now, just count
  SELECT COUNT(*) INTO v_archived
  FROM public.audit_logs
  WHERE created_at < v_archive_date;

  SELECT COUNT(*) INTO v_remaining
  FROM public.audit_logs
  WHERE created_at >= v_archive_date;

  RETURN QUERY SELECT v_archived, v_remaining;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. VIEWS FOR AUDIT QUERIES
-- ============================================================================

/**
 * View: Recent audit changes
 * Shows last 100 changes across the system
 */
CREATE OR REPLACE VIEW public.vw_recent_audit_changes AS
SELECT
  al.id,
  al.action,
  al.table_name,
  al.record_id,
  up.email as user_email,
  up.full_name as user_name,
  al.created_at,
  al.change_reason
FROM public.audit_logs al
LEFT JOIN public.user_profiles up ON al.user_id = up.id
ORDER BY al.created_at DESC
LIMIT 100;

/**
 * View: User action history
 * Shows what each user has done
 */
CREATE OR REPLACE VIEW public.vw_user_action_history AS
SELECT
  up.id,
  up.email,
  up.full_name,
  up.role,
  COUNT(*) as action_count,
  MAX(al.created_at) as last_action_at
FROM public.user_profiles up
LEFT JOIN public.audit_logs al ON up.id = al.user_id
GROUP BY up.id, up.email, up.full_name, up.role
ORDER BY last_action_at DESC NULLS LAST;

-- ============================================================================
-- 8. GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.vw_recent_audit_changes TO authenticated;
GRANT SELECT ON public.vw_user_action_history TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_audit_history TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_old_audit_logs TO authenticated;

-- ============================================================================
-- 9. VERIFICATION AND DOCUMENTATION
-- ============================================================================

SELECT 'Audit logging system created at: ' || NOW() as status;

-- Show created objects
SELECT 'Audit Logs Table created' as object_type;
SELECT 'Triggers created: 6' as object_type;
SELECT 'Functions created: 5' as object_type;
SELECT 'Views created: 2' as object_type;
SELECT 'RLS Policies created: 5' as object_type;

-- ============================================================================
-- 10. USAGE EXAMPLES (in comments for documentation)
-- ============================================================================

/*
USAGE EXAMPLES:

1. View audit history for a specific remittance:
   SELECT * FROM public.get_audit_history('remittances', 'remittance-uuid');

2. View all actions by a user:
   SELECT * FROM public.get_user_audit_log('user-uuid');

3. View recent changes across system:
   SELECT * FROM public.vw_recent_audit_changes;

4. View user action history:
   SELECT * FROM public.vw_user_action_history;

5. Manually log an operation:
   SELECT public.manual_audit_log(
     'remittances',
     'remittance-id',
     'UPDATE',
     '{"status": "pending"}'::JSONB,
     '{"status": "delivered"}'::JSONB,
     'Delivery confirmed by admin'
   );

6. Check archive candidates:
   SELECT * FROM public.archive_old_audit_logs(90);
*/

-- ============================================================================
-- 11. MAINTENANCE NOTES
-- ============================================================================

/*
PERFORMANCE CONSIDERATIONS:

1. Table size growth:
   - Each operation: ~500 bytes (including JSONB data)
   - 1,000 operations/day = ~500KB/day = ~150MB/year
   - With 5,000 ops/day: ~2.5GB/year
   - Monitor quarterly

2. Query optimization:
   - Indexes created for common filters
   - Use created_at DESC for latest first
   - LIMIT results to prevent large exports

3. Regular maintenance:
   - Archive logs older than 90 days (when archive table created)
   - Vacuum table quarterly
   - Reindex monthly during low traffic

4. Alerts to implement:
   - Alert on failed login attempts (10+ in 1 hour)
   - Alert on role changes to super_admin
   - Alert on large transaction reversals
   - Alert on unusual data access patterns
*/

-- ============================================================================
-- 12. MIGRATION TRACKING
-- ============================================================================

INSERT INTO public._migrations_applied (migration)
VALUES ('20251121_audit_logging_system')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ Migration complete: Audit logging system' as final_status;
