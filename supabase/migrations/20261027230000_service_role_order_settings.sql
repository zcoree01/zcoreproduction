-- Fix: the CHECK organizations_order_settings_check calls
-- private.valid_order_settings(), which the service role could not execute,
-- so every server-side update of an organization (archiving a failed
-- registration, scripts, tests) failed with "permission denied" (D-026).
grant execute on function private.valid_order_settings(jsonb) to service_role;
