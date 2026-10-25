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

## D-012 — Machines, employees and catalogs (module `production`) (2026-10-24)

- **Module `production`** groups machines and employees (and later production orders). Activation stays a commercial, service-role-only decision (`org_modules`); pages check it for UX, access is governed by permissions + RLS.
- **Catalogs are one table `catalog_items` with a `kind`** (machine_type, location, department, job_title, skill) instead of one table per list. Referencing tables carry a generated constant column (`type_kind = 'machine_type'` …) and a composite FK `(organization_id, kind, id)`, so a reference is always same-tenant and of the right kind. New configurable lists (downtime reasons, scrap reasons …) add a `kind` value, not a table. Names are unique per kind among non-archived items; archiving keeps existing references.
- **Permissions:** `machines.read/manage`, `machines.status.update`, `employees.read/manage`. Catalog kinds map to `machines.manage` or `employees.manage` (`private.catalog_manage_permission`, mirrored in `CATALOG_MANAGE_PERMISSION`).
- **Machine status changes by operators go through `set_machine_status`** (SECURITY DEFINER): operators have no UPDATE on `machines`; the function allows them only machines they are qualified for (active, non-archived employee linked to their account) and never `inactive`. Status bookkeeping (`status_changed_at/by`) is a trigger, history is the audit log.
- **Employee writes go through `save_employee`** (SECURITY INVOKER, so RLS still applies): employee row, skills and machine assignments in one transaction; employee numbers assigned as max+1 under a per-organization advisory lock and never reused (archived employees keep theirs).
- **Archive vs. status:** `status` is operational (machine `inactive`, employee `inactive`), `archived_at` removes a record from lists/selects (mistakes, decommissioned). Both are kept, both reversible.
- **An account belongs to at most one non-archived employee** (partial unique index); an employee needs no account.

## D-013 — One active session per user (2026-10-24)

**Context:** Workers share floor tablets and also use their phones. Supabase's default sign-out revokes every session of the user; the product owner wants device-only sign-out, but at most one signed-in device per account.
**Decision:**

