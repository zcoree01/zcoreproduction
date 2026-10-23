# Status

Progress log. Read at session start, update at session end. Newest entry on top.

## Current phase

**Phase 1 — Foundation** (see `ZCORE_CONTEXT.md` §14). Database foundation is in place; no auth UI yet.

## Implemented

- Next.js 16 (App Router, TypeScript strict + `noUncheckedIndexedAccess`), Tailwind CSS 4, shadcn/ui (base-nova, `Button` only).
- i18n via `next-intl`, single locale `bs`, no locale in URL. Messages in `messages/bs.json`, typed through `src/types/next-intl.d.ts`. Default timezone `Europe/Sarajevo`.
- Zod-validated public env (`src/lib/env.ts`); typed Supabase browser + server clients (`src/lib/supabase/`, `Database` from generated `types.ts`).
- Supabase project `nwzxigwgttdfgxnxjbvx` (eu-west-1) linked; migrations applied with `npx supabase db push`.
- **Database foundation** (`supabase/migrations/20261023160000…160400`):
  - Tables: `organizations`, `modules`, `permissions`, `roles`, `role_permissions`, `profiles`, `memberships`, `audit_log`, `org_modules`.
  - RLS on all tables; access = active membership (`private.user_org_ids()`), writes = permission (`private.has_permission()`); `anon` has no grants.
  - Composite tenant FKs (a role/user of org B can never be attached to org A).
  - New organization → trigger creates 5 system roles, default role permissions (from `permissions.default_roles`), `core` module.
  - New auth user (Admin API with `app_metadata {organization_id, username, role}`) → trigger creates profile + membership in the same transaction; rejects e-mails that are not `<username>@<slug>.users.zcore.ba`.
  - `audit_log`: append-only (trigger blocks UPDATE/DELETE/TRUNCATE for everyone); automatic audit of organizations, roles, role_permissions, memberships, org_modules; `write_audit()` RPC for server actions.
- `requirePermission(orgId, key)` (`src/lib/auth/require-permission.ts`) → `checkPermission` → DB `has_permission` RPC (same function RLS uses). `PERMISSION_KEYS` in `src/lib/auth/permissions.ts`.
- Provisioning helpers `ensureOrganization` / `ensureUser` (`src/modules/organizations/provision.ts`); service-role client only in `scripts/lib/admin-client.ts` (outside `src/`).
- Tests: `npm run check` (21 unit tests), `npm run test:db` (32 integration tests against the linked project: tenant isolation, permissions, audit immutability, provisioning), Playwright smoke.
- CI: `check` + `build` on every push/PR (DB tests not in CI — no secrets there yet).
- Claude Code: Prettier hook after every Write/Edit; slash commands `/feature`, `/verify`, `/status`.

### Permission matrix (system roles)

| Permission            | admin | director | head_of_production | warehouse | operator |
| --------------------- | :---: | :------: | :----------------: | :-------: | :------: |
| `org.settings.manage` |   ✓   |          |                    |           |          |
| `users.read`          |   ✓   |    ✓     |         ✓          |           |          |
| `users.manage`        |   ✓   |          |                    |           |          |
| `roles.manage`        |   ✓   |          |                    |           |          |
| `audit.read`          |   ✓   |    ✓     |                    |           |          |

System roles' permissions are fixed (changed only via migration); tenants can manage permissions of custom roles.

## Demo data (DEMO ONLY — these credentials are public)

Organization `demo` („Demo Metal d.o.o."), created by `npm run seed:demo` (idempotent; resets these passwords).

| Role               | Username          | Password        |
| ------------------ | ----------------- | --------------- |
| admin              | `admin`           | `Demo-FDqqz3pO` |
| director           | `direktor`        | `Demo-Pic6xDHu` |
| head_of_production | `sef.proizvodnje` | `Demo-7AQcd2ap` |
| warehouse          | `skladiste`       | `Demo-Y3bwUg7I` |
| operator           | `operater`        | `Demo-BdVkdG3n` |

Auth e-mail = `<username>@demo.users.zcore.ba` (UI will only ask for the username).

Permanent test tenants used by `npm run test:db`: `test-tenant-a`, `test-tenant-b` (users `admin`, `operater`; password in `tests/db/fixtures.ts`). Do not use them for anything else.

## Not done yet / known gaps

- No login UI, no `proxy.ts` (session refresh + tenant resolution from subdomain / `?org=`), no org-slug → id lookup helper.
- `requirePermission` exists but no server action uses it yet (first users: user management).
- DB tests run against the real linked project (no Docker locally, no separate test project). Consider a separate Supabase project for tests before real customer data exists.
- Supabase Auth: enable leaked-password protection in the dashboard (advisor warning).
- Advisor `write_audit` SECURITY DEFINER warning is intentional (function checks membership, actor = `auth.uid()`).
- Route groups `(auth)`, `(app)`, `(floor)` are empty placeholders.

## Next step

Auth: username login page `(auth)/login` (username + password → synthetic e-mail), `proxy.ts` for session refresh and tenant resolution, current-organization helper, sign-out; then first server action using `requirePermission` (user management).

## Log

### 2026-10-23 — Phase 1 database foundation

- Migrations: foundation schema, functions/triggers, RLS, advisor fixes (FK index, revoke `rls_auto_enable`), provisioning fix (GoTrue writes `app_metadata` in a follow-up UPDATE, so the trigger now fires on INSERT or UPDATE of `raw_app_meta_data`; the 5 demo users created before the fix were backfilled).
- `requirePermission`, provisioning helpers, demo seed, tenant-isolation tests.
- Verified: `npm run check` (21 tests), `npm run test:db` (32 tests), `npm run build`, `npm run format:check` all green; Supabase advisors reviewed.

### 2026-10-23 — Project skeleton

- Scaffolded the app and tooling. Verified: `npm run check`, `npm run build`, `npm run e2e` green.
