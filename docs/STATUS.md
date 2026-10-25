# Status

Progress log. Read at session start, update at session end. Newest entry on top.

## Current phase

**Phase 1 — Foundation** mostly done; **Phase 2 — Manufacturing foundation** in progress (see `ZCORE_CONTEXT.md` §14): machines, employees, catalogs, customers, materials and products/parts (revisions, routings with inspections, attachments, raw piece weight) are implemented. Remaining Phase 1: complete user management, full org settings screen, Vercel deploy. Next in Phase 2: production orders and operations.

## Implemented

- Next.js 16 (App Router, TypeScript strict + `noUncheckedIndexedAccess`, Cache Components + Partial Prefetching), Tailwind CSS 4, shadcn/ui (base-nova): sidebar, sheet, dropdown-menu, alert-dialog, field, empty, badge, avatar, breadcrumb, skeleton, sonner, tooltip, table, card, input, native-select, alert.
- **App shell** (structure from shadcn blocks `dashboard-01` / `login-03`, no demo data):
  - Desktop `(app)`: inset sidebar (org header, nav groups, user menu with sign-out), site header with sidebar toggle, breadcrumb and theme switch.
  - Mobile `(floor)`: sticky header + fixed bottom navigation (48px+ targets, safe-area aware); sign-out asks for confirmation.
  - Navigation registry `src/lib/navigation/registry.ts`: items filtered by enabled `org_modules` and the member’s permissions (read through RLS). Only implemented routes are listed.
  - Light/dark/system theme (`next-themes`) with `color-scheme` per theme, so browser-drawn controls (native select popups, scrollbars) are dark in dark mode; toasts (`sonner`), 8px spacing grid.
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
- **Auth** (`src/modules/auth/`, `src/lib/auth/`): username + password login (synthetic e-mail), generic error for wrong credentials, deactivated-account and rate-limit messages, sign-out. **One active session per user** (D-013, `20261024120000`): sign-in revokes the user's other sessions; the proxy checks `is_session_active()` on every request and signs a replaced device out to `/login?session=replaced` with a notice. Sign-out ends only the current device's session. `getCurrentMember()` / `requireMember()` (request-cached, tenant-checked, RLS-backed). `requirePermission()` / `hasPermission()`.
- **Routing by role** (`src/lib/auth/home.ts`): operator → `/floor`; all other roles (incl. custom) → `/dashboard`. `(app)` layout sends operators to `/floor`; `(floor)` is open to every member.
- **Screens:** `/login`, `/dashboard` (placeholder: no modules active), `/floor` (mobile-first placeholder), `/admin/users` (server-paginated DataTable with search, role and status filters over the `member_directory` view; add-user sheet for `users.manage`; PermissionDenied without `users.read`). Loading, empty, no-results, error and denied states.
- `member_directory` view (`20261023180000`, `security_invoker`): flat member list for tables; covered by tenant-isolation tests.
- **Add user** (`src/modules/users/`): `requirePermission('users.manage')` → Zod → role checked via RLS → Auth Admin API (service role, `src/lib/supabase/admin.ts`) → trigger provisions profile + membership → explicit audit `users.create` (no password logged). Duplicate username → field error.
- **Module `production` — machines, employees, catalogs** (`20261024100000`, `20261024101000`, D-012):
  - Tables: `catalog_items` (per-org lists: machine types, locations, departments, job titles, skills; unique active name per kind), `machines` (code unique among non-archived, status `available/running/stopped/maintenance/inactive`, `status_changed_at/by` set by trigger), `employees` (auto employee number per org, optional 1:1 link to a user account, status active/inactive), `employee_skills` (level 1–3), `employee_machines`. `archived_at` on the main tables, RLS, composite tenant FKs; catalog FKs include the kind, so e.g. a skill cannot be used as a machine type. Row-change audit triggers on all five tables.
  - RPC `set_machine_status` (definer; managers any status, operators only machines they are qualified for as an active employee, never to/from `inactive`) and `save_employee` (invoker; employee + skills + machines in one transaction, numbering serialized per org).
  - Views `machine_directory`, `employee_directory` (security_invoker) for list screens.
  - Screens: `/machines` and `/employees` (server-paginated tables, search, filters incl. skill, archive view, add/edit sheets, archive/restore with confirmation, quick machine status change), `/settings/catalogs` (per-kind lists: add, rename, archive, restore), `/floor/machines` (operator: own machines, large status buttons). Module-disabled, permission-denied, empty, no-results and error states.
  - Domain code in `src/modules/{catalogs,machines,employees}`; shared helpers `src/lib/forms.ts` (form Zod helpers), `src/lib/actions/result.ts` (action results, Postgres error mapping), `permitAction()` and `getMemberAccess()`.
