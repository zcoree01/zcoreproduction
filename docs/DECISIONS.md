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

## D-017 — One QR code per order; "arrived" work on the floor (2026-10-25)

**Context:** Product owner review: a QR code per operation clutters the paper; workers want to see what is at their machine now.
**Decision:** The printed order carries one QR code to `/floor/orders/<id>`. `floor_order` returns the order's operations with `mine` (the caller may see it, same rule as D-016) and `arrived` (`private.operation_arrived`: every earlier active operation is done). The page redirects to the caller's arrived operation, or their only open one; otherwise it lists the operations. The floor home lists arrived operations of all the worker's machines; "Nalozi" lists all open ones (arrived or coming) with search across them.
**Consequences:** "Arrived" depends on operation statuses; until production reporting sets them, only first operations arrive (managers can set statuses by hand). Reporting may refine it to partial quantities (pieces passed on from the previous operation).

## D-018 — Production reporting: quantities flow, worker vs machine time, closing with a shortage (2026-10-26)

**Context:** Workers need start / pause / finish and good / scrap reporting on the phone; orders must complete only on reported good pieces. Product answers (2026-10-25): pause with a downtime reason; reports in parts, reported good pieces move on to the next operation immediately; scrap reason optional; inspections between operations and the final one are done by the inspector; an order with fewer good pieces than ordered is closed only after the head of production approves; several workers/shifts report separately; the cutting worker's "ready" records the cut pieces.
**Decision:**