- `signInAction` calls `signOut({ scope: "others" })` after a successful sign-in; `signOutAction` uses `scope: "local"`.
- Revoked sessions still hold a valid JWT until it expires, so `src/proxy.ts` calls `public.is_session_active()` (SECURITY DEFINER, reads `auth.sessions` for the JWT's `session_id`) on every request of a signed-in user. A replaced session is signed out locally and redirected to `/login?session=replaced`.
- The check fails open on infrastructure errors (logged): it enforces the single-session policy, not authentication; JWT, membership, permissions and RLS are checked independently.
  **Consequences:** One extra database round-trip per request of a signed-in user. Playwright runs serially (sign-ins of the same demo users would revoke each other). If several people ever need to share one account, this must become configurable per organization.

## D-014 — Products, revisions, routings and attachments (2026-10-24)

**Context:** Parts are identified by the customer's part number and change through drawing revisions; production orders (next) must point at an exact revision, and old revisions must stay readable and restorable.
**Decision:**

- **Product = identity, revision = content.** `products` holds part number, name, customer, type, unit; `product_revisions` holds drawing, material, blank and the routing/attachments hang off the revision. Exactly one current revision per product (partial unique index). Only the current revision of a non-archived product is writable — enforced by triggers, not just the UI. Going back = `set_current_revision` (the older row becomes current again); a new revision copies everything from a source revision in one transaction.
- **Operation types are their own table** (`operation_types`: name, abbreviation, internal/external) instead of a `catalog_items` kind, because they carry extra attributes. Whether an operation is external comes from its type; the trigger rejects machines/times on external operations.
- **Sequence numbers** (10, 20, 30 …) are unique per revision including archived operations (deferrable unique constraint); moving swaps numbers so the order stays readable on paper and orders.
- **Cycle time is stored in seconds** (`numeric(12,3)`): minutes with up to 3 decimals convert exactly, the reverse does not. Display/entry unit = machine's `cycle_time_unit`, else `organizations.settings.cycle_time_unit` (default minutes). The edit form keeps the exact stored value when the rounded display is not changed.
- **Decimals never pass through JS floats:** forms produce canonical decimal strings (`lib/decimal`), written to `numeric` columns as strings (`numericParam`, PostgREST accepts them). Generated types still say `number`.
- **Units are a fixed list** (`pcs, kg, m, m2, set`), not a catalog: inventory will need conversions between known units, and every organization needs `kom` as default without seeding.
- **Attachments live in a private bucket `product-files`**, path `<org>/<product>/<uuid>.<ext>`, chosen by the server. Storage RLS: read with `products.read`, insert with `products.manage`, first path segment must be an organization where the user has the permission; no update/delete policies. Upload goes browser → Storage via a signed upload URL (Vercel function bodies are limited to 4.5 MB); the server then records size/type read back from Storage. Revision copies reference the same file.
- **History** is the audit log (row triggers + semantic `write_audit` entries), exposed per product by `product_history` (SECURITY DEFINER with its own `products.read` check), because `audit_log` itself needs `audit.read`.
- **Permissions:** `products.read` (admin, director, head of production, warehouse), `products.manage` (admin, director, head of production; also operation types, product types, material shapes). Operators will read products through their production orders.
  **Consequences:** Production orders reference `product_revisions.id`. Changing an older revision requires making it current first (audited). Storage files are never deleted by the app.

## D-015 — Customers, materials, raw piece weight and inspection planning (2026-10-24)

**Context:** First user feedback on products: customers and materials must be lists (not text), the raw piece weight should be calculated, revision labels are often absent, routing numbers are noise, and some companies inspect after every operation.
**Decision:**

- **Customers** are a tenant table (`customers.read/manage`); products reference them. Existing free-text names were migrated, the text column dropped. Production status per customer comes with orders.
- **Materials** are two levels: `material_groups` (default density) → `materials` (designation, optional density). A starter list is seeded per organization by a trigger (and for existing ones in the migration); densities are editable data, not code. Revisions reference a material; old text grades were matched or created in group "Ostalo".
- **Raw piece:** one shape field decides which dimensions apply (DB check + Zod mirror). The piece length is `cut_length_mm`; weight is derived, never stored (`rules.blankWeightKg`, exact decimals). The `material_shape` catalog kind was replaced by the shape.
- **Routing order is owned by the database:** `sequence` is an internal position; reordering sends the full ordered id list (`reorder_product_operations`). `private.normalize_routing` renumbers and places generated inspections (`auto_inspection`, deletable only by the function via an RLS policy limited to those rows) according to `products.inspection_plan`; it runs after every routing change, revision copy and plan change. Generated inspections reuse rows when possible so the audit log stays readable; the history view hides them and pure renumbering, and logs `products.routing_reordered` instead.
- **Inspection mode** is an organization setting (`settings.inspection_mode`: automatic → plan "between", manual → "none", custom → asked per product: "between" or "final"). The plan stays editable per product. The inspection operation type is marked with `operation_types.is_inspection` (never external).
- **Revision labels are optional** for the first revision; new revisions require one.
- Native HTML5 drag & drop (no new dependency) with arrow buttons as the keyboard/touch alternative.
  **Consequences:** Production orders will copy the normalized routing (including generated inspections) into order operations. Changing the organization's mode does not change existing products.

## D-016 — Production orders, numbering, floor visibility and the inspector role (2026-10-25)

**Context:** Production orders must be a stable snapshot of a drawing revision, numbered in the company's own format, prioritised for the shop floor and visible to workers without giving them access to products or orders in general.
**Decision:**

- **Snapshot:** `create_production_order` copies the revision's routing (incl. generated inspections) into `production_order_operations` and its drawings into `production_order_attachments`. Product changes never touch existing orders. "Change of drawing on the existing order" (`replace_order_drawings`) archives the order's drawing rows and adds those of another revision of the same product (newer or older); operations stay. New drawing = new order otherwise.
- **Numbers:** template in `organizations.settings.order_number_template` with tokens `{KUPAC}` (customer number), `{SEDMICA}` (ISO week), `{GODINA}`/`{GODINA4}`, `{BROJ}` (sequence per organization and calendar year, padded to `order_number_digits`). The template must contain `{BROJ}` and a year (DB check). Numbers are assigned by a BEFORE INSERT trigger, so clients cannot choose them. Sequences come from `private.counters` (insert … on conflict do update … returning in the inserting transaction): concurrent orders wait on the counter row and never share a number; nothing is reused. Default `RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}`.
- **Customer numbers** (`customers.customer_number`): automatic from the same counter mechanism (0/omitted = next), editable; unique among active customers; a number taken by hand raises the counter so it is never handed out automatically. Taking over an archived customer's number needs confirmation in the app; old orders keep pointing at the archived customer (FK), so they never mix.
- **Statuses:** order matrix and operation matrix live in SQL (`private.order_transition_allowed`, `private.operation_transition_allowed`) and are mirrored in `status-rules.ts` for the UI. Status changes only through SECURITY DEFINER functions (no column grant on `status`) that write `production_order_status_history`. Cancelling needs a reason; "completed" is blocked by `private.order_completion_allowed()` (always false) until production reporting replaces it with reported good pieces. Releasing to ready/in progress needs a machine on every internal non-inspection operation.
- **Editing by status** is enforced by triggers: quantity/raw piece/bar only in draft/planned, schedule fields until closed, operations added/removed only in drafts, closed orders immutable.
- **Assignment:** a machine per operation (any type, warning when it differs from the routing's type); workers optional. With workers only they see the operation, otherwise everyone qualified for the machine. Workers must be qualified for the machine (`employee_machines`); inspection operations only accept employees whose account has `quality.inspect`. Overlap of active operations on the same machine (own planned times, else the order's planned days) is a warning, never a block.
- **Priority** 1 (extremely urgent) … 5; manual by default. Automatic mode computes it from slack = days to due − ⌈remaining planned time / work hours per day⌉ against four configurable thresholds; a manual value overrides it (with a warning in the form). Due-date warnings: overdue, behind (negative slack), due soon (configurable days, only while work has not started). Computed in SQL (`private.order_schedule`, used by the list view and the floor queue) and mirrored in `rules.ts`.
- **Floor access:** operators have no `orders.read`. SECURITY DEFINER functions `floor_operation_queue` / `floor_operation` / `order_file_path` and the storage policy `product_files_select_orders` return only operations (and their drawings) the caller's active employee may see, in floor statuses (planned … quality check). A foreign operation (QR) shows only the order number and its current operation. The worker of a cutting operation (`operation_types.is_cutting`) may set the material statuses, like the warehouse (`orders.material.update`).
- **New system role `quality_inspector` ("Kontrolor")** for every organization (bootstrap + backfill). Permissions: `orders.read`, `products.read`, `machines.read`, `quality.inspect`. Recording good/scrap at final inspection comes with production reporting.
- **Print:** `/orders/[id]/print` (route group `(print)`, no app chrome) renders A4 HTML; PDF via the browser's print dialog. QR codes (library `qrcode`, server-side SVG) link to `/floor/operations/<id>` on the tenant host (`?org=` on localhost/previews).
- Dates in client components use a fixed `d.m.yyyy.` format (`formatDay`), because browser and server ICU data differ (hydration mismatch with `bs` locale data).
  **Consequences:** Production reporting must replace `private.order_completion_allowed`, drive operation statuses and actual times, and can rely on `production_order_operations.id` (QR) as the reporting entry point. Shifts (Phase 3) should replace `work_hours_per_day`.
