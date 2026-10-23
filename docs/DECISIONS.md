# Architectural decisions

Append-only. One entry per decision: context, decision, consequences. Newest at the bottom.

## D-001 — Stack (2026-10-23)

**Decision:** Next.js (App Router) + TypeScript strict, Tailwind + shadcn/ui, Supabase (Postgres, Auth, Storage, RLS), Zod, Vitest, Playwright, deployed on Vercel. As specified in `CLAUDE.md`; changes require explicit approval.

## D-002 — i18n with next-intl, single locale, no locale routing (2026-10-23)

**Context:** UI is Bosnian-only for now, but must support more languages later.
**Decision:** `next-intl` without `[locale]` URL segments. Locale is resolved in `src/i18n/request.ts` (currently fixed to `bs`). Messages live in `messages/<locale>.json`, typed via `AppConfig`.
**Consequences:** Adding a language = new JSON file + locale resolution (user/org preference), no URL restructuring. Tenant subdomain stays the only routing dimension.

## D-003 — Supabase publishable key naming (2026-10-23)

**Decision:** Browser/server user clients use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase's current key model). Service-role key is server-only (`SUPABASE_SERVICE_ROLE_KEY`) and never imported into client code.

## D-004 — Tooling details (2026-10-23)

- `@types/node` 24 (matches Node 24 runtime; required by Vitest 5 peer range).
- `tsconfig` adds `noUncheckedIndexedAccess` for safer array/record access in quantity and stock code.
- `typecheck` runs `next typegen` first so route types (`LayoutProps`, `PageProps`) exist in fresh CI checkouts.
- Prettier is enforced locally by a Claude Code PostToolUse hook (`.claude/hooks/format-file.mjs`) and available as `npm run format:check`; it is not part of `npm run check`.
- Tailwind runs through the `@tailwindcss/turbopack` loader configured in `next.config.ts` (create-next-app 16.4 default, no PostCSS config). Removing that `turbopack.rules` entry silently breaks all styling and the build.
- `cacheComponents` and `partialPrefetching` are enabled (create-next-app default). Request-time data (cookies, Supabase session) must be read inside `<Suspense>` boundaries.
- CI runs `npm run build` in addition to `npm run check`, because build-only failures (CSS pipeline, prerendering) are not caught by typecheck/lint/tests.

## D-005 — Env variable is `NEXT_PUBLIC_SUPABASE_ANON_KEY` (2026-10-23)

Supersedes the key name in D-003. The project's `.env.local` uses the anon key name, so code and `.env.example` follow it. The service-role key stays server-only.

## D-006 — Tenancy, roles and permissions model (2026-10-23)

- **One auth user per organization** (synthetic e-mail per org slug); `profiles.organization_id` is the user's organization. **One role per membership.** Multiple roles per user = future migration if needed.
- **Permissions are a global catalog** (`public.permissions`, keyed like `users.manage`), each with `default_roles`. Roles are per organization; 5 system roles are created by trigger on organization insert. New permissions in later migrations must also backfill `role_permissions` for existing orgs' system roles.
- **System roles are immutable for tenants** (their permissions change only via migration); tenants manage custom roles. This prevents an admin locking everyone out by removing `roles.manage` from the admin role.
- **Authorization lives in the database**: RLS policies and `requirePermission` both call `private.has_permission`, so UI, server and RLS cannot disagree.
- **Security-definer helpers live in schema `private`** (not exposed by PostgREST), with `search_path = ''`.
- **Module activation (`org_modules`) is service-role only** — it is a commercial decision, not a tenant setting.
- **`audit_log` is append-only for everyone** (trigger), has no FK to users, and is fed by row triggers on security-relevant tables plus `write_audit()`.
- **Users are created only via the Auth Admin API** with `app_metadata`; a trigger on `auth.users` (INSERT or UPDATE of `raw_app_meta_data`, because GoTrue writes metadata in a follow-up UPDATE) creates profile + membership in the same transaction.

