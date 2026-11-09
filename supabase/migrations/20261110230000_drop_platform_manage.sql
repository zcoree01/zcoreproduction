-- D-050, ruling R1 cleanup: platform.manage was kept on the Administrator only
-- while production still ran the old code (it checked platform.manage). The new
-- code is live (deployed 2026-11-09) and checks the 13 granular platform
-- permissions, so the old catch-all permission is removed. save_custom_role
-- already refuses unknown keys, so nothing else changes.

delete from public.role_permissions where permission_key = 'platform.manage';
delete from public.permissions where key = 'platform.manage';
