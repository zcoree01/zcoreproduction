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
