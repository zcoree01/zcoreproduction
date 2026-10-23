# Status

Progress log. Read at session start, update at session end. Newest entry on top.

## Current phase

**Phase 1 — Foundation** (see `ZCORE_CONTEXT.md` §14). Project skeleton is in place; no business features yet.

## Implemented

- Next.js 16 (App Router, TypeScript strict + `noUncheckedIndexedAccess`), Tailwind CSS 4, shadcn/ui (base-nova, `Button` only).
- i18n via `next-intl`, single locale `bs`, no locale in URL. Messages in `messages/bs.json`, typed through `src/types/next-intl.d.ts`. Default timezone `Europe/Sarajevo`.
- Zod-validated public env (`src/lib/env.ts`); Supabase browser + server clients (`src/lib/supabase/`). No Supabase project linked yet.
- Supabase CLI initialised (`supabase/config.toml`), empty `supabase/migrations/` and `supabase/seed.sql`.
- Tooling: ESLint (next + prettier), Prettier (+ tailwind plugin), Vitest, Playwright (desktop + mobile Chromium).
- `npm run check` = typecheck + lint + unit tests. GitHub Actions runs `check` + `build` on every push/PR.
- Playwright smoke test (`e2e/smoke.spec.ts`) passes on desktop + mobile Chromium.
- Claude Code: Prettier hook after every Write/Edit; slash commands `/feature`, `/verify`, `/status`.

## Not done yet / known gaps

- No Supabase project linked → no `src/lib/supabase/types.ts`, no migrations applied.
- No `proxy.ts` (Next 16 replacement for middleware) yet: needed for session refresh and tenant resolution from subdomain / `?org=`.
- No auth, organizations, memberships, roles/permissions, `requirePermission`, audit log.
- Route groups `(auth)`, `(app)`, `(floor)` are empty placeholders.
- Playwright browsers must be installed locally once: `npx playwright install chromium`.

## Next step

Foundation data model: migration for `organizations`, `memberships`, `roles`, `permissions`, `audit_log` with RLS; then username login (synthetic e-mail), `proxy.ts` tenant resolution, `requirePermission`.

## Log

### 2026-10-23 — Project skeleton

- Scaffolded the app and tooling described above. Verified: `npm run check` (4 unit tests), `npm run build`, `npm run e2e` (2 tests) all green.