- **Tables (migration `20261026100000`):** `production_reports` (good, scrap, optional scrap reason, idempotency key unique per organization, append-only; wrong reports are voided by a manager with a reason, never deleted), `production_work_sessions` (worker time: one open session per worker and operation), `production_downtime_events` (operation/machine standing still with a configurable reason, one open per operation), `production_order_close_requests` (pending → approved / rejected). Read with `orders.read`; written only by SECURITY DEFINER functions.
- **Quantities along the routing:** pieces that reached an operation = ordered quantity for the first one, otherwise the good pieces reported on the previous one; a previous operation done without reports (external work, status set by hand) passes on what reached it (`private.operation_input`). Good + scrap may never exceed that; pieces/sets only whole numbers. An operation "arrives" when the previous one is done or has passed on good pieces (`private.operation_arrived` redefined) and then becomes "ready".
- **Floor actions:** `start_operation_work` (needs an arrived operation and an order in ready / in progress / quality check; moves a ready order to in progress, machine to running), `pause_operation_work` (reason required; ends the caller's session; only when nobody else works on it the operation pauses, a downtime event opens and the machine stops), `report_operation_quantity` (in parts, idempotent; with `p_finish` it ends all sessions and pauses, marks the operation done and advances the order). Who may: the active employee who sees the operation (D-016); inspections only inspectors — unassigned inspections are visible to every inspector.
- **Time:** worker time = sum of sessions; machine time = time the operation was `in_progress` (from status history); downtime = sum of downtime events. Two workers on one operation double worker hours, never machine time.
- **Cutting:** order status "cutting" starts the cutting operation (and the caller's session); "ready" is refused while a cutting operation is open (`cut_quantity_required`) — `finish_cutting` records the cut pieces as the cutting operation's good quantity, finishes it and sets the order ready. Orders released before this module had their cutting operation closed by migration `20261026110000`, which also makes a manual "done" by the head of production advance the order like a floor finish.
- **Order status follows the work:** ready → in progress on the first start; → quality check when only inspections are left or everything is done with a shortage; → completed automatically when every operation is done and the last one reported at least the ordered good pieces. `private.order_completion_allowed` = that, or an approved close request. Closing with a shortage: inspector (or manager) `request_order_close` with a reason → `decide_order_close` with the new permission `orders.close.approve` (admin, director, head of production); rejecting needs a note. Completing or cancelling ends all open work.
- **Machine status** is driven by the work (running / stopped / available); machines in maintenance or inactive are left alone.
- Downtime and scrap reasons are catalog kinds `downtime_reason` / `scrap_reason` (managed with `orders.manage`), seeded per organization with starter lists.
  **Consequences:** Productivity reports, OEE and estimated completion can use sessions, downtime and operation run time. Finished-goods inventory (next phases) takes the good pieces of the last operation; scrap never enters it. Directory views now call private functions granted to `authenticated` only: service-role scripts read the base tables.

## D-019 — External steps, close-request notifications, order progress (2026-10-26)

**Context:** Product owner review of production reporting: external work (another company) is only tracked by the head of production; a request to close with a shortage must reach the head of production immediately and be visible as such; customers' orders need progress at a glance and filters.
**Decision:**

- **External operations** keep the operation status column but use their own matrix (`private.external_transition_allowed`, mirrored by `EXTERNAL_OPERATION_TRANSITIONS`): waiting → ready ("Priprema za isporuku") → in_progress ("Isporučeno") → done ("Primljeno (završeno)"), with steps back; no pause. Only `orders.manage` sets them; the floor never reports them. Labels come from `externalOperationStatus`; time "in progress" is shown as time at the other company.
- **Close requests** are not an order status: the order keeps its status (quality check), and every screen shows "Zahtjev za zatvaranje" while a request is pending (`close_request_pending` in the directory, status filter value `close_requested`). Approvers (`orders.close.approve`) get a bell in the app header (`pending_close_requests`), refreshed every 30 s, on navigation and on focus, with a toast for new requests linking to the order's "Proizvodnja" tab. No push/e-mail notifications yet.
- **Progress** per order (`private.order_progress`, SQL only): every active operation counts equally — done = 1, otherwise (good + scrap) / ordered quantity (max 1), shipped external work = ½; completed = 100 %. The current operation is the first one not done. Shown on the customer page, the order list (compact) and the order header.
- Customer page filters: order number / part number (one search box), urgency (effective priority) and status, as URL parameters.
  **Consequences:** The migration comment of `20261026120000` mentions a TypeScript mirror of the progress formula; there is none, the formula lives in SQL only.

## D-020 — Tool changes, downtime entries, figures and the foreman's day overview (2026-10-26)

**Context:** Review of the production-reporting spec against the implementation. The product owner asked for tool changes, downtime entered with a duration, actual cycle time vs plan, scrap rate and downtime by reason, and a live overview for the foreman; +/- buttons dropped; shifts move to the next module (shifts and working time).
**Decision:**

- **Tool changes** (`production_tool_changes`, migration `20261026130000`): tool as text (plus optional insert), reason from the new catalog kind `tool_change_reason` (starter list: Istrošen, Lom, Promjena programa, Ostalo), optional duration, idempotency key. Recorded by the worker who sees the (machine) operation or by `orders.manage`; not on inspections or external work. The tool store link comes later.
- **Downtime entries:** `record_downtime` adds a closed downtime event with a duration (source `entry`; pauses stay `pause`), idempotent. On the floor it ends now; managers may give the start on the order's "Proizvodnja" tab. A closed entry never changes the machine status.
- **Figures** (computed, not stored; `rules.ts`): actual cycle per piece = (machine running time − planned setup) / reported pieces, next to the planned cycle with the deviation in percent; scrap rate per operation = scrap / reported pieces; scrap rate of an order = all scrap / pieces that entered production (first operation with reports); downtime summed by reason.
- **Foreman's overview** `/production` ("Pregled proizvodnje", `orders.read`): one day in the organization's time zone (`production_day`), machines with status and who works on what, open downtime, reports, downtime by reason, tool changes, totals; filters machine / worker / order number and date; refreshed every 30 s while today is shown. Shift filter comes with the shifts module.
- **Floor forms and weak signal:** a form keeps its values and its idempotency key until the server confirms; a network failure shows a message and the same form can be sent again (no double quantity). A new key is created only after a confirmed save.
  **Consequences:** Shifts (next module) should attach sessions, reports and downtime to shifts and add the shift filter. Tool changes can later reference the tool store.

## D-021 — Shifts and working time, part A: shifts, clock-in / clock-out, alerts (2026-10-27)

**Context:** The product owner specified shifts and working time (definitions, schedule and rotation, clock-in on the phone and a kiosk, forgotten clock-outs, corrections with approval, overtime / night / weekend / holiday hours, absences and leave balance, payroll export in the FBiH format) and answered the open questions: workers have different shift patterns (8 h shifts, 12 h turnus, 4 crews); breaks paid or unpaid, with the option to extend the shift so it keeps whole working hours; early arrival (10–20 min) and lateness are not paid, a late worker may make up the time after the shift as regular hours (not overtime); late tolerance 10 min, "not arrived" after 120 min; overtime daily over the shift length (weekly selectable), no approval; forgotten clock-out closed after 22 h at the shift's end with a notice to the foreman; starting work without a clock-in clocks the worker in and notifies the head of production. Delivered in three parts: A (this decision), B (schedule calendar, rotation, absences, leave requests, corrections), C (overtime / night / weekend / holiday calculation, monthly overview, payroll export, kiosk).
**Decision:**

- **Own module `attendance`** ("Radno vrijeme", migration `20261026140000`), enabled wherever `production` is (also in the demo seed and test fixtures). Permissions `attendance.read`, `attendance.manage`, `shifts.manage` (admin, director, head of production). Clocking in needs no permission, only an active employee linked to the user.
- **Shifts** (`shifts` + `shift_breaks`): any start/end per organization; an end not after the start means the next day; breaks with or without a fixed time, paid or unpaid, validated in `save_shift` and mirrored by `shiftProblem`. The form offers to move the end when unpaid breaks leave less than whole hours (06:00–14:00 + 30 min unpaid → 14:30). Rules per organization in `attendance_settings` (one row, typed columns, `shifts.manage`), not in `organizations.settings`.
- **Presence ≠ time on operations:** `attendance_sessions` is separate from `production_work_sessions`. An exclusion constraint (btree_gist) forbids overlapping sessions of one employee, so a worker on two machines has one presence.
- **The server records the time** (`clock_in` / `clock_out`, idempotency keys for both directions). The shift is recognised at clock-in (`private.recognize_shift`): scheduled shifts when the schedule has entries for yesterday / today / tomorrow, otherwise any shift; candidate windows are [start − early window, end), and the closest start wins. Start, end and breaks are **snapshotted** on the session as UTC instants computed in the organization's time zone, so DST nights get their real length and later shift edits do not change past days.
- **Forgotten clock-out:** an open session older than `auto_close_after_hours` (default 22) is closed at its scheduled end (without a shift: at the clock-in, zero hours; never an invented time) with source `auto` and an `attendance_alerts` row. There is no scheduler: every attendance read or write (bell polling, board, worker screen, clock-in, start of work) runs `private.close_overdue_attendance`, and the result does not depend on when it runs.
- **Work without clock-in** (`start_operation_work`, attendance enabled): `auto_clock_in` (default) clocks in at that moment with source `operation` and an alert; `warn` lets work start (the floor home shows a notice); `block` refuses with `not_clocked_in`.
- **Hours are computed in TypeScript** (`src/modules/attendance/rules.ts`, server-side, unit-tested) from the snapshots: counting starts at the shift's start, lateness is deducted and may be made up after the end, unpaid breaks are deducted (fixed ones where they overlap, flexible ones once at least half of the shift is worked), and the rest after the end is overtime (rounding step prepared, applied in part C). All arithmetic on instants.
- **Alerts** go into the existing header bell (now close requests + attendance alerts) and onto the board `/attendance`, where the foreman marks them "Provjereno" with an optional note (audited).
  **Consequences:** Part B adds the schedule screens (table `shift_schedule` exists and recognition already uses it), crews/rotation, absences and corrections (sessions are archived and replaced, the original stays). Part C adds the payroll calculation, holidays, the monthly overview, exports and the kiosk. The clock-out button is labelled "Odjava s posla" so it is not confused with signing out of the app ("Odjava").

## D-022 — Temporary passwords, forced password change, profile settings (2026-10-27)

**Context:** Workers often have no e-mail, so a forgotten password cannot be reset by e-mail. Product owner (2026-10-26): every user can change their own password in the settings; a new user gets a generated password and sets their own at the first sign-in; only the administrator may reset passwords; a new worker can get an account with a role directly from the employee form, username = first name + "." + first letter of the last name, with more letters while taken; temporary passwords = a simple word + digits.
**Decision:**

- **No password is ever typed by the administrator.** The server generates a temporary password (`generateTempPassword`: one of ~56 simple Bosnian words without diacritics + three digits 2–9, e.g. `jabuka482`; `node:crypto` randomness). It is shown once in a dialog (copy, printable A6 card) and never stored readable or audited.
- **Usernames** are generated when left empty (`usernameCandidates`): normalized first name (č/ć→c, đ→dj, š→s, ž→z, other characters dropped) + `.` + 1…n letters of the last name, then the full last name with 2…99. The server reads which candidates exist (`profiles`, incl. deactivated users) and takes the first free one; a concurrent duplicate moves on to the next candidate.
- **`profiles.must_change_password`** (migration `20261026230000`): set atomically by the provisioning trigger from `app_metadata.must_change_password` on creation, and by the service role on an administrator reset (before the new password is set). Users have no column privilege on it; only the server clears it after a successful change. Existing users keep `false`.
- **Enforcement:** the proxy calls `session_status()` (one RPC for "session still active" and "must change password", replacing `is_session_active()` there) and redirects every path to `/change-password`; sign-in and the `(app)` / `(floor)` layouts also redirect, because a server-action redirect renders the target without passing the proxy. This is a policy, not a privilege boundary: the user is authenticated with their normal permissions; RLS stays the security layer.
- **Own password change:** first sign-in needs no current password (only while the flag is set). The profile form checks the current password with a separate, throw-away sign-in whose session is ended at once, so the single-session rule (D-013) is not triggered; then `auth.updateUser` (falls back to the Admin API only if Auth demands reauthentication, after the current password was verified). New password: 8–72 characters, not the username, not the current one. Audit `users.password_changed` (`forced: true/false`).
- **Administrator reset** (`users.manage` = admin only by default; not for oneself): flag → new temporary password → `revoke_user_sessions()` (service role only, deletes the user's `auth.sessions`, so the proxy signs every device out) → audit `users.password_reset`.
- **Employee + account:** the employee is saved first (`save_employee`), then the account is created and linked; both `employees.manage` and `users.manage` are required. If the account fails, the employee stays saved and the form says so (the account can be created again from the edit form).
- **Profile** (`/profile` in the app, `/floor/profile` on the floor): own data incl. the linked employee record, password change, theme (per device, next-themes) and text size (`profiles.preferences.text_size`, per user; `html:has([data-text-size=large])` raises the root font size), sign-out.
  **Consequences:** Forgotten passwords are handled by the administrator (hint on the login screen). A kiosk PIN (shifts module, part C) belongs in the profile as well. `is_session_active()` remains for compatibility and its tests.

## D-023 — Shifts and working time, part B1: crews, rotations and the schedule (2026-10-27)

**Context:** Part B of the shifts module (D-021) was split: B1 is the schedule (crews, rotations, calendar, copying a week); B2 absences, leave and corrections. Parts of the plant work differently (four crews on turnus, only the 1st shift, 1st/2nd/3rd shifts), so patterns must be data, not code.
**Decision:**

- **Crews** (`shift_crews`, `shift_crew_members`, migration `20261027100000`): an employee is in at most one crew (unique per organization); saving a crew moves members out of other crews.
- **Rotations** (`shift_rotations`, `shift_rotation_days`): a cycle of 1–56 days with a shift per day; days without a row are days off. **Assignments** (`shift_rotation_assignments`): a crew _or_ one employee follows a rotation from a start date (day 1 of the cycle) to an optional end; four crews on the same rotation simply start on different dates. An employee's own assignment wins over the crew's.
- **The schedule stays the single source** (`shift_schedule`, now with `source` `manual` / `rotation`). `apply_rotations` writes rotations for a visible range (max 62 days) and replaces only rotation rows; manual days (set in the grid or copied) are never overwritten. Ending an assignment removes its rotation days after the end. There is no background generation: the foreman applies rotations for the period shown (the grid makes this one click).
- **Copying a week** copies Monday–Sunday as manual days to another week, replacing the target week of the employees concerned.
- Planning rows are replaced or deleted (audited), not archived; attendance keeps its own snapshot, so changing the plan never changes recorded hours. Writes need `attendance.manage`, reads `attendance.read`; workers read only their own days (`my_schedule`).
- Weekday arithmetic on calendar dates is done on UTC midnights (`schedule-rules.ts`), mirrored by the SQL (`date` arithmetic), so DST never shifts a day.
  **Consequences:** Per-employee weekend days and the shift filter on the production overview move to part C (calculation). B2 adds absences and leave, which will show in the same grid.

## D-024 — Shifts and working time, part B2: absences, leave balance, corrections, HR role (2026-10-27)

**Context:** The product owner wants workers to request leave and report sick leave from the phone (with a photo of the sick note, so they need not come in while ill), a leave balance (20 days, more with years of service, one day per month during the first six months), corrections requested by the worker and approved by the foreman / head of production, and that managers never approve their own requests (admin / director do). Sick-leave details are visible only to the worker, the director and HR. Open questions (HR role, +1 day per 5 years, approver) were answered with the proposed defaults; all are configurable.
**Decision:**

- **New system role `hr` ("Kadrovska")** for every organization (bootstrap replaced, like Kontrolor in D-016), with `attendance.read`, `employees.read` and the new absence permissions. Demo user `kadrovska`.
- **Permissions:** `absences.read` / `absences.manage` (admin, director, head of production, HR), `absences.sensitive.read` (director, HR), `attendance.approve.managers` (admin, director).
- **Absences** (`absences`, migration `20261027120000`): kinds vacation, sick, paid / unpaid leave, day off; statuses requested → approved / rejected, cancelled; rejected and cancelled stay as history. An exclusion constraint forbids overlapping open absences of an employee. Requests are idempotent. Days are counted as Monday–Friday (`private.working_days`, mirrored by `workingDays`) until holidays exist (part C).
- **Sensitive data is separated:** the sick-leave reason and the sick-note file live in `absence_details` (RLS: own employee or `absences.sensitive.read`) and in the private bucket `absence-documents` (`<org>/<absence>/<file>`; upload by the employee or `absences.manage`, read by the employee or `absences.sensitive.read`). Lists for other managers show the absence and its note but never the reason; the audit log records only that details changed, not their content.
- **Who decides** (`private.can_decide`): the base permission (`absences.manage` / `attendance.manage`), not the employee concerned and not the requester; when the employee or the requester is a manager (holds `attendance.manage` or `absences.manage`), additionally `attendance.approve.managers`. A manager's entry for another employee is approved at once; for themselves it becomes a request.
- **Corrections** (`attendance_corrections`): fix a session or add a missing one, always with a reason, max 24 h, never in the future. Approval archives the original session and records a new one (sources `manual`, shift recognised at the new clock-in); overlaps are refused; alerts of the original are resolved. One open correction per session.
- **Leave balance:** rules in `attendance_settings` (base, extra days, every N years, maximum, first months), hire date and earlier service in `employee_work_info`, carry-over and an optional override per year in `employee_leave_years`; the entitlement is computed in `leave-rules.ts` (service counted up to 1 January; first months: one day per full month; year of hiring: proportional part, rounded). Used / requested days come from approved / requested vacation.
- The board shows "Na odsustvu" instead of "Nije došao" for an approved absence; the bell lists requests the caller may decide.
  **Consequences:** Holidays (part C) will change working-day counts; per-employee weekends and turnus workers' leave days (counted on scheduled days instead of Monday–Friday) belong to part C as well. Absences are not shown in the schedule grid yet.

## D-025 — Open sick leave, interrupting an absence, no rejection without a reason (2026-10-27)

**Context:** Product owner review of part B2: a worker does not know how long sick leave lasts, so it is reported from its first day and closed later; a second sick leave must not be opened while one is open. A running multi-day absence needs an "interrupt" request for the head of production instead of a new request. Rejecting without a reason must not be possible (the app appeared to block).
**Decision:**

- **Open sick leave** (migration `20261027140000`): `absences.end_date` may be null for kind `sick` only. While open it counts days up to today, and in the overlap constraint it counts as its first day only (`20261027150000`), so planned absences after it stay possible. `close_sick_leave` sets the last day (not before the start, not after today; refused with `absence_overlaps` when the period would cover another absence). A second open sick leave is refused (`sick_leave_open`). On the phone the sick-leave button turns into "Zatvori bolovanje".
- **Interruption** of an approved, running, non-sick absence: the worker asks with the last day of absence (`request_absence_interruption`), the request appears with the other approvals (same decision rules, `decide_absence_interruption`), and approval sets the new end date. On the phone "Zatraži odsustvo" turns into "Prekid odsustva" while such an absence runs.
- **Rejecting needs a reason in the UI as well:** the reject button stays disabled until a reason is typed (the server already refused it).
  **Consequences:** Views that count absence days treat an open sick leave as running until today (or the end of the viewed range).

## D-026 — Company registration, shared company directory, platform admin, support access (2026-10-27)

**Context:** Product owner (2026-10-27): companies register themselves step by step (basic information, address, payment …) and keep these data in the settings; public business data (name, ID/VAT number, addresses, bank accounts) should not be typed twice by other companies; the directory must not be browsable — suggestions appear only while typing a customer; changes to another company's data go as proposals; trial 14 days unless the platform admin sets otherwise per organization and module; a Zcore platform admin sees registered organizations and their modules only and may enter an organization to help only after its admin or director approves, for a limited time, access ending on exit. (Migrations `20261027200000_company_directory_platform`, `20261027210000_support_access`, `20261027220000_registration`; their comments say "D-023", which was taken by the shifts work in parallel — they mean this decision.)
**Decision:**

- **Global directory, not tenant data:** `companies` (+ `company_bank_accounts`), one row per country + tax id (BA: ID number 13 digits, VAT 12; a 12-digit number is taken as VAT and turned into the ID number with a leading 4). No table privileges for tenants; only SECURITY DEFINER RPCs: `search_companies` (≥ 3 characters, at most 8 hits, members only) and `get_company`. Who added an entry and who has it as a customer is never returned to other organizations. This is the one deliberate exception to "every table has organization_id" (CLAUDE.md rule 1); it holds public business data only.
- **Ownership:** an organization's own data are its directory row (`organizations.company_id`, `companies.owner_organization_id`). The owner edits it in Postavke → Podaci o firmi (`save_organization_profile`, `org.settings.manage`); the ID number of an owned entry is read-only in the UI. A new tax id creates an owned entry; an existing entry without owner becomes a **claim** decided by the platform admin (prevents taking over someone else's bank account); an entry owned by another organization is refused.
- **Customers:** `customers.company_id` + `postal_code`; `save_customer` (one transaction) links to a picked suggestion or to the entry with the same country + tax id (creating it if missing). Public fields come from the directory and follow it automatically (`companies_sync_customers` trigger; the customer name is kept if it would collide). Customer number, contact person and notes stay private. Data typed differently from an existing entry become a change proposal, never an overwrite. Customers without a tax id stay private. Existing customers with a 12/13-digit tax id were linked by the migration; recognisable country texts became ISO codes.
- **Change requests** (`company_change_requests`, kinds update / claim): sent by an organization that has the company as a customer (`customers.manage`); decided by the owner (`org.settings.manage`, without seeing the sender) or, for entries without owner and claims, by the platform admin (who sees the sender). Rejections need a note. Bank-account changes are not proposed (owners maintain them).
- **Platform admin:** organization `zcore` (`organizations.is_platform`), module `platform`, permission `platform.manage` (granted only to the zcore admin role). Screens `/platform` (organizations, modules with on/off and last trial day, support access), `/platform/requests`, `/platform/settings` (default trial days, `platform_settings`, 14). RPCs return organization name, slug, tax id/city, member count and modules — no tenant data. User: `npm run platform:admin -- <username> "<Ime Prezime>"` (temporary password, change at first sign-in).
- **Module trials:** `org_modules.active_until`; `private.module_enabled` and `getMemberAccess` treat a module as off after it. Registration gives every module except core/platform `now() + default_trial_days`.
- **Support access** (`support_access_requests`): platform admin asks with a reason → admin/director (`support.approve`, new, default admin + director) approves for 30 min … 8 h or rejects → platform admin enters: the server creates / re-activates the organization's own support account `zcore-podrska` (role admin, `profiles.is_support`, random unknown password) and signs it in on the organization's address through a one-time magic-link token (`/support/enter`). `private.user_org_ids()`, `private.has_permission()` and `session_status()` ignore a support account without an approved, unexpired, not ended request, so RLS and the proxy cut access the moment it ends (either side, or time). Ending also archives the support membership and deletes its sessions. A banner shows the support session inside the organization; the support account cannot get a password reset. In local dev (one host) entering support replaces the platform admin's own session in that browser.
- **Registration** (`/registracija`, public): six steps (Osnovne informacije, Adresa i kontakt, Plaćanje, Adresa u sistemu, Administrator, Pregled i potvrda), per-step validation, draft in sessionStorage (never the password), subdomain suggested from the name and checked live (reserved names and `test-*` refused). Server action: rate limit per keyed-hashed client address (`registration_attempts`; 5 registrations / 120 subdomain checks per hour), honeypot, then `register_organization` (service role only; organization, company or claim, trial modules, audit) and the first admin through the Auth Admin API (own password). If creating the admin fails the organization is archived, its subdomain freed and its directory entry / claim released.
- **Service role and private helpers** (`20261027230000`, `20261027231000`): the service role may execute every function in schema `private` (CHECKs and triggers of tenant tables call them); it bypasses RLS anyway and only runs in trusted server code.
  **Consequences:** Suppliers can use the same directory later. Directory entries are never deleted. There is no CAPTCHA yet (rate limit + honeypot only); e-mail verification of registrations does not exist (no e-mail).

## D-027 — Shifts and working time, part C1: calculation, holidays, net pay, monthly overview (2026-10-28)

**Context:** The product owner chose: net pay only (net hourly rate, no gross, contributions or tax in Zcore); premiums 30 % overtime, 30 % night, 30 % weekend, 50 % holiday, editable; overtime always rounded up; overtime daily over the shift or weekly over 40 h (more possible, with a warning for the foreman); holidays taken from a holiday base each year, with the non-working choice globally or per employee and nothing preselected; a default rate plus own rates per employee, visible to the director and HR; the worker sees their own pay so far. The FBiH labour law sets no premium percentages (collective agreements / rules of employment do), so the defaults are the owner's and stay editable.
**Decision:**

- **Calculation in TypeScript** (`pay-rules.ts`, server-side, unit-tested) on top of the session snapshots: regular / overtime from `sessionTime` (daily) or the ISO-week total above `weekly_hours` (weekly; the overview loads the whole first week), overtime rounded up to `overtime_step_min` per session; night, weekend and holiday minutes from local windows converted per calendar day in the organization's time zone (exact over DST); flexible unpaid breaks are not removed from night / weekend / holiday minutes. Net pay = rate × hours + rate × minutes × premium for each premium (they add up). Money as decimal strings, rounded to cents at the end.
- **Settings:** calculation rules in `attendance_settings` (overtime mode, weekly hours, warning hours, rounding step, night window, organization weekend days; `shifts.manage`); premiums through `save_pay_settings` and the default rate in `payroll_settings` (`payroll.manage`, director and HR). Own rates in `employee_hourly_rates` valid from a date (history kept; earlier months stay at the old rate). New permissions `payroll.read` / `payroll.manage` (director, HR). Rates are readable only with `payroll.read`; the worker gets their own through `my_pay_inputs`.
- **Holidays:** a platform list `holiday_templates` (FBiH 2026–2028: state holidays, Catholic and Orthodox Christmas / Easter computed, Bajram dates marked "not confirmed") copied into `org_holidays` per organization (on creation for this and next year, "Preuzmi praznike za godinu" for others; dates and names editable; own holidays possible). Per holiday key `org_holiday_rules` decides non-working for everybody or selected employees (`employee_holiday_keys`); without a rule a holiday is a normal day. No external holiday service is called.
- **Per employee:** own weekend days (turnus workers) in `employee_work_info.weekend_days`; absences in the overview count working days without the employee's weekend and non-working holidays.
- **Monthly overview** `/attendance/monthly` (`attendance.read`; pay column only with `payroll.read`), warnings for weeks above the overtime limit, employee settings (weekend, holidays, rates); exports Excel (`exceljs`, new dependency) and CSV (`;`, UTF-8 BOM); "Specifikacija uz isplatu plaće" as a print page with the employer, period and number of employees filled in and every amount left to the accountant. The worker's phone shows night / weekend / holiday hours and net pay so far.
  **Consequences:** Pay excludes compensation for absences and holidays (shown as days). JIB, address and activity on the specification can come from the company profile (D-026) later. Kiosk clock-in is part C2.

## D-028 — Support sessions: approval dialog, countdown, return to the Zcore session (2026-10-28)

**Context:** Product owner (2026-10-28): the Zcore organization does not need its own company data or support settings; a support request should pop up for the organization's admin / director in the middle of the screen; while a session runs the platform admin sees a countdown; when the organization ends it (or the time is up) the platform admin is taken back to their own Zcore session automatically, without signing in again, with a notice.
**Decision:**

- **Navigation:** `NavItemDef.hiddenForModule` — "Podaci o firmi" and "Zcore podrška" are hidden while the `platform` module is enabled (the Zcore organization); the pages say so if opened directly.
- **Approval dialog:** `SupportRequestPrompt` in the app layout for members with `support.approve` (not the support account, not Zcore): `pending_support_requests()` on load, every 10 s and on focus; an AlertDialog with the requester, reason, duration (30 min … 8 h), approve / reject (optional note) / "Kasnije" (hidden until the next page load; the request stays in Postavke → Zcore podrška). The platform page refreshes every 10 s while a request is pending and shows the answer as a toast.
- **Countdown and automatic end:** the support banner counts down to `approved_until`, polls `/support/status` every 10 s (`session_status().support_ended`, no redirect on that path) and leaves through `/support/exit` when the organization ended the session or the time is up. The proxy also redirects any request of an ended support account to `/support/exit` (`decideRoute` `supportEnded`) instead of the generic "signed in on another device" sign-out. `session_status()` gained the third column `support_ended` (migration `20261028100000`); `active` again means only "the session exists" — data access of an ended support account is still blocked by RLS (D-026).
- **Return to Zcore:** `/support/exit` signs the support account out and redirects to `/platform?support=ended` of the Zcore organization, where a toast says the session ended. In production the Zcore session lives on `zcore.zcore.ba` and was never touched. On a single host (local dev, previews) `enterSupportAction` keeps the platform admin's refresh token in the httpOnly cookie `zcore_support_return` (9 h) and `/support/exit` restores the session from it (one-time; if it fails the login screen opens).
  **Consequences:** Notifications are polled (10 s), not pushed. The return cookie holds the user's own refresh token in their own browser, like the session cookies themselves.

## D-029 — Shifts and working time, part C2: attendance kiosk (2026-10-28)

**Context:** A shared tablet at the entrance should clock workers in and out without a user login, by QR / NFC badge or by name and PIN (product owner; NFC works in Chrome on Android, QR and PIN everywhere).
**Decision:**

- **The tablet is a device, not a user.** An admin (`kiosk.manage`: admin, head of production) creates a kiosk and gets a one-time 8-character activation code (30 minutes, stored as a SHA-256 hash). `/kiosk` (public path, exact match) redeems it for the tenant of the host and stores `kiosk id + secret` in an httpOnly cookie (path `/kiosk`, one year); only the secret's hash is kept. "Novi kod" re-activates (the old tablet is signed out), "Ugasi" revokes.
- **Service role only behind the device check:** `kiosk_activate`, `kiosk_session` and `kiosk_clock` are executable by `service_role` only; the server calls them after reading the cookie and the tenant (the database checks the secret and the tenant again). This is the one place where the app uses the service role for a non-admin flow; everything else stays on the user's RLS client.
- **Identification:** a badge carries a random 24-hex token (`zcore-kiosk:<token>` as QR, or written to an NFC tag; keyboard-like scanners work too), issued by `kiosk.manage` (a new badge invalidates the old one), printable on `/settings/kiosk/badges`. Or the worker picks their name and enters a 4-digit PIN (bcrypt via pgcrypto, easy PINs refused in the app, locked for 5 minutes after 5 wrong attempts); the worker sets it on `/floor/attendance` or `kiosk.manage` sets it.
- **Clocking:** each identification toggles clock-in / clock-out (source `kiosk`) through the same functions as the phone, with an idempotency key per scan; the result (name, direction, time, shift) stays on screen for a few seconds.
  **Consequences:** Only workers with a PIN appear in the name list. Secrets, PIN hashes and badge tokens are never readable through the API (badge tokens only for printing with `kiosk.manage`); the audit log records changes without them.

## D-030 — Kiosk NFC: one reader, 3-second pause, repeat guard; LAN access in development (2026-10-28)

**Context:** Testing on a phone, the product owner found that an NFC card was read several times (each read toggled clock-in / clock-out, so the result looked random) and that after one read the person's card "no longer worked". The kiosk could not be opened from a phone on the local network at all (the activation button stayed disabled).
**Decision:**

- **NFC reader:** the kiosk turns NFC on once ("Uključi NFC čitač", the browser asks for permission) and keeps one reader running while the page is open; before, each tap started a reader that stopped after the first read, so the next card went to Android instead. Text records are decoded with their encoding.
- **3-second pause** after an accepted badge scan (NFC, camera QR, keyboard scanner) in the tablet (`acceptScan`, `SCAN_COOLDOWN_MS`).
- **Repeat guard in the database** (`20261028130000_kiosk_repeat_guard`): when the same worker is identified again within 10 seconds (held card, second tablet, double tap, resend), `kiosk_clock` returns the last result with `repeat: true` instead of toggling; the tablet shows "Već zabilježeno".
- **Putting badges on NFC cards:** in `/settings/kiosk` "Kopiraj za NFC" copies `zcore-kiosk:<token>` (or shows it for copying when the clipboard is unavailable over plain HTTP) for an app such as NFC Tools (Text record); "Upiši na NFC" writes the card directly with Web NFC (Chrome on Android over HTTPS; hidden elsewhere).
- **Development on the local network:** `next.config.ts` allows this computer's local IPv4 addresses as dev origins (otherwise the dev server does not serve its scripts to http://192.168.x.x and pages never hydrate), and `?org=` is accepted on private-network IPv4 hosts in development only (never in production). `npm run dev:https` runs the dev server with HTTPS, which the camera and NFC need on devices other than localhost.
  **Consequences:** A worker who really wants to clock out right after clocking in waits 10 seconds. NFC and camera on the kiosk need HTTPS (production has it).

## D-031 — Inventory part A: material warehouse as a movement ledger (2026-10-28)

**Context:** Phase 4 starts with the material warehouse. The product owner answered the open questions: bars and tubes are kept in mm and priced per kg; sheets and plates are cut, so they are tracked as rectangles (length × width, thickness on the item), not as kg; a material comes in several standard lengths; customers often supply their own material; heat numbers / certificates are optional, but customers ask for certificates with deliveries; the warehouse person cuts and issues pieces (or whole bars) on request of the head of production; the usable remnant length is a setting (default 300 mm); reservations start automatically when an order is released (part B); corrections are confirmed by admin / director / head of production; negative stock is forbidden; invoice prices usually include VAT; one warehouse with shelves today, more later, plus material standing next to machines. The work is split into three parts: A (this), B (requirement, reservation, issue to orders, returns, consumption, remnants, the order's material tab), C (stock count, warnings for planned orders, QR labels, mobile warehouse screens).
**Decision:**

- **Module `inventory` (Magacin)** with `inventory.read` (admin, director, head of production, warehouse), `inventory.items.manage` and `inventory.move` (admin, head of production, warehouse) and `inventory.adjust.approve` (admin, director, head of production). Enabled for every organization that has `production`.
- **Stock item = grade + shape + dimension** (`stock_items`): the grade is the existing materials catalog (D-015), so density comes from there; shapes round / hexagon / square / flat bar, tube, profile, sheet, plate, other. The base unit follows the shape (DB check): bars, tubes and profiles in **mm**, sheets and plates in **m²**, other items in kg or pieces. kg per unit is derived (`private.stock_item_kg_per_unit`, the same cross-sections as the product blank) or taken from the supplier's kg/m (required for profiles). Shape, unit, dimensions, grade and kg/m are locked once an item has movements (`item_has_movements`).
- **Stock is kept as pieces of a size:** each movement of a mm / m² item carries a signed piece count and the piece size (bar length; sheet length × width), so "4 × 6000 + 1 × 1240 mm" and sheet remnants are first-class; quantity (base unit), theoretical mass and net value are stored signed on every movement.
- **Ledger:** `stock_movements` is append-only (no update trigger, no insert/update/delete grants); balances are views (`stock_balances` per item / lot / location / piece size, `stock_item_totals` per item). Every business action is a `stock_documents` row (receipt `PR`, transfer `PN`, correction `KO`, numbered per year) with a unique idempotency key; every movement has its own unique key (`<document key>:<line>`). Writes only through SECURITY DEFINER functions (`post_stock_receipt`, `post_stock_transfer`, `request_stock_adjustment`, `decide_stock_adjustment`) that check the permission and the module, take an advisory lock per item, refuse negative buckets (`negative_stock`, pieces and quantity) and write the audit log.
- **Lots:** every receipt line is a lot (`L26-00001`) with optional heat number, supplier, delivery note and optional owner customer; certificates (PDF / images) go to the private bucket `stock-certificates` (`<org>/<lot>/<uuid>.<ext>`, upload via signed URL, archived not deleted).
- **Customer-supplied material** is a lot owned by a customer: no value, outside the own stock and the average; it stays visible in the totals.
- **Value: moving weighted average per item over own lots.** A receipt line is valued as unit price × basis (kg: invoice kg if given, else theoretical mass; metre; m²; piece), net of VAT when the invoice price includes it (rate and the default of the switch in `organizations.settings.inventory`, default 17 % and on). Outgoing movements (transfers, corrections) are valued at the current average (`private.stock_unit_cost` = own value / own quantity), so the average is always derived from the ledger and never stored. The method is shown in the settings; other methods (FIFO) are not offered.
- **Corrections need approval:** `inventory.move` proposes (reason required, lines stored in `stock_adjustment_lines`); `inventory.adjust.approve` posts or rejects (rejection needs a note). An approver may post at once. Removing stock must name its lot already when proposed (`20261028160000_inventory_adjustment_lot_check`); found material may come without a lot and gets a new one on approval.
- **Locations:** `stock_locations` with warehouse → shelf and machine places (linked to a machine); one warehouse `M1 Magacin` is seeded per organization (and for new ones).
- **Products ↔ stock items:** `product_revisions.stock_item_id` (nullable, starts empty). The pairing screen proposes items with the same grade and cross-section (`pairingCandidates`: round → round bar, hexagon → hex bar, tube → tube, rectangular → flat bar either way round, square bar or a sheet / plate of that thickness) and "Upari automatski" links revisions with exactly one candidate; the rest are chosen by hand.
- **Settings** (`/settings/inventory`, `org.settings.manage`): remnant minimum length (used from part B), VAT rate, prices include VAT by default.
  **Consequences:** Negative stock is not configurable (the product owner wants it forbidden). A new product revision does not copy the link to the stock item yet (the pairing screen shows it again). Operators see no stock in part A; they will see the material of their order with part B. Display: length items in metres, masses and money rounded for display only.

## D-032 — Inventory part B: material of production orders (2026-11-01)

**Context:** After part A (D-031) the warehouse knows stock but not which order it is for. The product owner confirmed the plan and answered: "Treba rezanje" belongs on the order (default from the routing); when material is short the full requirement is still reserved and material can be issued partly with a warning how many pieces are missing; pieces per sheet may be an area estimate but must be editable; an offcut of **our** material always goes back into stock (even below the minimum length, it may be used for another job), an offcut of customer material does not.
**Decision:**

- **Order ↔ stock item:** `production_orders.stock_item_id` is taken from the revision (`stock_item_id`, part A pairing) when an order is created or copied (BEFORE INSERT trigger) and can be changed on the order until material is issued (`order_material_issued`); `sheet_pieces_per_sheet` overrides the sheet estimate. Open orders were filled from their paired revision by the migration.
- **Requirement** (`private.order_material_requirement`, mirrored by `orderRequirement`): bars = quantity × (cut length + kerf), pieces per bar = ⌊(bar − remnant) / (cut length + kerf)⌋ with the order's bar length or the item's standard length, bars needed rounded up; sheets: piece = (cut length + kerf) × (other side + kerf) where the other side is the blank side that is not the sheet thickness, pieces per sheet = the order's value or ⌊sheet area / piece area⌋, reservation = sheets needed × sheet area (else quantity × piece area). Only orders counted in pieces with a cut length have a requirement.
- **Reservation** (`stock_reservations`, one open per order): kept equal to the requirement by an AFTER UPDATE trigger on the order (release draft → planned, quantity / piece / bar / item / sheet changes); released when the order goes back to draft, is completed, cancelled or archived. `set_production_order_status` is unchanged. Remaining = reservation − issued.
- **Coverage / shortage** (`stock_order_coverage`): open reservations are served by due date (then release time) from own stock plus the stock of the order's customer; the shortage is shown on the order ("Nema dovoljno materijala", missing pieces, button "Čeka materijal" for members who may make that transition — a proposal, the status is never changed automatically). Available per item = stock − reserved (`stock_item_reserved`).
- **Ledger kinds on orders:** `issue` (out), `remnant` (offcut of a bar / sheet cut in the warehouse, back into stock as its own piece, same lot, location chosen) and `return` (back from production, only lots issued to that order). Customer material may only be issued to orders of that customer (`customer_material`) and never leaves an offcut in our stock (`offcut_own_material_only`). Issues are allowed for released, not closed orders (`order_not_open`); returns and consumption also after completion. All through `post_stock_issue` / `post_stock_return` with idempotency keys, item locks, the negative-stock check and the audit log; values at the moving average (customer material 0).
- **Issue suggestions** (`rankIssueBuckets`): the order customer's material first, then remnants that fit a piece (smallest first), then standard pieces, then short remnants (below the setting); buckets that fit no piece last; other customers' material is never offered. Cutting in the warehouse proposes ⌊bar / (cut + kerf)⌋ pieces and the offcut length.
- **Consumption** is separate from issued (`stock_order_consumption`, one row per order and item, confirmed or corrected by `inventory.move`, audited): proposal = (good + scrap of the first operation) × material per piece; the order shows issued − consumed − returned.
- **"Treba rezanje"** (`create_production_order` p_order.needs_cutting, `set_order_cutting` for drafts): adds the organization's cutting operation type as the first operation, or archives the routing's cutting operations; without a cutting type the order is refused with `no_cutting_operation_type`.
- **Floor:** `floor_order_material(operation)` shows the operator the item, lots and heat numbers issued to the order of an operation they can see.
  **Consequences:** Coverage is an approximation (no allocation per lot; customer stock counts only for that customer's orders). Kg / piece items have no automatic requirement yet. A cutting operation added by the checkbox has no machine (assigned like any other operation before "Spreman").

## D-033 — Inventory part C: stock counts, warnings, QR labels, mobile warehouse (2026-11-02)

**Context:** Last part of the material warehouse (D-031, D-032): the product owner asked for a stock count confirmed before corrections are posted, warnings below the minimum and for planned orders, QR labels for material / lots and locations (printed as HTML, size adjustable), and mobile screens for the warehouse person.
**Decision:**

- **Stock count** (`stock_counts`, `stock_count_lines`, `20261102100000_inventory_counts`): opened by `inventory.move` for one location (a warehouse includes its shelves), optionally one item; opening snapshots the expected stock per item / lot / location / piece size. Counted pieces (or kg / pcs) are entered per line, found material is added as a new line (a new lot on posting). The difference is **counted − expected at opening**, so movements during the count do not distort it; uncounted lines change nothing. The warehouse submits; `inventory.adjust.approve` posts it — one correction document (`Inventura IN26-00001`) through the existing correction path (ledger, negative-stock check, item locks, audit) — or cancels it with a reason. Correction documents may hold up to 10 000 lines.
- **Warnings:** the dashboard shows, with `inventory.read`, items below their minimum, released orders short of material (`stock_order_coverage`) and corrections / counts waiting for approval; the order list marks orders short of material ("Fali materijal").
- **QR labels** (`/inventory/labels`, print layout): one label per lot / location / piece size of an item (remnants included) or per location, sizes 50 × 30, 70 × 40 mm or an A4 sheet (3 × 8). The QR is a **link into the app** (`/floor/warehouse/lot/<lot>`, `/floor/warehouse/location/<location>`), so a phone camera opens the right screen as well; the in-app scanner reads these links and the order QR of the work order print (`/floor/orders/<id>`), see `parseScan`.
- **Mobile warehouse** (`/floor/warehouse`, `inventory.move`, floor navigation "Magacin"): scan (back camera via BarcodeDetector, or a typed / pasted code), lot screen (stock of the lot with "Prenesi"), location screen ("Počni inventuru ovdje"), order screen (issue by scanning: the order QR, then the material label preselects the lot in the issue form of D-032), counts (list, open, enter per line, submit), receipt (the responsive receipt form).
  **Consequences:** Scanning needs HTTPS and Chrome on Android (like the kiosk, D-030); elsewhere the code is typed. Labels are printed through the browser (no label printer driver). A count does not block movements while it is open.

## D-034 — Finished goods and delivery notes (2026-11-02)

**Context:** The product owner: good pieces of an order may go into the warehouse partly and be shipped to the customer later; the head of production does it with the pieces currently in stock. A delivery note has the customer, its number, the date sent and a table (position, order / drawing number, pieces) with signatures at the bottom. Numbers are mostly customer number – month year – running number (03-0326-122); the running number restarts only with a new year; the format must be configurable. Our logo is printed; usually one layout, but more (domestic / foreign customers) must be possible; layouts are set up by Zcore admins and changed on request, also by the company's admins.
**Decision:**

- **Permissions** `finished_goods.read` (admin, director, head of production, warehouse) and `finished_goods.manage` (admin, director, head of production), module `inventory`.
- **Finished goods ledger** `finished_goods_movements` per order (receipt +, shipment −, cancelled shipment +), append-only; stock per order = sum (`finished_goods_stock`). `receive_finished_goods` accepts at most the good pieces of the last operation (`private.order_good_quantity`) not received yet (`more_than_good`), whole pieces for pcs / sets, idempotent; not for draft / cancelled orders.
- **Delivery notes** `delivery_notes` / `delivery_note_lines`: `issue_delivery_note` takes pieces on hand of orders of that customer (`not_in_stock`, `order_not_found`), snapshots order number, part number, name, drawing number, revision and unit, and the customer position (`production_orders.customer_position`, editable per line); it is issued at once and the pieces leave stock. `cancel_delivery_note` (reason required) puts them back; the number stays used.
- **Numbers:** `private.format_delivery_number` with tokens {KUPAC}, {KUPAC2} (at least 2 digits), {MJESEC}, {GODINA}, {GODINA4}, {BROJ}; default `{KUPAC2}-{MJESEC}{GODINA}-{BROJ}`, minimum digits of {BROJ} configurable; counter `delivery_note:<year>` per organization (restarts with a new year, never reused); validated by a check on `organizations.settings` (mirrored by `isValidDeliveryNumberTemplate` / `formatDeliveryNumber`).
- **Templates** `delivery_note_templates` (one default per organization, seeded "Standardna"; more can be added; customers may use their own, `customers.delivery_note_template_id`): title, header and footer text, logo on / off, columns (position, customer position, order, part number, drawing, revision, product, quantity, unit) in a chosen order with own labels, up to 4 signatures. Edited on `/settings/delivery-notes` with `org.settings.manage` (company admins and Zcore admins through a support session, D-026). The default template cannot lose its flag until another one becomes the default.
- **Logo** in the private bucket `organization-files` (`settings.branding.logo_path`), uploaded through a signed URL, shown through a short-lived signed URL.
  **Consequences:** Delivery notes are printed through the browser (A4). There are no prices on delivery notes. Finished goods have no locations yet.

## D-035 — Tool warehouse and inserts on tool changes (2026-11-02)

**Context:** The product owner: every tool in use must be tracked, unused ones are in the tool store; a tool may be taken and left at a machine, also for good when it is meant only for that machine. Tools are counted in pieces (e.g. 10 inserts, 1 holder). For each insert the number of cutting edges must be known; when changing an insert the worker chooses a new or the existing insert; in one-off production an insert may serve several jobs (not tied to an order).
**Decision:**

- **Permissions** `tools.read` (admin, director, head of production, warehouse) and `tools.manage` (admin, head of production, warehouse), module `inventory`.
- **Catalog** `tools`: code, name, kind (`tool` / `insert`), cutting edges (inserts, 1–20), home machine (a tool dedicated to one machine), minimum, supplier.
- **Ledger** `tool_movements` in pieces per tool and location (the stock locations of D-031; a machine gets its own location on first issue, `private.machine_location`): receipt, issue / return / transfer (out + in), scrap (reason required), consume (an insert taken on a tool change). `move_tool` checks the permission and the module, locks the tool, refuses negative stock (`negative_stock`) and writes the audit log; balances in `tool_balances`.
- **Inserts in use** `machine_inserts`: per machine and insert type the insert in use and its edges used. `record_tool_change_with_tool`: "new" takes one insert from the machine's stock (`consume`) and starts at edge 1; "next edge" turns the current insert (refused with `no_insert_in_use` / `no_edges_left`); other tools are recorded without stock. `production_tool_changes` gets `tool_id`, `insert_action`, `edge_no` (the tool text is filled with code and name); the free-text function stays for organizations without a catalog and as "Drugi alat (upis)". The floor reads the tools at the machine with `floor_operation_tools`.
- **Pieces, not serial numbers:** every tool is counted in pieces per location; individual serial numbers per piece are not tracked yet (the product owner counts tools in pieces).
  **Consequences:** One insert in use per machine and insert type (several pockets with the same insert type share the count). Holders and other tools are not consumed by tool changes; worn tools are scrapped with a reason.

## D-036 — Vercel functions in Dublin, next to the database (2026-11-01)

**Context:** The app felt slow: the Supabase project runs in `eu-west-1` (Ireland) while Vercel functions ran in the default US region, so every server render, server action and proxy call crossed the Atlantic several times (each page makes several database round trips).
**Decision:** `vercel.json` sets `"regions": ["dub1"]` (Dublin), the Vercel region next to `eu-west-1`. Kept in git so every deploy uses it.
**Consequences:** If the database ever moves, move the function region with it. Users in BiH are also closer to Dublin than to the US.

## D-037 — Configurable dashboard per role (2026-11-03)

**Context:** Phase 5 starts with the dashboard. The product owner asked for a dashboard with everything that can be shown, and for the admin to add and remove widgets per role, with the role named next to the save button.
**Decision:**

- **Permission** `dashboard.manage` (core, admin). Zcore support works as the company admin (D-028), so it can configure dashboards too.
- **Layouts** `dashboard_layouts`: one ordered list `[{key, size}]` per role (`normal` / `wide`). The database checks only the shape (`private.dashboard_widgets_valid`: an array of at most 40 objects with exactly `key` and `size`, keys distinct). The widget catalog lives in the app (`src/modules/dashboard/widgets.ts`), and keys the app no longer knows are skipped when reading. Writes go only through `save_dashboard_layout` / `reset_dashboard_layout` (permission, role of the same organization, audit by trigger). Members read their organization's layouts.
- **Defaults:** a role without a row uses the app's default for its system key: admin / director everything, head of production production, warehouse inventory, quality inspector output and scrap, HR attendance; custom roles start empty.
- **Visibility:** a member sees a widget only if the module is on **and** the member holds one of the widget's permissions. A layout never grants data access, and RLS still applies to every query. The editor marks widgets the role will not see ("Modul nije uključen", "Uloga nema dozvolu").
- **Widgets (17):**
  - production: orders by status, output today, due dates, orders in progress, machines now, output per day (14 days), downtime by reason (7 days), scrap by reason (30 days), close requests;
  - attendance: today, requests to decide;
  - inventory: below minimum, orders short of material, to approve, tools, finished goods, recent delivery notes.
- **Loading:** each widget loads inside its own Suspense. Shared loaders (open orders, today's production, last 30 days of reports via `production_day` over a range) are cached per request.
- **Editor** `/dashboard/edit`: role picker, cards in the dashboard grid (drag or arrows to reorder, wide / narrow, ✕ to remove), "Dodaj widget" by group, "Vrati zadano". "Uloga: X" is shown next to "Sačuvaj"; switching roles with unsaved changes asks first.

**Consequences:** New widgets are app code plus a catalog entry; saved layouts need no migration. Downtime by reason counts each event's time inside the 30-day window if the event ended within the last 7 days (an event that started earlier counts fully).

## D-038 — Notifications: pop-ups with Otvori / ✕, bell with read state (2026-11-03)

**Context:** The product owner: pop-ups need "Otvori" and ✕; the bell needs "mark all as read" at the top, ✕ next to every item, and a click on an item opens it.
**Decision:**

- Bell items stay derived from pending work: close requests, attendance alerts, requests to decide. Keys are `close:<id>`, `alert:<id>`, `approval:<id>`.
- **State per user:** `notification_reads` (organization, user, key, read_at, dismissed_at), only through `mark_notifications(p_org_id, p_keys, p_dismiss)`. The RPC is idempotent, takes at most 200 keys and only the caller's own rows. Removing implies read, and a removed item never comes back by being marked read again. RLS lets a user see only their own rows.
- **Bell:**
  - the counter shows unread items;
  - unread items are bold with a dot;
  - "Označi sve kao pročitano" sits next to the title;
  - every item has ✕ (removed from this user's bell);
  - a click marks the item read and opens it.
- **Pop-ups:**
  - shown only for unread items not shown before;
  - they stay 10 s, at the usual place (top centre). Pop-ups that stayed open until closed, bottom-right, covered the save buttons of side panels (found by the full e2e run), so they were changed; the item always stays in the bell;
  - they offer "Otvori" (read + open) and ✕ (read).
- Writes happen in the background (optimistic). A failed write only means the item shows as unread again after a reload.

**Consequences:** Removing an item from the bell does not decide it. The request still waits on its own page. `notification_reads` grows by one row per seen item per user; it can be pruned later (e.g. rows whose item is resolved).

## D-039 — Delivery note editor with a live paper preview; original + copy (2026-11-03)

**Context:** The product owner asked for a new delivery note with the fields on the left and the note forming on the right as on paper, with options to issue, send by e-mail and copy. Asked, the product owner chose real sending from the app (PDF attachment, e-mail provider such as Resend) and "copy" = an original and a copy when printing.
**Decision:**

- **One paper component** (`delivery-notes/delivery-note-paper.tsx`) renders a note by its template. The print page, the note's page and the live preview all use it, so they always look the same. It is always black on white (also in dark mode). Dates use the fixed `d.m.yyyy.` format, so server and browser match.
- **New note:** the form on the left, the paper on the right (sticky on wide screens). The preview follows the customer, template (chosen → customer's → default), date, lines, positions, quantities and notes. The number is previewed with "…" for the sequence (`previewDeliveryNumber`), since the sequence is assigned only on issue. "Izdaj otpremnicu" issues and opens the note; "Izdaj i štampaj" issues and opens the print page with the print dialog.
- **Print:** an original and a copy by default, each on its own page and marked "ORIGINAL" / "KOPIJA"; "Samo original" (`?copies=1`) prints one.
- **E-mail:** not built yet. It needs an e-mail provider account and API key from the product owner (and the domain for the sender address); until then there is no e-mail button.

**Consequences:** Layout changes to templates show up the same everywhere. Sending by e-mail will render the same note to PDF on the server; that work starts when the provider is set up.

## D-040 — Sending delivery notes by e-mail without connecting an account (2026-11-03)

**Context:** The product owner first wanted senders to connect their own Gmail or Outlook, so the app opens it with a prepared e-mail and the note attached. Checked:

- Creating a Gmail draft with an attachment needs a Google "restricted" scope. For a public app that means a paid security assessment (CASA) every year; without it, the app is limited to 100 test users whose sign-in expires after 7 days.
- Outlook (Microsoft Graph) would be free, but needs an app registration by the product owner.

The product owner chose the free variant ("logičnija mi je").
**Decision:**

- **PDF:** `/inventory/delivery-notes/[id]/pdf` (finished_goods.read, data through RLS) renders the note with `@react-pdf/renderer`. It follows the same template, content and order as the paper on screen. The font is Noto Sans (OFL, in `src/assets/fonts`), because the PDF standard fonts lack č, ć and đ. The logo is included for PNG / JPEG; WebP / SVG logos are left out of the PDF. One page (original) by default, `?copies=2` adds the copy. The file name comes from `deliveryPdfFileName`.
- **"Pošalji mailom"** on an issued note:
  - **"Podijeli s PDF prilogom"** where the browser can share files (Android / iOS, Chrome / Edge on Windows, Safari on macOS). The system share sheet opens Gmail, Outlook or any other app with the PDF attached and the subject and text filled in. The PDF is loaded when the menu opens, because browsers allow sharing only right after a tap.
  - **Gmail, Outlook.com, Outlook (Microsoft 365) and the mail program** (`mailto:`): a new e-mail opens with the customer's e-mail, the subject "Otpremnica <broj>" and a short text. The PDF is downloaded at the same time, and a hint says to drag it into the e-mail (web mail does not accept attachments through a link).
  - "Preuzmi PDF".
- No tokens or e-mail credentials are stored; nothing is sent by the app itself.

**Consequences:** On a computer the attachment is one drag. If the product owner later registers an Outlook (Azure) app, a "connected Outlook" option that creates the draft with the attachment can be added without changing this.

## D-041 — Production planning by days (2026-11-04)

**Context:** The product owner's answers (2026-11-03, corrected 2026-11-04): the head of production places orders on machines by hand, sorted by priority and due date, and may change due dates and priorities. Machines can run without an operator (an EDM job of 20 h started at 14:00 runs on after the operator leaves at 15:00), but **a job is never without a responsible operator**. One worker may run several machines. Planned and actual cycle times are both shown, to compare them. External operations (hardening…): the days are entered when the pieces come back and do not count as our production time; only their price matters. The board is by days (not hours), with drag and drop plus arrows. Lateness is a warning only. Machine downtime has an optional end. On an overloaded day the program marks it and **asks** whether to move work to another day itself, by priority and by what was added last.

**Decision:**

- **Data** (`20261104100000_production_planning`, `20261104110000_plan_operations_machine_first`):
  - `production_order_operations.plan_day` / `plan_position` / `plan_added_at`: the day, the order within the machine's day, and when the operation was put into that day.
  - `machines.runs_unattended`, `machines.capacity_hours`: hours per day; null = 24 h when unattended, otherwise the organization's `work_hours_per_day`. Both are set in the machine form.
  - `machine_downtimes`: from a day, to a day or null = until further notice; reason from the downtime catalog; archived, not deleted.
  - `external_days` / `external_cost` on external operations, entered after receipt.
  - The old `planned_start` / `planned_end` of the assignment sheet stay as they were.
- **RPCs:**
  - `plan_operations(org, moves)` (orders.manage, one transaction, up to 500 moves) refuses:
    - external operations and inspections;
    - closed orders and done operations;
    - a started operation moved to another machine;
    - a planned operation without an operator (`operator_required`);
    - an operator not qualified for the machine.
  - The machine is written before the operators.
  - A move proposed by the program (`auto`) keeps `plan_added_at`.
  - Other RPCs: `record_external_result` (only when the operation is done), `save_machine_downtime` and `archive_machine_downtime` (orders.manage or machines.manage).
- **Schedule** (`src/modules/planning/rules.ts`, pure):
  - Each machine works through its planned operations day by day, in position order.
  - A long job runs on into the next days: on an unattended machine also through nights and non-working days; otherwise it waits for the next working day.
  - A new job starts only on a working day (Monday–Friday without holidays for everybody) without downtime.
  - A day is **overloaded** when an operation planned on it cannot start on it.
  - Started work and work planned on past days count from today. Idle days are skipped, so work planned far ahead is scheduled too.
  - Durations are the remaining setup plus the remaining pieces × cycle. "By actual cycle" uses this operation's reports, otherwise the last 5 finished runs of the same routing step, otherwise the plan.
- **Moving work:** "Prebaci posao u sljedeće dane" is asked, never automatic. From the earliest overloaded day, the program moves the **lowest priority first and, among equal priorities, the operation added last** to the end of the next day the machine can start work, repeating until every day fits.
  - Priority comes before "added last", so an urgent order is never pushed out because it was planned later.
  - The server computes the moves again from the current plan.
- **Operators:**
  - Dropping a card on another machine, or a card without an operator, asks for the operator; only workers qualified for that machine are offered.
  - Operator load per day: on an unattended machine only the setup counts, otherwise the machine time. Every assigned operator counts in full. Approved absences are marked.
- **Warnings** (never blocking):
  - the order ends after its due date;
  - the operation cannot start on its day;
  - the operation is planned before the previous operation of the order ends, or the previous one is not planned;
  - no operator;
  - a day in the past;
  - an earlier external operation is not back yet.
- **Screens:**
  - `/planning` (orders.read; changes need orders.manage). Two weeks of machines × days, "Nije u planu" sorted by priority and due date, load bar per day, continuation of long jobs, downtime hatched, operator load table.
  - Per card: "Premjesti…", "Operateri…", "Hitnost i rok…", "Ukloni iz plana". A card dragged back to "Nije u planu" leaves the plan.
  - Order operations tab: "Trajanje i cijena" for a received external operation; the days suggested from shipping to receipt.
- Dates and numbers on the board are formatted without Intl (`formatShortDay`, `formatOneDecimal`), so server and browser render the same text.

**Consequences:** Planning is by days only (no hours, no automatic scheduling). Priority/slack on orders still uses `work_hours_per_day`, not the plan. Machine downtime does not change the machine status. The operator load does not use the shift schedule yet (only the work hours per day and approved absences).

## D-042 — Speed: permission sets in RLS, one render per action, optimistic status (2026-11-02)

**Context:** Product owner (2026-11-02): the app works but is slow, above all when changing statuses ("nije instant"). Measured on the linked project: the order list view averaged 237 ms, the order operations view 211 ms (max 5 s), the floor queue 175 ms, on ~125 orders. Cause: every RLS policy called `private.has_permission(organization_id, key)` once per row, and the per-row helpers of the directory views (`order_schedule`, `operation_overlaps`) ran their own queries under RLS again (10× slower than without RLS). On the client, every status change rendered the page twice: the server action's `revalidatePath` already returns the re-rendered page, and the component then called `router.refresh()` for a second full render.
**Decision:**

- **`private.permitted_org_ids(key)`**: the caller's organizations holding the permission, with exactly the conditions of `has_permission`. Policies use `organization_id in (select private.permitted_org_ids(key))`, a hashed subplan evaluated once per statement. Migration `20261104120000_rls_permission_sets` rewrites every public policy of the plain form (catalog_items writes, whose key depends on the row, stay). New policies must use this form, not `has_permission(organization_id, …)`. Order list: 115 ms → ~40 ms for the same rows in the test transaction.
- `order_schedule` and `operation_overlaps` run as definer (reached only through rows the caller can see; one machine = one organization). FK covering indexes from the advisor.
- **No `router.refresh()` after a server action that revalidates** (checked in Next's action handler: a revalidating action renders the current page in the same response). Kept: kiosk activation (cookie, no revalidation), the clock button's stale-state error branch, polling refreshes.
- **Optimistic UI (`useOptimistic`)** for order status (header badge via `OrderStatusProvider`), operation status (orders → Operacije) and the worker's start / pause / report on the floor. Display only: the server's answer replaces it, an error rolls it back; the database still decides every transition. A confirmation text ("Operacija je završena.", toasts) appears only after the server confirmed, and forms stay open while sending, so nobody leaves a screen believing an unsaved report was saved (an e2e run caught exactly that).
- Order detail page reads the order together with the access check and everything else in one parallel round.
- Security headers for every response: `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'`, `nosniff`, `strict-origin-when-cross-origin`, `Permissions-Policy` (camera and NFC for the app only).

**Consequences:** A status change costs one round trip and shows at once. The security review of the same day found no tenant leak (all tables RLS, no anon table grants, definer functions check membership/permission, views `security_invoker`, private buckets, column-level update grants). Open: leaked-password protection in Supabase Auth (dashboard setting), `/support/exit` is a GET (sign-out CSRF, low impact).

## D-043 — Reports (2026-11-03)

**Context:** Phase 5 e. The product owner wanted all four report groups in the first round: production and efficiency, machines and downtime, orders and due dates, material / tools and costs. All have filters and an Excel export. The order cost includes machine time, priced with an hourly rate per machine.

**Decision:**

- **Data:**
  - Migrations `20261105100000_reports`, `20261105110000_reports_without_inspections`.
  - Permission `reports.read` (production; admin, director, head of production).
  - `machines.hourly_rate` (KM per machine hour, in the machine form).
- **RPCs:**
  - `report_production`, `report_orders`, `report_inventory` (org, first day, last day), at most 367 days.
  - Each runs as definer behind `reports.read`, so a head of production also sees material values without inventory rights. Each returns facts already split by local day (`private.split_by_day`, organization time zone) and by machine / worker / order / operation.
  - Machine time is the time the operation was in progress (status history), clipped to the period. Worker time comes from the work sessions. Downtime that crosses midnight is split between the days.
  - Inspections are not production: their pieces and running time are left out of output and machine time. Their scrap stays in scrap by reason, and the inspector's time stays in worker time.
- **Figures** (`src/modules/reports/rules.ts`, pure):
  - **Output** grouped by day / machine / worker / order / customer.
    - Pieces are counted per operation, so a part that goes through three operations counts three times.
    - Efficiency = routing time of the reported pieces (cycle × pieces, without setup) ÷ machine time. By worker, the worker's own time is used instead.
    - Good pieces per hour.
  - **Machines:**
    - Capacity = hours per day (D-041) × working days, or × every day for an unattended machine.
    - Running time, downtime, idle = the rest; utilization = running time ÷ capacity.
    - Tool changes.
  - **Orders:** orders completed in the period, due in it, or open and overdue. Days late, the on-time share, the average delay, and on time per customer.
  - **Costs:**
    - Cost of a completed order = material (issued − returned, at the moving-average value) + machine hours × hourly rate + external operations (D-041).
    - The cost is also shown per good piece.
    - A machine without a rate is marked, so the cost is known to be incomplete.
  - **Material and tools:** material consumption per item, own stock value today, tools used up / scrapped in pieces.
- **Screens and export:**
  - `/reports`: tabs, period (this month, last month, last 30 days, or free), filters in the URL, single-series bar chart with a screen-reader table.
  - `/reports/export` writes the same figures to Excel, one sheet per table.

**Consequences:**

- Tools have no price, so tool consumption is in pieces only.
- No shift performance yet: shifts are not on reports.
- Costs have no overhead, labour rate or setup price.
- Pieces per operation are not "finished pieces"; those are in the finished goods store.
- Machine time comes from the operation status. An operation left in progress keeps counting, so utilization can exceed 100 %.

## D-044 — Editing, deactivating and reactivating users (2026-11-03)

**Context:** `/admin/users` could create users and reset passwords, but not change a name or role, nor take an account away from someone who left.

**Decision:**

- **Data:** migration `20261106100000_member_management`, RPCs `update_member(org, user, full_name, role)` and `set_member_active(org, user, active)`. Both run as definer with `users.manage` and always refuse:
  - oneself (`self`; one's own data stay on the profile page);
  - the Zcore support account;
  - other organizations.
- **Last manager:** the organization always keeps at least one active member, not support, whose role has `users.manage` (`last_manager`).
  - The caller is always such a member, so in practice this protects against a support session demoting or deactivating the only administrator.
- **Audit:** each change writes `users.update` (before / after name and role), `users.deactivate` or `users.reactivate`, besides the row audit.
- **Deactivating:**
  - Archives the membership, and the server action signs the user out on every device (`revoke_user_sessions`).
  - The login screen says the account is not active.
  - The profile, the linked employee, reports and history stay.
- **Reactivating:** the user signs in again with the same password and role.
- **Role changes:** apply on the next request, since permissions are read live.
- **Screen:** the row menu on `/admin/users` offers "Uredi" (full name and role; the username stays), "Resetuj lozinku" (active users only) and "Deaktiviraj" / "Aktiviraj ponovo", each with a confirmation.

**Consequences:** No username change (it is the sign-in and the synthetic e-mail). Custom roles are still created only by scripts (no role editor).

## D-045 — Shift performance in reports (2026-11-03)

**Context:** The reports (D-043) had no shift. Production reports carry no shift of their own, but workers clock in to a recognised shift (attendance, D-021).

**Decision:**

- No new column. A production report and a work session belong to the shift of the worker's attendance session at that moment: the report time, or the start of the work session. No attendance = "Bez smjene".
- **Data:**
  - `report_production` (migration `20261107100000_report_shifts`) adds `shift_id` to the output and worker-time facts, and lists the shifts.
  - A lookup index (`20261107110000`): the report over 10 months of demo data takes ~0.06 s.
- **Screen:** production report "Grupiši po: Smjena" shows good / scrap, worker time, efficiency and good per hour per shift, using the workers' time like the grouping by worker.

**Consequences:** Machine time has no shift (machines run across shifts); a worker who did not clock in counts as "Bez smjene"; a report sent just after clock-out also counts there.

## D-046 — Role editor (2026-11-03)

**Context:** Only the seven system roles existed; a company could not give someone e.g. a warehouse role without the tools.

**Decision:**

- **Settings → "Uloge i dozvole"** (`/settings/roles`, `roles.manage`): roles on the left with their active members; the chosen role on the right with its permissions by module (Osnovno, Proizvodnja, Prisustvo i smjene, Magacin).
  - Each permission has a Bosnian name and hint (`rolesEditor.permissions.<key with _>`).
  - Modules not enabled for the organization are marked.
- **System roles stay fixed:**
  - They are read-only (their permissions come from `permissions.default_roles`).
  - This keeps the admin role from being locked out, as the original RLS already required.
  - "Kopiraj kao novu ulogu" starts a custom role from any role; "Nova uloga" starts an empty one.
- **RPCs** (migration `20261108100000_custom_roles`), each one transaction:
  - `save_custom_role(org, role | null, name, permissions[])`:
    - the name is unique among active roles, ignoring case;
    - the key is generated as `custom_…`;
    - `platform.manage` is never granted;
    - an audit entry records name and permissions before and after.
  - `archive_custom_role(org, role)`: only while no active member has the role.
- Custom roles appear in the user forms. Their dashboard starts empty (D-037), and their home is `/dashboard`.

**Consequences:** System roles cannot be adjusted directly; a company copies them. A custom role named like a system role is refused only against the stored name of the system role.

## D-047 — Domain: website on zcore.ba, registration on app.zcore.ba (2026-11-03)

**Context:** The product owner bought `zcore.ba`. The root domain is the company website (hosted elsewhere). The app should take new registrations on `app.zcore.ba`, and every company keeps signing in on its own `<slug>.zcore.ba` (D-009).

**Decision:**

- **`app.zcore.ba`** (`REGISTRATION_HOST`) serves only:
  - `/registracija`;
  - `/login`, a "Adresa firme" form;
  - `/login/firma`, which checks the address with `get_login_organization` and redirects to `https://<slug>.zcore.ba/login`, or back with "firma ne postoji".

  Every other path on that host redirects to `/registracija` (proxy). `app` was already a reserved subdomain, so it is never a tenant.

- **Company sign-in:** stays on `<slug>.zcore.ba`, unchanged. A sign-in page without a company (also localhost without `?org`) shows the address form.
- **DNS:** a wildcard (`*.zcore.ba`) on Vercel needs Vercel's nameservers.
  - The zone `zcore.ba` therefore moves to Vercel DNS.
  - The website's records (root A / `www`, e-mail MX / TXT) are recreated there, pointing to the website host.
  - `app.zcore.ba` and `*.zcore.ba` are domains of the Vercel project.

**Consequences:** The website and the app share one DNS zone at Vercel. A company address is only shown as existing or not (like the login screen).

## D-048 — Kiosk on kiosk.zcore.ba, installable as an app (2026-11-04)

**Context:** The product owner wants one kiosk address for every company: the tablet asks only for the activation code, and after activation it shows the company's kiosk as before. If needed, an app that can be downloaded and installed on an Android phone or tablet and runs like a kiosk.

**Decision:**

- **`kiosk.zcore.ba`** (`KIOSK_HOST`) serves only `/kiosk` and its files (manifest, icons); every other path redirects to `/kiosk` (proxy). `kiosk` is a reserved subdomain and slug, so it is never a tenant.
- **The code finds the company:** activation codes are unique across all organizations (partial unique index; `create_kiosk_activation` draws again on a clash). `kiosk_activate_code(code)` (service role only) activates the tablet of any company that is not archived and returns its slug. On `<slug>.zcore.ba/kiosk` the old `kiosk_activate(slug, code)` still binds the code to the host's company.
- **Device cookie = `<slug>.<kiosk id>.<secret>`.** On kiosk.zcore.ba the company comes from the cookie, on `<slug>.zcore.ba` from the host (a cookie of another company does not count there). The database still checks slug + kiosk + secret on every call, so the slug in the cookie grants nothing by itself. Cookies of tablets activated before (`<kiosk id>.<secret>`) keep working on their company's host.
- **Rate limit:** activation is limited to 20 attempts per hour per client address (`registration_attempts`, kind `kiosk_activate`; shared helper `src/lib/rate-limit.ts`, also used by registration). A wrong code cannot be told apart from an unknown company.
- **App = installable web app (PWA), not an APK.** `/kiosk/manifest.webmanifest` (display `fullscreen`, scope `/kiosk`) and generated icons make Chrome offer "Install app"; the activation screen shows an install button when Chrome offers it, and explains the menu fallback and Android screen pinning (which keeps workers inside the kiosk). Reasons: camera and Web NFC keep working (they need Chrome; an Android WebView has no Web NFC); updates arrive with every deploy; no app store and no signing. A native app could only lock the screen without device owner provisioning by using the same screen pinning.

**Consequences:** Admins see `https://kiosk.zcore.ba` in `/settings/kiosk`. Real kiosk lock (no way out without a PIN) needs a dedicated device or an MDM (device owner); the PWA uses screen pinning. Building an APK (Trusted Web Activity) remains possible later and needs a JDK, the Android SDK and a signing key.

## D-049 — Platform billing: packages, monthly payments, locking unpaid firms (2026-11-08)

**Context:** Product owner (2026-11-04): firms pay Zcore monthly by invoice and bank transfer (most have no card). The platform admin needs one place per firm: package, modules, paid or not, and a lock for firms that do not pay — by hand or automatically after a grace period set in the settings — while their people can still finish work in progress. No instalments ("to ne može tako"). Design: `docs/superpowers/specs/2026-11-04-platform-billing-design.md`, plan: `docs/superpowers/plans/2026-11-04-platform-billing.md`.
**Decision:**

- **Ten modules** (`20261110100000_module_split`): core, production, planning, reports, inventory, finished_goods, tools, attendance, kiosk (add-on), payroll (add-on); customers / machines / employees belong to core. Firms kept everything (org_modules copied from production / inventory / attendance). `module_dependencies`: planning and finished_goods need production, kiosk and payroll need attendance. Modules 11–15 (maintenance, quotes / orders, purchasing, costing, quality+) come later as their own projects.
- **A permission works only while its module is enabled** (`20261110101000`): `has_permission` / `permitted_org_ids` join `permissions.module_key`; `getMemberAccess` does the same. A firm without a module in its package cannot read that module's data through the API either.
- **Packages** (name, monthly price with history, modules), assigned per firm from a month (`organization_packages`); assigning or changing a package switches its modules on and other paid modules off; trial modules stay. Archived packages stay with firms that have them.
- **Payments**: a month (first day, org timezone) is paid (`billing_payments` row with day and note) or not; "Poništi" deletes the row, the audit log keeps it. Due = last day of the month + grace days (platform default 15, per firm override). First billed month = the month the package was assigned; the running month never locks.
- **State is computed when read** (`private.org_lock_state`): trial, active, warning (unpaid month due within the warning days, default 5), overdue (due passed but auto-lock off or "open until" a day), locked (by hand with a reason, or for an unpaid month). No job: a payment unlocks at once, the due date locks exactly. The Zcore organization is never locked.
- **Enforcement** (`20261110120000`): one BEFORE trigger `lock_guard` on every tenant table, default deny with `organization_locked` (42501, shown as "denied"). Allowed while locked: production reports, work sessions, downtime, tool changes, status history, close requests, operation workers, inserts / tool movements, attendance sessions / alerts, kiosk credentials, finished goods movements, delivery notes and lines, consumption, reservations, lots, notification reads, audit log, support requests; updates of production orders / operations, kiosks, profiles; machines only status changes (generated columns ignored, `20261110121000`); stock documents / movements tied to a production order (issue, remnant, return). Skipped for the service role (registration, kiosk device, support entry) and for the platform admin. **Tables added later must attach `lock_guard`.**
- **App**: while locked `getMemberAccess` keeps only `*.read` and orders.manage, orders.material.update, orders.close.approve, quality.inspect, machines.status.update, inventory.move, finished_goods.manage, support.approve; "Novi nalog" and the order actions menu are hidden. `my_billing_notice` feeds a strip in the management app and on the floor (locked for everyone; warning / overdue only for `org.settings.manage`), with the contact from the platform settings.
- **Screens**: `/platform` list (package, monthly amount, state, last paid month, members; filters, search); `/platform/organizations/[id]` (lock with a reason / unlock, open until a day, package, grace days, auto-lock, modules by source with trials, support access, payments per month, history); `/platform/settings` (packages, grace / warning days, contact, trial days).

**Consequences:** Locking is safe against direct API calls. A firm locked while a worker is mid-operation can finish it, ship it and clock out. Support accounts are locked too; the platform admin opens the firm temporarily when support must change something. No online payment, invoices are still issued outside the app.
