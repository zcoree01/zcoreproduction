---
description: Implement a feature following the CLAUDE.md feature loop
argument-hint: <feature description>
---

Implement this feature: **$ARGUMENTS**

Follow the "Every feature = this loop" section of CLAUDE.md exactly. Do not skip steps.

1. **Understand.** Read `docs/STATUS.md`, `docs/DECISIONS.md`, the relevant part of `docs/ZCORE_CONTEXT.md`, and the existing code and migrations this feature touches. Never invent tables, files, endpoints or env vars — verify they exist.
2. **Plan.** Write a short plan: files to add/change, migration, RLS policies, permission keys, Zod schemas, UI states, tests. If it changes architecture or the schema of existing data, stop and wait for my OK. Otherwise state assumptions and continue.
3. **Build, in this order:**
   - Migration in `supabase/migrations/` (new file; never edit an applied one) with `organization_id`, RLS, constraints, indexes, `archived_at`, idempotency keys where duplicates are possible.
   - Regenerate types if a project is linked: `npx supabase gen types typescript --linked > src/lib/supabase/types.ts`.
   - Domain logic + Zod schemas in `src/modules/<module>/` (no business logic in React components).
   - Server actions with `requirePermission(...)` on every mutation; multi-step writes via RPC/transaction; audit log for important actions.
   - UI: all strings via `messages/bs.json`; loading, empty, error and permission-denied states. Mobile-first for `(floor)`, desktop-first for `(app)`.
   - Tests: Vitest for domain rules (quantities, scrap, ledger, permissions, edge cases).
4. **Verify.** Run `npm run check` and fix until green. Never weaken or skip tests.
5. **Record.** Update `docs/STATUS.md`; append to `docs/DECISIONS.md` if an architectural decision was made. Commit with a clear English message. Do not push or deploy.
6. **Report** (in Bosnian): what changed, which checks actually ran and their results, limitations, suggested next step.
