# Status

Progress log. Read at session start, update at session end. Newest entry on top.

## Current phase

**Phase 1 — Foundation** (see `ZCORE_CONTEXT.md` §14). Database foundation, login, tenant resolution and user creation are in place. Next: remaining Phase 1 pieces (user deactivation/role change, org settings), then Phase 2.

## Implemented

- Next.js 16 (App Router, TypeScript strict + `noUncheckedIndexedAccess`, Cache Components + Partial Prefetching), Tailwind CSS 4, shadcn/ui (base-nova: button, input, label, card, table, alert, native-select).
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
- **Screens:** `/login` (mobile-friendly, big inputs), `/dashboard` (placeholder: no modules active), `/floor` (mobile-first placeholder), `/admin/users` (list with role/status; add-user form for `users.manage`; access-denied state without `users.read`). Loading (Suspense skeletons), empty and error (`error.tsx`) states.
- **Add user** (`src/modules/users/`): `requirePermission('users.manage')` → Zod → role checked via RLS → Auth Admin API (service role, `src/lib/supabase/admin.ts`) → trigger provisions profile + membership → explicit audit `users.create` (no password logged). Duplicate username → field error.
- Tests: `npm run check` (45 unit tests), `npm run test:db` (32 RLS/integration tests), `npm run e2e` (16 Playwright tests: login of all 5 demo roles, wrong password, protected routes, operator kept out of the app, subdomain tenant, director read-only users page, admin creates user who then logs in, unknown/missing tenant).
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

## Demo data (DEMO ONLY — these credentials are public)

Organization `demo` („Demo Metal d.o.o."), created by `npm run seed:demo` (idempotent; resets these passwords). Source of truth: `scripts/lib/demo-users.ts`.

Local login: `http://localhost:3000/login?org=demo` or `http://demo.localhost:3000/login`.

| Role               | Username          | Password        | Lands on     |
| ------------------ | ----------------- | --------------- | ------------ |
| admin              | `admin`           | `Demo-FDqqz3pO` | `/dashboard` |
| director           | `direktor`        | `Demo-Pic6xDHu` | `/dashboard` |
| head_of_production | `sef.proizvodnje` | `Demo-7AQcd2ap` | `/dashboard` |
| warehouse          | `skladiste`       | `Demo-Y3bwUg7I` | `/dashboard` |
| operator           | `operater`        | `Demo-BdVkdG3n` | `/floor`     |

Permanent test tenants (`tests/shared/test-tenants.ts`): `test-tenant-a`, `test-tenant-b` (users `admin`, `operater`). Created by `npm run test:db`; e2e needs them. Every e2e run adds one `e2e.*` operator user to `test-tenant-a`.

## Not done yet / known gaps

- No forced password change on first login; admins hand out the initial password.
- Users can be created but not yet edited, deactivated or re-roled in the UI (RLS already allows `users.manage` to update memberships).
- No custom-role management UI; no org settings screen.
- After login the user always lands on the role home (no "return to requested page").
- Dev overlay shows an informational `instant` validation message when an operator opens `/dashboard` (intentional redirect to `/floor`).
- DB/e2e tests run against the real linked project (no Docker, no separate test project).
- Supabase Auth: enable leaked-password protection in the dashboard (advisor warning). Advisor warnings for `write_audit` and `get_login_organization` are intentional.

## Next step

User management completion: edit full name / role, deactivate & reactivate (archive membership), reset password by admin, with audit entries and e2e coverage. Then Phase 2 (machines, employees, products, production orders).

## Log

### 2026-10-23 — Login, tenant resolution, role routing, add user

- `proxy.ts`, tenant resolver, username login, sign-out, role-based homes, `/admin/users` with add-user form, migration `get_login_organization`.
- Found & fixed: server-action `redirect()` is rendered by Next via an internal fetch to `localhost` (original host only in `x-forwarded-host`), which lost the subdomain tenant → tenant resolver prefers `x-forwarded-host`.
- Found & fixed: Supabase `getClaims()` uses `Date.now()`; with Partial Prefetching this must run at request time → `await connection()` in `getCurrentMember()`; page content wrapped in `<Suspense>` (`PageSuspense`).
- Verified: `npm run check` (45), `npm run test:db` (32), `npm run e2e` (16), `npm run build`, `npm run format:check` all green; advisors reviewed.

### 2026-10-23 — Phase 1 database foundation

- Migrations, RLS, triggers, `requirePermission`, provisioning, demo seed, tenant-isolation tests. Fixed GoTrue `app_metadata` follow-up UPDATE in the provisioning trigger.

### 2026-10-23 — Project skeleton

- Scaffolded the app and tooling. Verified: `npm run check`, `npm run build`, `npm run e2e` green.