- **Module `production` — products and parts** (`20261024140000_products`, D-014):
  - Tables: `operation_types` (name + abbreviation, internal/external), `products` (customer part number unique among active, name, customer as text, product type, unit `pcs/kg/m/m2/set`), `product_revisions` (one current per product; drawing number, description, material grade, material shape, blank geometry round/prismatic with numeric dimensions, cut length, kerf, net mass), `product_operations` (sequence 10/20/30 unique per revision incl. archived, operation type, machine type or machine, external company, setup min, cycle **seconds**, operator note), `product_attachments` (main drawing, machine drawing linked to a main drawing and optionally an operation, image, other). New catalog kinds `product_type`, `material_shape`; `machines.cycle_time_unit` (null = org default) and `organizations.settings.cycle_time_unit` (`min` default).
  - Integrity in the database: only the current revision of a non-archived product can change (triggers, `55000`); external operations have no machine/times (`23514`); attachment links stay within the revision; storage paths must start with the organization id.
  - RPCs (invoker, one transaction): `create_product`, `update_product`, `create_product_revision` (copies data, operations, attachments; becomes current), `copy_product` (new part number, no attachments), `set_current_revision` (go back to an older revision), `move_product_operation` (swap numbers); `product_history` (definer, `products.read`) reads the audit log of the product and its children. Semantic audit entries `products.revision_created/revision_restored/copied`.
  - Private Storage bucket `product-files` (PDF/PNG/JPG/WEBP, 20 MB): read with `products.read`, upload with `products.manage`, only in the own organization's folder; no update/delete (attachments are archived). Upload = server action issues a signed upload URL for a server-chosen path → browser uploads → server action reads size/type back from Storage and records the row. Download via 5-minute signed URL.
  - Screens: `/products` (server-paginated, search part number/name/customer/drawing, filters type/shape/archive), `/products/[id]` with tabs Osnovno / Operacije (reorder, archive, totals, quantity calculator) / Prilozi (upload, main + machine drawings) / Historija (revisions with "set as current", change log); add/edit sheet, new revision, copy as new part, archive/restore. `/settings/operation-types`, `/settings/production` (cycle-time unit, `org.settings.manage`), cycle-time unit in the machine form; catalogs page shows the new kinds.
  - Decimal values are handled as strings end to end (`src/lib/decimal.ts`, `optionalDecimal`, `numericParam`), never as floats.
