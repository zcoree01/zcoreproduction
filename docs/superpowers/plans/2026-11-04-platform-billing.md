# Platform Billing, Module Split and Organization Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Zcore platform admin manages packages, records monthly payments per firm and locks (manually or automatically after the grace period) firms that have not paid, while their people can still finish work already in progress.

**Architecture:** Modules are split from 4 to 10 keys (data migration, no firm loses anything). Billing lives in new platform tables; the lock state is _computed_ in Postgres from those tables at query time (no cron). Enforcement is one generic `BEFORE INSERT/UPDATE/DELETE` trigger on every tenant table with a per-table rule (default deny), so RLS writes and SECURITY DEFINER RPCs are both covered. The app strips write permissions from `getMemberAccess` while locked (buttons disappear) and shows a banner.

**Tech Stack:** Next.js App Router, TypeScript strict, Supabase (Postgres, RLS), Zod, Vitest, Playwright, shadcn/ui, next-intl (`messages/bs.json`).

**Spec:** `docs/superpowers/specs/2026-11-04-platform-billing-design.md` (approved 2026-11-04). Mockup: `.superpowers/brainstorm/2012-1793831932/content/platform-v1.html` (local).

## Global Constraints

- Follow CLAUDE.md: `organization_id` + RLS on tenant tables, server-side permission checks, Zod at every boundary, `numeric` for money, `timestamptz` UTC, archive not delete, audit log for important actions, UI strings only via `messages/bs.json`, no `any`.
- RLS permission checks use `organization_id in (select private.permitted_org_ids('<key>'))` — never per-row `has_permission(organization_id, …)` (D-042).
- New migrations are timestamped after `20261109100000`: `20261110100000_module_split.sql`, `20261110110000_platform_billing.sql`, `20261110120000_organization_lock.sql`. After each: `npx supabase db push --linked` and `npx supabase gen types typescript --linked > src/lib/supabase/types.ts`.
- **Shared DB / other sessions:** another Claude session ("Magacin materijala") works in this repo. Message it before every `db push`, `test:db`, `e2e`, commit and push; never stage its files.
- Platform actions require `platform.manage` (server) and `private.is_platform_admin()` (DB).
- Lock error: `raise exception 'organization_locked' using errcode = '42501'` (existing mappers show it as "denied"; the banner explains why).
- Defaults: grace 15 days, warning 5 days, trial 14 days (exists). Months are calendar months in the organization's `timezone`; a month is stored as its first day (`date`).
- The Zcore organization (`organizations.is_platform`) is never locked.
- No partial payments: a month is paid (`paid_on` set) or not.
- Decision record: append **D-049** to `docs/DECISIONS.md`; log entry in `docs/STATUS.md`.

## Review Focus

1. **Allowed work while locked, end to end:** an operator starts, reports and finishes an operation; the warehouse issues material for an existing order (with a remnant); finished goods are received and a delivery note issued; a kiosk clock-in works — each must succeed on a locked firm. (Tests in Task 3.)
2. **Month boundaries in the org timezone:** a payment due "15 days after October" is due through 2026-11-15 23:59 Europe/Sarajevo and locks on 2026-11-16 local, not at UTC midnight. (Test in Task 2.)
3. **Unlocking is immediate:** marking the overdue month paid makes the next write succeed in the same session, without reload or cache. (Test in Task 3.)
4. **Package change keeps history:** changing a package price or a firm's package does not change the amount of earlier months. (Test in Task 2.)
5. **Service role and platform paths are not blocked:** registration, support entry/exit (service role) and platform RPCs work on a locked firm. (Test in Task 3.)

---

### Task 1: Split modules into 10 keys

**Files:**

- Create: `supabase/migrations/20261110100000_module_split.sql`
- Modify: `src/lib/navigation/registry.ts`, `src/modules/dashboard/widgets.ts`, every page / route listed by `grep -rn 'modules.has("' src` (see table), `messages/bs.json` (module names if shown), `src/lib/supabase/types.ts` (regenerated)
- Test: `tests/db/module-split.test.ts`, `src/lib/navigation/registry.test.ts`

**Interfaces:**