## D-007 — DB integration tests against the linked project (2026-10-23)

No Docker locally, so RLS/trigger tests (`npm run test:db`, `tests/db/`) run against the linked Supabase project using two permanent tenants (`test-tenant-a/b`). Not part of `npm run check`/CI until a dedicated test project and CI secrets exist. Service-role client lives in `scripts/lib/` (outside `src/`) so app code cannot import it.

## D-008 — Tenant resolution and route protection (2026-10-23)

- Tenant = subdomain (`<slug>.zcore.ba`, dev `<slug>.localhost`). `?org=<slug>` + cookie only on localhost and `*.vercel.app` previews, never on the production domain.
- `src/proxy.ts` forwards the slug as `x-zcore-tenant` (always overwritten) and redirects to `/login` unless the session belongs to this tenant. "Belongs" is decided without a DB call: the slug encoded in the JWT's synthetic e-mail must equal the resolved slug. Pages and actions re-check via `getCurrentMember()` (membership through RLS); proxy is a coarse gate only.
- Role-based routing (operator → `/floor`, others → `/dashboard`) happens in layouts, because the role lives in the database, not in the JWT.
- Login screen shows the organization name through `get_login_organization(slug)` (anon, name only). Revealing that a slug exists is acceptable: subdomains are public.

## D-009 — Prefer `x-forwarded-host` for tenant resolution (2026-10-23)

Next.js renders a server action's `redirect()` by fetching the target route from its own origin (`Host: localhost`), passing the browser's host only in `x-forwarded-host`. Without preferring that header, a subdomain tenant was lost after login/logout. Vercel sets `x-forwarded-host` itself. Spoofing it can only change which login screen is shown; access still requires a session of that tenant, membership and RLS.

## D-010 — Session reads with Cache Components (2026-10-23)

- Session-dependent UI is rendered inside `<Suspense>` (layout shells and `PageSuspense` per page); no top-level session awaits in layouts.
- `getCurrentMember()` calls `await connection()` first: token validation depends on the current time and must never run inside a (runtime) prerender.
- Users are created through the Auth Admin API with the service-role client (`src/lib/supabase/admin.ts`, `server-only`), only after `requirePermission('users.manage')`; the role is first resolved with the user's own client (RLS) so a role id from another tenant is rejected before any privileged call.

## D-011 — App shell, navigation and shared UI (2026-10-23)

- **shadcn first:** sidebar, sheet, alert-dialog, field, empty, badge etc. come from shadcn (base-nova). Layout follows the `dashboard-01` and `login-03` blocks, without their demo data. Own components exist only where shadcn has none (bottom navigation) or as thin app-level wrappers (EmptyState over Empty, ConfirmDialog over AlertDialog, StatusBadge over Badge, DataTable over Table + TanStack).
- **Navigation registry in code** (`src/lib/navigation/registry.ts`), filtered by `org_modules` and permissions read through RLS. New modules add their routes there together with their `modules` row; no placeholder items for unbuilt modules.
- **Server-side tables:** table state lives in the URL (`page`, `pageSize`, `q`, filters), parsed with Zod (invalid values fall back to defaults) and queried with PostgREST `range` + `count: exact`. List screens read flat `security_invoker` views (e.g. `member_directory`) so filtering/sorting stays simple and RLS still applies. Free-text search is sanitized to letters/digits/space/.-_ before building `ilike` filters.
- **Forms:** react-hook-form + the same Zod schema as the server action; server actions take a plain object and re-validate; server field errors (e.g. username taken) are set on the field, others shown above the form; success via toast.
- **TanStack Table v9** (current stable) instead of v8 used in shadcn docs.
- **Spacing:** 8px grid (Tailwind spacing in steps of 2: `gap-2/4/6`, `p-4/6`); controls 32px, touch targets on the floor ≥48px.
