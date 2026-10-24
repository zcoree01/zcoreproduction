# Status

Progress log. Read at session start, update at session end. Newest entry on top.

## Current phase

**Phase 1 — Foundation** (see `ZCORE_CONTEXT.md` §14). Database foundation, login, tenant resolution and user creation are in place. Next: remaining Phase 1 pieces (user deactivation/role change, org settings), then Phase 2.

## Implemented

- Next.js 16 (App Router, TypeScript strict + `noUncheckedIndexedAccess`, Cache Components + Partial Prefetching), Tailwind CSS 4, shadcn/ui (base-nova): sidebar, sheet, dropdown-menu, alert-dialog, field, empty, badge, avatar, breadcrumb, skeleton, sonner, tooltip, table, card, input, native-select, alert.
- **App shell** (structure from shadcn blocks `dashboard-01` / `login-03`, no demo data):
  - Desktop `(app)`: inset sidebar (org header, nav groups, user menu with sign-out), site header with sidebar toggle, breadcrumb and theme switch.
  - Mobile `(floor)`: sticky header + fixed bottom navigation (48px+ targets, safe-area aware); sign-out asks for confirmation.
  - Navigation registry `src/lib/navigation/registry.ts`: items filtered by enabled `org_modules` and the member’s permissions (read through RLS). Only implemented routes are listed.
  - Light/dark/system theme (`next-themes`), toasts (`sonner`), 8px spacing grid.
- **Shared components** (`src/components/shared/`): `DataTable` (TanStack Table v9, server-side pagination/search/filters via URL), `StatusBadge`, `EmptyState` (shadcn Empty), `ErrorState`, `PermissionDenied`, `ConfirmDialog` (AlertDialog), `PageHeader`, `PageSuspense`, `ModeToggle`. Forms use react-hook-form + Zod (same schema on the server) + shadcn Field with errors next to the field.
- i18n via `next-intl`, single locale `bs`, no locale in URL. All UI strings in `messages/bs.json` (typed).
- Supabase project `nwzxigwgttdfgxnxjbvx` (eu-west-1) linked; migrations applied with `npx supabase db push`.
- **Database foundation** (`supabase/migrations/20261023160000…160400`):
  - Tables: `organizations`, `modules`, `permissions`, `roles`, `role_permissions`, `profiles`, `memberships`, `audit_log`, `org_modules`.
  - RLS on all tables; access = active membership (`private.user_org_ids()`), writes = permission (`private.has_permission()`); `anon` has no table grants.
  - Composite tenant FKs; org bootstrap trigger (5 system roles, default permissions, `core` module); auth-user provisioning trigger (profile + membership, synthetic e-mail check); append-only `audit_log` with row-change auditing; `write_audit()` RPC.
  - `get_login_organization(slug)` (`20261023170000`): anon-callable, returns only the org display name for the login screen.
- **Tenant resolution** (`src/lib/tenant/resolve.ts`): `<slug>.zcore.ba` / `<slug>.localhost`; `?org=<slug>` (remembered in cookie `zcore_tenant`) only on localhost / `*.vercel.app`. Host is read from `x-forwarded-host` first (needed for server-action redirects, see D-009).
- **`src/proxy.ts`** (Next 16 name for middleware): resolves tenant → `x-zcore-tenant` request header (always overwritten), refreshes the Supabase session, redirects to `/login` unless the session's synthetic e-mail belongs to this tenant, and `/login` → `/` when already signed in.
- **Auth** (`src/modules/auth/`, `src/lib/auth/`): username + password login (synthetic e-mail), generic error for wrong credentials, deactivated-account and rate-limit messages, sign-out. `getCurrentMember()` / `requireMember()` (request-cached, tenant-checked, RLS-backed). `requirePermission()` / `hasPermission()`.
- **Routing by role** (`src/lib/auth/home.ts`): operator → `/floor`; all other roles (incl. custom) → `/dashboard`. `(app)` layout sends operators to `/floor`; `(floor)` is open to every member.
- **Screens:** `/login`, `/dashboard` (placeholder: no modules active), `/floor` (mobile-first placeholder), `/admin/users` (server-paginated DataTable with search, role and status filters over the `member_directory` view; add-user sheet for `users.manage`; PermissionDenied without `users.read`). Loading, empty, no-results, error and denied states.
- `member_directory` view (`20261023180000`, `security_invoker`): flat member list for tables; covered by tenant-isolation tests.
- **Add user** (`src/modules/users/`): `requirePermission('users.manage')` → Zod → role checked via RLS → Auth Admin API (service role, `src/lib/supabase/admin.ts`) → trigger provisions profile + membership → explicit audit `users.create` (no password logged). Duplicate username → field error.
- Tests: `npm run check` (66 unit tests), `npm run test:db` (34 RLS/integration tests), `npm run e2e` (22 Playwright tests: login of all 5 demo roles, field validation, wrong password, protected routes, operator kept out of the app, bottom-nav sign-out with confirmation (mobile), subdomain tenant, sidebar filtered by permission, users table search/filters, dark theme, admin creates user who then logs in).
- CI: `check` + `build` on every push/PR (DB and e2e tests need Supabase secrets; not in CI yet).
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

