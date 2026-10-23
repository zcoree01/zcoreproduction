# Zcore Production — Claude Code Guide

Full product context: `docs/ZCORE_CONTEXT.md` (read it before any new module).
Progress log: `docs/STATUS.md` (read at session start, update at session end).
Decisions: `docs/DECISIONS.md` (append when an architectural decision is made).

## What this is
Multi-tenant manufacturing ERP for CNC / metalworking SMEs (5–250 employees).
Worker UI = mobile-first (phones/tablets, big touch targets, minimal typing).
Management UI = desktop-first (dense tables, filters, planning).
UI language: Bosnian (all strings via i18n keys in `messages/bs.json`). Code, identifiers, commits: English.
Talk to the user in Bosnian.

## Stack (do not change without asking)
- Next.js (App Router) + TypeScript strict, no `any`
- Tailwind CSS + shadcn/ui
- Supabase: Postgres, Auth, Storage, RLS
- Zod for every input boundary (forms, server actions, route handlers)
- Vitest (unit/domain), Playwright (e2e smoke)
- Supabase CLI migrations in `supabase/migrations/` — never edit an applied migration
- Deploy: Vercel (auto from GitHub `main`), preview deploy per PR

## Folder layout
```
src/app/(auth)/            login
src/app/(app)/             management (desktop)
src/app/(floor)/           worker screens (mobile)
src/modules/<module>/      domain logic, server actions, queries, schemas, tests
src/components/ui/         shadcn components
src/components/shared/     reusable app components (DataTable, StatusBadge, EmptyState…)
src/lib/supabase/          server + browser clients (service-role ONLY server-side)
src/lib/auth/              session, permission checks
supabase/migrations/       SQL migrations
supabase/seed.sql          demo data for one test company
```
Business logic lives in `src/modules/*`, never inside React components.

## Non-negotiable rules
1. Every tenant table has `organization_id uuid not null` + RLS policy using membership check. No exceptions.
2. Permission check on the server for every mutation (helper `requirePermission(org, 'perm.key')`). Hidden buttons are not security.
3. Inventory = movement ledger. Balances are derived; never `update stock set qty = …`.
4. Good qty and scrap qty are separate. Only good qty enters finished goods. Material consumption includes scrap.
5. Machine output ≠ worker hours. Teams must not double-count either.
6. Production reports and stock movements carry an idempotency key (unique constraint).
7. Multi-step writes go through a Postgres function (RPC) or a transaction — no partial writes.
8. Archive (`archived_at`), don't delete, business records.
9. Audit log row for important actions (who, what, when, before/after).
10. Timestamps `timestamptz` in UTC, displayed in org timezone (default Europe/Sarajevo).
11. Quantities/money: `numeric`, explicit units. No floats for stock or cost.
12. Shifts, breaks, downtime reasons, thresholds = configurable per org, not hardcoded.

## Auth model
- Users log in with **username + password** (workers often have no e-mail).
- Implementation: Supabase Auth with synthetic e-mail `<username>@<org-slug>.users.zcore.ba`; UI only ever shows username.
- Tenant resolved from subdomain (`<slug>.zcore.ba`); in local dev use `?org=<slug>` or `<slug>.localhost:3000`.
- Roles (seeded per org, permissions granular): admin, director, head_of_production, warehouse, operator.

## Every feature = this loop
1. Read STATUS.md + relevant code/schema. Never invent tables or files.
2. Short plan (files, migration, permissions, tests). Wait for OK only if it changes architecture or schema of existing data.
3. Migration → RLS → domain logic + Zod → server action → UI (loading/empty/error/denied states) → tests.
4. Run `npm run check` (typecheck + lint + unit tests). Fix until green.
5. Update `docs/STATUS.md`. Commit with a clear message. Do not push/deploy unless asked.
6. Report: what changed, checks actually run + results, limitations, next step.

## Commands
- `npm run dev` — local app
- `npm run check` — typecheck + lint + test (must pass before commit)
- `npm run e2e` — Playwright smoke
- `npx supabase db push` — apply migrations to linked project
- `npx supabase gen types typescript --linked > src/lib/supabase/types.ts` — regenerate DB types after every migration

## Never
- Expose `SUPABASE_SERVICE_ROLE_KEY` to the browser or a `NEXT_PUBLIC_` var
- Reset the database, rewrite migration history, or delete data without explicit permission
- Leave fake buttons or static data pretending to be real
- Weaken or skip tests to make checks pass
