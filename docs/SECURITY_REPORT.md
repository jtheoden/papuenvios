# Security Report

## Findings
- **Missing auditable trail for privileged actions and logins.** Super admin workflows lacked visibility over login, coupon, and configuration events.
- **Offer management actions were not tracked.** Changes to discounts or availability could not be audited.
- **Financial dashboard lacked integrity checks.** No quick view of validated vs. pending Zelle amounts to detect anomalies.

## Resolutions
- Added a dedicated **Activity Log** tab for super admins with filtering and search to audit system events.
- Implemented centralized activity logging for logins and offer create/update/delete/status changes with safe metadata serialization.
- Enhanced the financial tab with real-time totals for overall, validated, and pending Zelle volumes to surface inconsistencies early.

## Recommendations
- Ensure the `activity_logs` table has RLS allowing only super_admin access; enforce using policies aligned with audit needs.
- Periodically export activity logs to immutable storage for forensic readiness.
- Monitor Zelle validation rates; set alerts if pending volumes exceed expected thresholds.