## Demo data

Organization `demo` („Demo Metal d.o.o."), created by `npm run seed:demo` (idempotent). Users: `scripts/lib/demo-users.ts`.

**Passwords are not in the repository** (it is public). All demo users share `DEMO_PASSWORD` from `.env.local`; `npm run seed:demo` applies it. Passwords committed before 2026-10-24 were rotated and no longer work.

Local login: `http://localhost:3000/login?org=demo` or `http://demo.localhost:3000/login`.

| Role               | Username          | Lands on     |
| ------------------ | ----------------- | ------------ |
| admin              | `admin`           | `/dashboard` |
| director           | `direktor`        | `/dashboard` |
| head_of_production | `sef.proizvodnje` | `/dashboard` |
| warehouse          | `skladiste`       | `/dashboard` |
| operator           | `operater`        | `/floor`     |

Permanent test tenants (`tests/shared/test-tenants.ts`): `test-tenant-a`, `test-tenant-b` (users `admin`, `operater`, password `TEST_TENANT_PASSWORD` from `.env.local`). Created by `npm run test:db`; e2e needs them. Every e2e run adds one `e2e.*` operator user with a random password to `test-tenant-a`.

## Not done yet / known gaps

- No forced password change on first login; admins hand out the initial password.
- Users can be created but not yet edited, deactivated or re-roled in the UI (RLS already allows `users.manage` to update memberships).
- No custom-role management UI; no org settings screen.
- After login the user always lands on the role home (no "return to requested page").
- Dev overlay shows an informational `instant` validation message when an operator opens `/dashboard` (intentional redirect to `/floor`).
- Table sorting is fixed (by username); column sorting UI not yet added to DataTable.
- Demo org contains an extra user `testniradnik` (Direktor) created by hand via the UI on 2026-10-23 (audit log: `users.create` by `admin`). Tests do not depend on the exact user count.
- DB/e2e tests run against the real linked project (no Docker, no separate test project).
- Supabase Auth: enable leaked-password protection in the dashboard (advisor warning). Advisor warnings for `write_audit` and `get_login_organization` are intentional.

## Next step

User management completion: edit full name / role, deactivate & reactivate (archive membership), reset password by admin, with audit entries and e2e coverage. Then Phase 2 (machines, employees, products, production orders).

## Log

### 2026-10-23 — App shell and shared components

- Sidebar (desktop) and bottom navigation (mobile) filtered by `org_modules` + permissions; theme switch; shared DataTable/StatusBadge/EmptyState/ErrorState/PermissionDenied/ConfirmDialog; react-hook-form forms (login, add user in a sheet); `member_directory` view.
- Adapted to TanStack Table v9 API (`tableFeatures`, `useTable`, `FlexRender`); replaced shadcn `use-mobile` with a `useSyncExternalStore` version (lint rule `set-state-in-effect`).
- Verified: `npm run check` (66), `npm run test:db` (34), `npm run e2e` (22), `npm run build`, `npm run format:check`; no browser console errors on main screens; screenshots checked in light/dark and mobile.

### 2026-10-23 — Login, tenant resolution, role routing, add user

- `proxy.ts`, tenant resolver, username login, sign-out, role-based homes, `/admin/users` with add-user form, migration `get_login_organization`.
- Found & fixed: server-action `redirect()` is rendered by Next via an internal fetch to `localhost` (original host only in `x-forwarded-host`), which lost the subdomain tenant → tenant resolver prefers `x-forwarded-host`.
- Found & fixed: Supabase `getClaims()` uses `Date.now()`; with Partial Prefetching this must run at request time → `await connection()` in `getCurrentMember()`; page content wrapped in `<Suspense>` (`PageSuspense`).
- Verified: `npm run check` (45), `npm run test:db` (32), `npm run e2e` (16), `npm run build`, `npm run format:check` all green; advisors reviewed.

### 2026-10-23 — Phase 1 database foundation

- Migrations, RLS, triggers, `requirePermission`, provisioning, demo seed, tenant-isolation tests. Fixed GoTrue `app_metadata` follow-up UPDATE in the provisioning trigger.

### 2026-10-23 — Project skeleton

- Scaffolded the app and tooling. Verified: `npm run check`, `npm run build`, `npm run e2e` green.
