---
description: Run all checks and fix failures until green
---

Run every project check and fix what fails.

1. `npm run format:check` — if it fails, run `npm run format`.
2. `npm run test:db` if `.env.local` has Supabase keys (RLS / tenant-isolation tests against the linked project).
3. `npm run check` (typecheck + lint + unit tests).
4. `npm run e2e` if Playwright browsers are installed (`npx playwright install chromium` otherwise; ask before installing).
5. `npm run build` to catch build-only errors.

For every failure: find the root cause and fix the code. Do **not** weaken, skip or delete tests, add `any`, add `eslint-disable`, or loosen tsconfig to make a check pass. If a fix would change behaviour or architecture, stop and ask.

Repeat until everything is green, then report (in Bosnian) each command, its actual result, and what you changed. Do not commit unless I ask.
