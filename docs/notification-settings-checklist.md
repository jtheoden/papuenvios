# Notification Settings Validation Checklist

Use this checklist to manually verify the new notification-settings Edge Function, client integration, and RLS protections.

## Prerequisites
- Run the latest migrations so `system_config` contains the `whatsapp_admin_phone`, `whatsapp_group`, and `admin_email` keys.
- Deploy the `notification-settings` Edge Function with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets configured.
- Have two test accounts: one admin (`role` = `admin` or `super_admin`) and one regular authenticated user.

## Admin happy-path
1. Sign in as the admin user.
2. Open the Settings page and verify notification values load without 401/403 errors in the browser console.
3. Update the WhatsApp, WhatsApp group, and Admin email fields and save.
4. Confirm the save succeeds (toast shown) and a subsequent refresh shows the updated values.

## Regular user restrictions
1. Sign in as the regular user.
2. Attempt to load the Settings page; notification settings should not load and the Edge Function should return 403.
3. Confirm the UI shows a friendly error (no raw Supabase error) and does not update any values.

## Direct policy enforcement
1. Using the regular user's session token, call `GET https://<project>.supabase.co/functions/v1/notification-settings`; expect a 403 response.
2. Using the admin's token, call the same endpoint; expect a 200 response with the three keys only.
3. From the SQL editor, verify `system_config` RLS policies block non-`service_role` access to the notification keys while leaving other keys readable by admins.

## Merge/Conflict guidance
- Prefer the Edge Function + `system_config` RLS changes over any legacy client-side direct table access. Those server-side updates enforce admin validation and service-role access to the notification keys and avoid the old anonymous insert path.
- Keep the `notificationSettingsService` version that calls `/functions/v1/notification-settings`; discard versions that read/write `system_config` directly from the browser.
