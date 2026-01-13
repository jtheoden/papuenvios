-- ============================================================================
-- USER ALERTS TABLE
-- Stores persistent alerts for users (e.g., when Zelle account is deactivated)
-- ============================================================================

-- Create the user_alerts table
CREATE TABLE IF NOT EXISTS public.user_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL, -- 'zelle_account_deactivated', 'payment_rejected', etc.
    severity VARCHAR(20) DEFAULT 'warning', -- 'info', 'warning', 'error', 'critical'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}', -- Additional data (operation_id, operation_type, amount, etc.)
    is_read BOOLEAN DEFAULT FALSE,
    is_dismissed BOOLEAN DEFAULT FALSE,
    action_required BOOLEAN DEFAULT TRUE,
    action_url VARCHAR(255), -- URL to redirect user for action
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    dismissed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE -- Optional expiration
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id ON public.user_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_type ON public.user_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_user_alerts_active ON public.user_alerts(user_id, is_dismissed, action_required);
CREATE INDEX IF NOT EXISTS idx_user_alerts_created ON public.user_alerts(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own alerts
CREATE POLICY "Users can view own alerts"
    ON public.user_alerts
    FOR SELECT
    USING (auth.uid() = user_id);

-- RLS Policy: Users can update their own alerts (mark as read/dismissed)
CREATE POLICY "Users can update own alerts"
    ON public.user_alerts
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Service role can insert alerts for any user
CREATE POLICY "Service can insert alerts"
    ON public.user_alerts
    FOR INSERT
    WITH CHECK (TRUE);

-- RLS Policy: Admins can manage all alerts
CREATE POLICY "Admins can manage all alerts"
    ON public.user_alerts
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
            AND user_profiles.role IN ('admin', 'super_admin')
        )
    );

-- Grant permissions
GRANT SELECT, UPDATE ON public.user_alerts TO authenticated;
GRANT INSERT ON public.user_alerts TO service_role;

-- Add comment
COMMENT ON TABLE public.user_alerts IS 'Stores user notifications/alerts that require attention (e.g., Zelle account changes)';