- **Products v2 — customers, materials, raw piece weight, inspections** (`20261024160000_products_customers_materials`, D-015):
  - `customers` (name unique among active, tax ID, address, city, country, contact, phone, e-mail, notes; `customers.read/manage`); products reference a customer (old text names migrated). Screens `/customers` (search, archive view) and `/customers/[id]` (data + the customer's products).
  - `material_groups` (density kg/dm³) → `materials` (designation, optional own density); every organization gets a starter list (steel, stainless, aluminium, brass, copper, bronze, titanium, cast iron, plastics; trigger for new orgs). Revisions reference a material (old text grades migrated). Screen `/settings/materials`; the product form picks material and customer by typing (`SearchSelect` on shadcn Combobox, diacritic-insensitive, e.g. "inox 304").
  - Raw piece ("sirovi komad"): shape round / tube / rectangular / hexagon / other drives the inputs (Ø; outer Ø + wall; width × thickness; across flats); `cut_length_mm` is the piece length (old `blank_height_mm` migrated into it). Weight = cross-section × length × density, computed live in the form and on the detail page (exact decimals); consumption per piece = length + kerf.
  - Revision label optional (only when the drawing has one); new revisions still need a label, the next suggestion after "no label" is A. The list no longer shows the revision.
  - Routing without visible numbers: abbreviation · name · machine …; reorder by drag & drop (native HTML5) or arrows → `reorder_product_operations`. `sequence` is only the internal position.
  - Inspections: `operation_types.is_inspection`; organization setting `inspection_mode` automatic / manual / custom (`/settings/production`); `products.inspection_plan` between / final / none (custom: asked when creating a product; editable on the product). `private.normalize_routing` places generated inspections (`auto_inspection`, read-only, not draggable) after every operation and/or at the end and re-runs on every routing change.
  - Files can be added directly in the "new product" form (uploaded after saving, kind per file).
  - Cycle times shown with one decimal (2,5 min), stored exactly in seconds.
- Tests: `npm run check` (169 unit tests), `npm run test:db` (91 RLS/integration tests), `npm run e2e` (33 Playwright tests, serial: login of all 5 demo roles, field validation, wrong password, protected routes, operator kept out of the app, bottom-nav sign-out with confirmation (mobile), subdomain tenant, sidebar filtered by permission, users table search/filters, dark theme, admin creates user who then logs in; machines/employees list filters, warehouse read-only, admin catalog → machine → employee → archive flow, operator machine status on mobile, operator without employee profile, second-device sign-in signs the first device out; products: head of production reads routing, weight and totals and opens the customer, warehouse read-only, admin builds operation types → customer → product with material picked by typing, computed weight and a PDF → two operations reordered by drag & drop and arrows → revision A → history → archive).
- **Repository:** https://github.com/zcoree01/zcoreproduction (**public**), branch `main`. Git in this workspace must push as `zcoree01` (account `zcoreltd` has no write access).
- CI (GitHub Actions): `check` + `build` on every push/PR; green on `main` (`3a390ee`, products v2). DB and e2e tests need Supabase secrets, so they are not in CI yet.
- **No credentials in the repository:** demo/test passwords come from `.env.local` (`DEMO_PASSWORD`, `TEST_TENANT_PASSWORD`, see `.env.example`).
- Claude Code: Prettier hook after every Write/Edit; slash commands `/feature`, `/verify`, `/status`.

### Permission matrix (system roles)

| Permission               | admin | director | head_of_production | warehouse | operator |
| ------------------------ | :---: | :------: | :----------------: | :-------: | :------: |
| `org.settings.manage`    |   ✓   |          |                    |           |          |
| `users.read`             |   ✓   |    ✓     |         ✓          |           |          |
| `users.manage`           |   ✓   |          |                    |           |          |
| `roles.manage`           |   ✓   |          |                    |           |          |
| `audit.read`             |   ✓   |    ✓     |                    |           |          |
| `machines.read`          |   ✓   |    ✓     |         ✓          |     ✓     |    ✓     |
| `machines.manage`        |   ✓   |    ✓     |         ✓          |           |          |
| `machines.status.update` |       |          |                    |           |    ✓     |
| `employees.read`         |   ✓   |    ✓     |         ✓          |           |          |
| `employees.manage`       |   ✓   |    ✓     |         ✓          |           |          |
| `products.read`          |   ✓   |    ✓     |         ✓          |     ✓     |          |
| `products.manage`        |   ✓   |    ✓     |         ✓          |           |          |
| `customers.read`         |   ✓   |    ✓     |         ✓          |     ✓     |          |
| `customers.manage`       |   ✓   |    ✓     |         ✓          |           |          |

`machines.manage` also manages machine types and locations; `employees.manage` departments, job titles and skills; `products.manage` operation types, product types and materials. Operators get product access later through their production orders. Every member reads catalog names and their own employee row.

System roles' permissions are fixed (changed only via migration); tenants can manage permissions of custom roles.

**Roles are per organization by design** (D-006): every organization gets its own 5 system roles, so `roles` holds 5 rows × number of organizations (currently 15 for `demo`, `test-tenant-a`, `test-tenant-b`); there are no duplicates within one organization (unique `organization_id, key`). `memberships` is the join table user ↔ role ↔ organization. Reviewed with the product owner on 2026-10-24 and kept, because per-org permissions, custom roles and DB-enforced tenant isolation depend on it.

## Demo data

Organization `demo` („Demo Metal d.o.o."), created by `npm run seed:demo` (idempotent). Users: `scripts/lib/demo-users.ts`. The seed also enables module `production` and adds demo catalogs, machines `CNC-01`, `CNC-02`, `PILA-01` and employees 1 (Omer Operater, linked to `operater`, qualified for CNC-01/02) and 2 (Benjamin Bravar, no account) — `scripts/lib/demo-production.ts`. Products: operation types RZ, TO, GL, BS, BU, KT (inspection), CI (external), customer „Demo Kupac d.o.o." and product `DM-4711-02` (rev. A, C45 Ø45 × 125, 5 operations) — `scripts/lib/demo-products.ts`. Materials come from the migration's starter list.

**Passwords are not in the repository** (it is public). All demo users share `DEMO_PASSWORD` from `.env.local`; `npm run seed:demo` applies it. Passwords committed before 2026-10-24 were rotated and no longer work.

Local login: `http://localhost:3000/login?org=demo` or `http://demo.localhost:3000/login`.

| Role               | Username          | Lands on     |
| ------------------ | ----------------- | ------------ |
| admin              | `admin`           | `/dashboard` |
| director           | `direktor`        | `/dashboard` |
| head_of_production | `sef.proizvodnje` | `/dashboard` |
| warehouse          | `skladiste`       | `/dashboard` |
| operator           | `operater`        | `/floor`     |

Permanent test tenants (`tests/shared/test-tenants.ts`): `test-tenant-a`, `test-tenant-b` (users `admin`, `operater`, password `TEST_TENANT_PASSWORD` from `.env.local`). Created by `npm run test:db`; e2e needs them. Every e2e run adds one `e2e.*` operator user with a random password to `test-tenant-a`, and one machine type, skill, machine and employee (archived at the end) to `test-tenant-b`. `test-tenant-b` also holds a permanent floor fixture (`e2e/production-fixture.ts`: user `e2e.floor`, employee 800001, machine `E2E-FLOOR`). DB tests create and remove rows prefixed `DBT`/`DBTest` and enable `production` for both test tenants.

## Not done yet / known gaps

- No forced password change on first login; admins hand out the initial password.
- Users can be created but not yet edited, deactivated or re-roled in the UI (RLS already allows `users.manage` to update memberships).
- No custom-role management UI; no org settings screen.
- After login the user always lands on the role home (no "return to requested page").
- Dev overlay shows an informational `instant` validation message when an operator opens `/dashboard` (intentional redirect to `/floor`).
- Table sorting is fixed (by username); column sorting UI not yet added to DataTable.
- Demo org contains an extra user `testniradnik` (Direktor) created by hand via the UI on 2026-10-23 (audit log: `users.create` by `admin`). Tests do not depend on the exact user count.
- DB/e2e tests run against the real linked project (no Docker, no separate test project); test tenants also appear in its tables.
- Not deployed yet: Vercel project not connected (CLAUDE.md: auto-deploy from `main`, preview per PR).
- E2E tests run serially (`workers: 1`, ~2.5 min), because a sign-in revokes the same user's sessions in parallel tests.
- Machines/employees: no detail page, history view, attachments, serial number or shift data yet; machine status is manual (production reports in Phase 3 will drive running/stopped). Module activation (`org_modules`) is checked in pages for UX only; data access is governed by permissions/RLS.
- New organizations do not get module `production` automatically (commercial activation via service role, `ensureModuleEnabled()`).
- Supabase Auth: enable leaked-password protection in the dashboard (advisor warning). Advisor warnings for `write_audit`, `get_login_organization`, `set_machine_status` and `product_history` (SECURITY DEFINER, enforce their own rules) are intentional.
- Products: operators cannot see products yet (comes with production orders); materials are not linked to the material warehouse yet; no BOM/assemblies; no weight for profiles (shape "other"); product types are a catalog, units a fixed list. "Current operation" and production status per product/customer come with production orders. Attachments: only PDF/images (no DXF/STEP/NC programs); files are never deleted from Storage. History shows changed field names, not old/new values. Starter densities are typical data-sheet values (each organization can correct them). The old catalog kind `material_shape` is no longer offered (rows stay in the database).

## Next step

1. **Complete user management** (`/admin/users`): edit full name and role, deactivate / reactivate (archive membership, with `ConfirmDialog`), admin password reset, optionally "change password on first login". Audit entries for every action, server-side `users.manage`, RLS already allows it; unit + e2e tests.
2. **Org settings** (`org.settings.manage`): organization name, timezone; foundation for configurable shifts later.
3. **Deploy:** connect the GitHub repo to Vercel (production from `main`, preview per PR), set env vars there, wildcard subdomain `*.zcore.ba`.
4. **Test isolation:** separate Supabase project for `test:db`/e2e and add them to CI with GitHub secrets.
5. **Phase 2/3 continued:** production orders (product revision + quantity + due date) with order operations generated from the routing; on the floor a worker starts an operation on a machine → machine status "running", estimated (setup + cycle × qty) vs. actual time; stopping / maintenance asks for a downtime reason and minutes; product list and customer page then show the current operation and production status.

## Log

### 2026-10-25 — Form tweak, push

- Product form: net mass on its own row below length and kerf.
- Explained to the product owner: generated inspections need an inspection plan on the product (or mode "automatic"/"custom" for new products); assigning workers, current operation and status per product come with production orders (open questions 1–7 asked: who creates orders, routing copy, assignment per operation, quantity reporting, statuses, downtime reasons, who inspects).
- Pushed `feat/products` (CI green), fast-forwarded `main` to `3a390ee` and pushed (CI green).

### 2026-10-24 — Products v2: customers, materials, raw piece weight, inspections

- Product owner feedback on the first version: material as group → designation picked by typing; raw piece weight from shape, dimensions and density; "sirovi komad" instead of "sirovac"; cycle with one decimal; drag & drop plus arrows, no 10/20/30 numbers; revision optional and not in the list; upload when creating a product; customers as their own table with their products; inspection between operations configurable (automatic / manual / custom).
- Weight formulas checked against public metal weight calculators (round π/4·d², tube π·s·(D−s), rectangular w·t, hexagon √3/2·s²; × length × density); unit tests use reference values (Ø45 × 125 C45 = 1,561 kg).
- Migration `20261024160000_products_customers_materials` with data migrations (customer names, material grades, blank height → length, prismatic → rectangular). Types regenerated, demo re-seeded, advisors: no new warnings.
- Found: the demo product's TO/GL order had been swapped by hand in the UI before this change (audit log, user `admin`); left as is.
- Verified: `npm run check` (169), `npm run test:db` (91), `npm run e2e` (33), `npm run build`, `npm run format:check`; screens checked by screenshot (product form with material picker and weight, routing, materials).

### 2026-10-24 — Products and parts (revisions, routings, attachments)

- Product answers (asked before implementation): revision = own record, old ones stay as history, going back to an older revision must be possible; part number comes from the customer; product types distinguish finished products (no semi-finished); blank dimensions as separate numbers (round: diameter/width/height, otherwise width/height/thickness), one piece per cut; operations from a catalog with abbreviation (e.g. BU); cycle time per piece in minutes by default, switchable to seconds per organization and per machine; external operations with company, no machine/times; main drawings plus machine drawings (CNC dimensions) linked to them; operators see products only through their orders (later).
- Migration `20261024140000_products` (also extends `catalog_items.kind`, `catalog_manage_permission`, adds `machines.cycle_time_unit`, an `organizations.settings` check and recreates `machine_directory` with the new column). Types regenerated; advisors reviewed (only the intentional `product_history` definer warning is new).
- Verified: `npm run check` (146), `npm run test:db` (84), `npm run e2e` (33), `npm run build`, `npm run format:check`; screens checked by screenshot (list, detail tabs, sheets, dark mode). Demo seed re-run (`npm run seed:demo`).

### 2026-10-24 — One session per user, device-only sign-out

- Product decision: a user may be signed in on one device only; signing in on a new device signs the old one out; sign-out affects only the current device.
- Migration `20261024120000_single_session` (`is_session_active()`), `src/lib/auth/route-guard.ts` (proxy decision, unit-tested), `signInAction` revokes other sessions (`scope: "others"`), sign-out uses `scope: "local"`, login notice for replaced sessions.
- Playwright now runs serially. Deleted the merged branch `feat/machines-employees` (local + GitHub).
- Pushed to `main` together with the STATUS update (`5e1116c`); CI green.
- Verified: `npm run check` (103), `npm run test:db` (65), `npm run e2e` (30), `npm run build`, `npm run format:check`.

### 2026-10-24 — Machines, employees, catalogs (Phase 2 start)

- Product answers (asked before implementation): catalogs per organization (types, locations, departments, job titles, skills with level); machine status manual now, operators may change status of their own machines (all except `inactive`); employee ↔ machine = simple yes/no; account link optional and 1:1; employee number automatic; employees visible to admin/director/head of production.
- Migrations `20261024100000_machines_employees`, `20261024101000_save_employee_optional_args` (follow-up so generated RPC types mark optional args optional). Types regenerated; advisors reviewed.
- Fixed along the way: client-side Zod messages were shown in English in forms (incl. the existing add-user username field) → only server messages override the Bosnian field texts; `supabase-js .contains()` encodes arrays as Postgres arrays, so jsonb filters pass a JSON string.
- Found: Supabase sign-out revokes all sessions of a user → parallel e2e tests signing out the same user broke each other; tests now use dedicated users (see known gaps).
- Verified: `npm run check` (100), `npm run test:db` (62), `npm run e2e` (29), `npm run build`, `npm run format:check`; screens checked by screenshot (desktop light/dark, mobile floor).
- Committed `6380873`, pushed via branch `feat/machines-employees` (CI green), fast-forwarded into `main` and pushed (CI green).

### 2026-10-24 — Security cleanup, push, dark-mode fix

- Repository is public → removed demo/test passwords from the code; they now come from `.env.local` (`DEMO_PASSWORD`, `TEST_TENANT_PASSWORD`). All previously committed passwords rotated (demo users, test tenants, 6 old `e2e.*` users); verified the old admin password is rejected.
- Pushed `main` to GitHub (`zcoree01/zcoreproduction`); GitHub Actions CI green.
- Fixed dark mode for native selects: `color-scheme` per theme + shadcn `NativeSelectOption`; verified option colors in light and dark.
- Reviewed the "duplicate roles" question: roles stay per organization (see Permission matrix section / D-006).
- Verified: `npm run check` (66), `npm run test:db` (34), `npm run e2e` (22), CI on GitHub.

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