- Produces: module keys `core, production, planning, reports, inventory, finished_goods, tools, attendance, kiosk, payroll, platform`; table `public.module_dependencies(module_key text references modules, requires text references modules, primary key (module_key, requires))` with rows `planning→production, finished_goods→production, kiosk→attendance, payroll→attendance`; `private.module_requirements_met(p_org uuid, p_module text) returns boolean`.

Migration:

- Insert modules: `planning` "Planiranje", `reports` "Izvještaji", `finished_goods` "Gotova roba i otpremnice", `tools` "Alati", `kiosk` "Kiosk", `payroll` "Obračun sati za plate". Rename `inventory` → name "Magacin materijala", `core` → "Osnova".
- Backfill `org_modules`: for each existing row copy to the new keys with the same `enabled`, `enabled_at`, `active_until`: production→planning, reports; inventory→finished_goods, tools; attendance→kiosk, payroll. `on conflict do nothing`.
- `permissions.module_key`: `reports.read`→reports; `finished_goods.*`→finished_goods; `tools.*`→tools; `kiosk.manage`→kiosk; `payroll.*`→payroll; `customers.*, employees.*, machines.*`→core.
- DB functions: `private.assert_finished_access` checks `'finished_goods'` instead of `'inventory'` (`create or replace`, body otherwise unchanged; read the current body first); kiosk RPCs that check `'attendance'` (`kiosk_clock`, `kiosk_session`, `kiosk_activate`, `create_kiosk_activation`) additionally require `'kiosk'` (read bodies; add the check where `'attendance'` is checked or at the top).

App code mapping (change the key in each check):

| Area                                                                                                                                   | New key                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/planning`, nav "planning", planning widgets                                                                                          | `planning`                                              |
| `/reports`, `/reports/export`, nav "reports"                                                                                           | `reports`                                               |
| `/inventory/finished`, `/inventory/delivery-notes/**` (incl. pdf/print), `/settings/delivery-notes`, finished-goods card on order page | `finished_goods`                                        |
| `/inventory/tools`, tool widgets, floor tool change catalog (`floor_operation_tools` stays)                                            | `tools`                                                 |
| `/settings/kiosk`, `/print/settings/kiosk/badges`, nav "kiosk"                                                                         | `kiosk`                                                 |
| `/attendance/monthly` pay columns, `/print/attendance/specification`, payroll settings                                                 | `payroll`                                               |
| `/customers/**`, `/machines`, `/employees`                                                                                             | `core` (no module check needed; keep permission checks) |

- [ ] **Step 1:** Write `tests/db/module-split.test.ts`: `it("gives every firm with production also planning and reports")` (after migration, for the fixture tenant `fx.a`: `org_modules` contains planning + reports with the same `active_until` as production); `it("moves reports.read to the reports module")` (`permissions` row `reports.read` has `module_key = 'reports'`); `it("refuses finished goods without finished_goods enabled")` (disable `finished_goods` for tenant A via service role, `receive_finished_goods` as A's admin → error code `42501`; re-enable in `afterEach`).
- [ ] **Step 2:** Run `npx vitest run --config vitest.db.config.mts tests/db/module-split.test.ts` → FAIL (module rows missing).
- [ ] **Step 3:** Write the migration; message the other session; `npx supabase db push --linked`; regenerate types.
- [ ] **Step 4:** Update the app checks per the table; update `registry.test.ts` expectations for the moved nav items (planning → `planning`, reports → `reports`, delivery notes / finished → `finished_goods`, tools → `tools`, kiosk → `kiosk`).
- [ ] **Step 5:** Run the DB test → PASS; `npm run check` → green.
- [ ] **Step 6:** Commit `feat(modules): split into ten modules (D-049)` (only this task's files).

### Task 2: Billing tables, computed state and platform RPCs

**Files:**

- Create: `supabase/migrations/20261110110000_platform_billing.sql`
- Test: `tests/db/platform-billing.test.ts`

**Interfaces:**

- Produces (tables, all RLS-enabled, no tenant grants; read/write only through the RPCs below):
  - `billing_packages(id uuid pk, name text not null, archived_at timestamptz, created_at)`; unique `name` among non-archived.
  - `billing_package_prices(package_id, valid_from date, monthly_price numeric(12,2) check >= 0, pk (package_id, valid_from))`.
  - `billing_package_modules(package_id, module_key references modules, pk)`.
  - `organization_packages(organization_id references organizations, valid_from date, package_id null = no package, pk (organization_id, valid_from))` — history of a firm's package per month.
  - `organization_billing(organization_id pk, grace_days int null check 0..90, auto_lock boolean not null default true, locked_at timestamptz, locked_reason text, unlocked_until date)`.
  - `billing_payments(organization_id, period date check (extract(day from period) = 1), paid_on date not null, note text check length <= 200, recorded_by uuid, recorded_at timestamptz default now(), pk (organization_id, period))` — a row = paid; deleting the row = "Poništi" (audit row keeps the history).
  - `platform_settings` + `payment_grace_days int not null default 15 check 0..90`, `lock_warning_days int not null default 5 check 0..30`, `lock_contact text not null default ''`.
- Produces (functions):
  - `private.billing_months(p_org uuid) returns table(period date, package_id uuid, package_name text, amount numeric, due_on date, paid_on date)` — every month from the first `organization_packages.valid_from` with a non-null package up to the current month (org tz), skipping months whose package is null; `amount` = price valid on `period` (latest `billing_package_prices.valid_from <= period`); `due_on` = last day of `period` + grace (firm's `grace_days` or platform default).
  - `private.org_lock_state(p_org uuid) returns table(state text, unpaid_period date, lock_on date, reason text)`; `state` ∈ `'trial' | 'active' | 'warning' | 'overdue' | 'locked'`; `reason` ∈ `'manual' | 'unpaid' | null`. Rules (today = current date in org tz): platform org → `active`; `locked_at` not null → `locked/manual`; earliest unpaid month with `due_on < today`: if `auto_lock` and not (`unlocked_until >= today`) → `locked/unpaid` else `overdue`; else earliest unpaid month with `due_on - today < lock_warning_days` → `warning` (`lock_on = due_on + 1`); no package ever → `trial`; else `active`.
  - `private.org_locked(p_org uuid) returns boolean` (`state = 'locked'`), `stable security definer`.
  - `private.sync_package_modules(p_org uuid)` — package modules → `org_modules` rows `enabled = true, active_until = null`; rows with `active_until is null` not in the package → `enabled = false`; trial rows (`active_until` not null) untouched; refuses (raises `22023 'module_requirement'`) when a package lacks a required module.
  - Public RPCs (each: `if not private.is_platform_admin() then raise ... 42501`; audit via `write_audit` equivalent on the target org with `before/after`):
    - `platform_billing_overview() returns table(organization_id, name, slug, package_name, monthly_price, state, last_paid_period date, member_count int, is_platform boolean, archived boolean)`
    - `platform_organization_billing(p_org_id uuid) returns jsonb` — `{organization, package, grace_days, effective_grace_days, auto_lock, locked_at, locked_reason, unlocked_until, state, months: [...billing_months + state per month], modules: [{key, source: 'package'|'trial'|'off', active_until}], history: [last 50 audit rows for billing actions]}`
    - `platform_save_package(p_id uuid null, p_name text, p_monthly_price numeric, p_modules text[]) returns uuid` — new price inserts a `billing_package_prices` row `valid_from = first day of current month (UTC)` only if the price changed; resyncs modules of firms on this package.
    - `platform_set_package_archived(p_id uuid, p_archived boolean)`
    - `platform_assign_package(p_org_id uuid, p_package_id uuid null)` — upsert `organization_packages(valid_from = first day of current month in org tz)`; `sync_package_modules`.
    - `platform_set_org_billing(p_org_id uuid, p_grace_days int null, p_auto_lock boolean)`
    - `platform_set_payment(p_org_id uuid, p_period date, p_paid boolean, p_paid_on date, p_note text)`
    - `platform_set_lock(p_org_id uuid, p_locked boolean, p_reason text)` — reason required (1..300) when locking; unlocking clears `locked_at` and sets nothing else.
    - `platform_unlock_until(p_org_id uuid, p_until date null)`
    - `platform_save_billing_settings(p_grace_days int, p_warning_days int, p_contact text)`

- [ ] **Step 1:** Write `tests/db/platform-billing.test.ts` (service role sets dates directly where time matters; the platform admin client is created like in `tests/db/company-directory.test.ts`):
  - `it("computes due dates in the organization's timezone")` — package assigned with `valid_from = 2026-10-01`, grace 15, org tz Europe/Sarajevo → October `due_on = 2026-11-15`.
  - `it("keeps the amount of earlier months when the price changes")` — price 120 valid from 2026-09-01, 150 from 2026-11-01 → September/October amount `120.00`, November `150.00`.
  - `it("warns, then locks after the due date, and unlocks when paid")` — set `valid_from` two months back and grace so that the earliest month is overdue → `org_lock_state.state = 'locked'`, `reason = 'unpaid'`; `platform_set_payment(..., true, ...)` → `state = 'active'` (or `'warning'` for the next month).
  - `it("does not lock with auto_lock off or unlocked_until in the future")` → `state = 'overdue'`.
  - `it("locks manually with a reason")` and `it("never locks the platform organization")`.
  - `it("refuses every platform RPC for a tenant admin")` → code `42501`.
  - `it("syncs modules from the package and keeps trial modules")` and `it("refuses a package with planning but without production")` → code `22023`.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Write the migration; message the other session; `db push`; regenerate types.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(platform): packages, monthly payments and computed lock state (D-049)`.

### Task 3: Enforce the lock in the database

**Files:**

- Create: `supabase/migrations/20261110120000_organization_lock.sql`
- Test: `tests/db/organization-lock.test.ts`

**Interfaces:**

- Consumes: `private.org_locked(uuid)` (Task 2).
- Produces: `private.lock_guard()` trigger function; `public.my_billing_notice(p_org_id uuid) returns jsonb` → `{state, unpaid_period, lock_on, reason, contact}` for members (`warning`/`overdue` only returned to holders of `org.settings.manage`, others get `active`); no amounts.

Trigger `lock_guard` (`before insert or update or delete ... for each row`), skipped when `auth.role()` is not `'authenticated'` (service role, migrations) **or** `private.is_platform_admin()` (platform RPCs run under the platform admin's own JWT and must reach billing tables and `org_modules` of a locked firm). Organization id = `coalesce(new.organization_id, old.organization_id)`; for `organizations` use `id`. When `private.org_locked(org)`: raise `organization_locked` (42501) unless the rule allows the operation. Rules (one `case tg_table_name` in the function; default = deny):

| Allowed always                         | Tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all ops                                | `production_reports, production_work_sessions, production_downtime_events, production_tool_changes, production_order_status_history, production_order_close_requests, production_order_operation_workers, machine_inserts, tool_movements, attendance_sessions, attendance_alerts, employee_kiosk_credentials, finished_goods_movements, delivery_notes, delivery_note_lines, stock_order_consumption, stock_reservations, stock_lots, notification_reads, audit_log, support_access_requests` |
| update only                            | `production_orders, production_order_operations, attendance_kiosks, profiles`; `machines` only when nothing but `status, status_changed_at, updated_at` changed (compare `to_jsonb(new)` and `to_jsonb(old)` without those keys)                                                                                                                                                                                                                                                               |
| when `production_order_id is not null` | `stock_documents, stock_movements`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| everything else                        | denied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Attach the trigger in a `do` block to every `public` base table that has an `organization_id` column, plus `organizations` (denied, "everything else"). Billing tables from Task 2 get it too; only the platform admin writes them, and the skip above lets them through. Later migrations that add tenant tables must attach `lock_guard` (note in D-049).

- [ ] **Step 1:** Write `tests/db/organization-lock.test.ts` with tenant A locked via `platform_set_lock` in `beforeAll` and unlocked in `afterAll`:
  - `it("refuses a new order, product, customer and stock receipt")` → each `42501` with message `organization_locked`.
  - `it("lets the operator start, report and finish an existing operation")` (Review Focus 1; reuse the order setup of `tests/db/production-reporting.test.ts`).
  - `it("issues material with a remnant for an existing order")` (`post_stock_issue`).
  - `it("receives finished goods and issues a delivery note")`.
  - `it("clocks in on the kiosk and in the app")` (`kiosk_clock` via service role as the kiosk action does, `clock_in` as the employee).
  - `it("unlocks the next write as soon as the month is paid")` (Review Focus 3: lock via unpaid month, `platform_set_payment`, then a `create_production_order` succeeds in the same client).
  - `it("does not block service-role and platform RPCs")` (Review Focus 5: `platform_set_payment` and `platform_assign_package` on the locked tenant succeed).
  - `it("refuses editing a machine but allows its status change")` and `it("refuses changing a member's role")`.
  - `it("tells only settings managers about the warning")` (`my_billing_notice`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write the migration; message the other session; `db push`; regenerate types.
- [ ] **Step 4:** Run this file and the full `npm run test:db` (coordinated) → PASS (the lock is off for every other test tenant).
- [ ] **Step 5:** Commit `feat(platform): lock unpaid organizations in the database (D-049)`.

### Task 4: Locked access and banner in the app

**Files:**

- Create: `src/modules/platform/lock-rules.ts`, `src/modules/platform/lock-rules.test.ts`, `src/components/shared/billing-notice.tsx`
- Modify: `src/lib/auth/access.ts`, `src/app/(app)/layout.tsx`, `src/app/(floor)/layout.tsx`, `src/app/(app)/orders/page.tsx` (hide "Novi nalog" / copy when locked), `messages/bs.json` (`billingNotice.*`)

**Interfaces:**

- Consumes: `my_billing_notice` (Task 3).
- Produces: `MemberAccess` gains `locked: boolean` and `notice: BillingNotice`; `type BillingNotice = { state: "active" | "warning" | "overdue" | "locked" | "trial"; unpaidPeriod: string | null; lockOn: string | null; reason: "manual" | "unpaid" | null; contact: string }`; `export const LOCKED_KEEPS: ReadonlySet<PermissionKey>` and `export function lockedPermissions(perms: ReadonlySet<string>): Set<string>` in `lock-rules.ts`.

`LOCKED_KEEPS` = every `*.read` permission plus `orders.manage, orders.material.update, orders.close.approve, quality.inspect, machines.status.update, inventory.move, finished_goods.manage, support.approve`.

- [ ] **Step 1:** `lock-rules.test.ts`: `it("keeps read permissions and the work-in-progress ones")` (input with `orders.read, orders.manage, products.manage, users.manage, inventory.move` → output `orders.read, orders.manage, inventory.move`); `it("drops everything that creates master data")`.
- [ ] **Step 2:** Run `npx vitest run src/modules/platform/lock-rules.test.ts` → FAIL; implement; → PASS.
- [ ] **Step 3:** `getMemberAccess` calls `my_billing_notice` in the same `Promise.all`, parses it with Zod, and when `state === "locked"` returns `permissions: lockedPermissions(...)`, `locked: true`.
- [ ] **Step 4:** `BillingNotice` banner (server component) in both layouts: `locked` → destructive strip "Firma je zaključana: {razlog}. Možete pregledati podatke, koristiti kiosk i završiti započete naloge. Kontakt: {contact}"; `warning` → amber strip "Uplata za {mjesec} nije evidentirana. Zaključavanje {datum}." (exact copy in `bs.json` `billingNotice.locked.manual|unpaid`, `billingNotice.warning`, `billingNotice.overdue`). Mobile: one line, wraps; no layout shift on floor screens.
- [ ] **Step 5:** `npm run check` → green. Commit `feat(platform): locked access and billing notice (D-049)`.

### Task 5: Platform list and firm detail

**Files:**

- Modify: `src/app/(app)/platform/page.tsx`, `src/modules/platform/queries.ts`, `src/modules/platform/actions.ts`, `src/modules/platform/schemas.ts`, `messages/bs.json` (`platform.*`)
- Create: `src/app/(app)/platform/organizations/[id]/page.tsx`, `.../package-card.tsx`, `.../payments-table.tsx`, `.../lock-controls.tsx`, `src/modules/platform/schemas.test.ts` (or extend existing)
- Remove from use: inline `module-editor.tsx` on the list (keep it for "Dodaj kao probu…" on the detail page)

**Interfaces:**

- Consumes: Task 2 RPCs.
- Produces: `listBillingOverview(): Promise<BillingOverviewRow[]>`, `getOrganizationBilling(id: string): Promise<OrganizationBilling | null>`; actions `assignPackageAction(input)`, `setOrgBillingAction(input)`, `setPaymentAction(input)`, `setLockAction(input)`, `unlockUntilAction(input)` — each `requireMember` + `permitAction(org, "platform.manage")`, Zod schema in `schemas.ts`, returns `{ ok: true } | { ok: false; error: "invalid" | "denied" | "unexpected" | "reason_required" | "module_requirement" }`, `revalidatePath("/platform", "layout")`.

UI per mockup A and B: list with filter chips (Sve / Upozorenje+Kasni / Zaključane / Proba — counts) and search by name/slug, row → `/platform/organizations/[id]`; detail with state banner, header, Zaključaj (sheet with required reason) / Otključaj, "Otključaj do…" (date) shown when state is `locked/unpaid`, Paket card (select of non-archived packages, firm grace days or "iz postavki", auto-lock switch), Moduli card (source badges, "Dodaj kao probu…" via existing `setOrganizationModuleAction`), Plaćanja table (newest first; "Označi plaćeno" sheet with date default today + note; "Poništi" with `ConfirmDialog`), Historija list. Loading / empty / error / denied states as elsewhere. Optimistic update for "Označi plaćeno" (D-042 rule: confirmation toast only after the server answers).

- [ ] **Step 1:** Schema tests in `schemas.test.ts`: `setPaymentSchema` rejects a period not on day 1 and a note over 200 chars; `setLockSchema` requires a reason of 1..300 chars when `locked = true`.
- [ ] **Step 2:** Run → FAIL; implement schemas → PASS.
- [ ] **Step 3:** Queries, actions, pages per above.
- [ ] **Step 4:** `npm run check` → green. Commit `feat(platform): firm list and firm detail with payments (D-049)`.

### Task 6: Packages and billing settings

**Files:**

- Modify: `src/app/(app)/platform/settings/page.tsx`, `src/modules/platform/{queries,actions,schemas}.ts`, `messages/bs.json`
- Create: `src/app/(app)/platform/settings/packages-card.tsx`, `.../package-sheet.tsx`, `.../billing-settings-form.tsx`

**Interfaces:**

- Consumes: `platform_save_package`, `platform_set_package_archived`, `platform_save_billing_settings`, `platform_get_settings` (extend to return the three new fields).
- Produces: `savePackageAction(id: string | null, input)`, `setPackageArchivedAction(id, archived)`, `saveBillingSettingsAction(input)`.

Package sheet: name (1..80), monthly price (KM, `parseDecimal(.., 2)`, ≥ 0), module checkboxes for the 10 keys (`core` checked and disabled); checking a module with a requirement checks the required one; unchecking a required module unchecks its dependants (`module_dependencies` read via `listModules()` query). Archived packages listed greyed with "Vrati".

- [ ] **Step 1:** Schema tests: `packageSchema` rejects a negative price and a name over 80; `billingSettingsSchema` accepts grace 0..90, warning 0..30.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** UI per mockup C.
- [ ] **Step 4:** `npm run check` → green. Commit `feat(platform): packages and billing settings (D-049)`.

### Task 7: End-to-end check, docs

**Files:**

- Create: `e2e/platform-billing.spec.ts`
- Modify: `docs/DECISIONS.md` (D-049), `docs/STATUS.md`

- [ ] **Step 1:** E2E (desktop): platform admin creates package "E2E paket" (production + planning), assigns it to a test tenant, locks it with a reason → tenant admin sees the locked banner and no "Novi nalog"; platform admin unlocks → banner gone. Clean up in `finally` (unlock, unassign, archive package). (Mobile): locked tenant's operator still sees "Počni rad" on an existing operation.
- [ ] **Step 2:** Coordinate with the other session; run `npm run e2e` → new spec green, no new failures elsewhere.
- [ ] **Step 3:** Append D-049 (modules, packages, computed lock, trigger rules, LOCKED_KEEPS, defaults) and a STATUS log entry; run `npm run format:check`, `npm run check`, `npm run build`.
- [ ] **Step 4:** Commit `docs: platform billing and organization lock (D-049)`; ask the user before pushing.
