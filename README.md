# Zcore Production

Multi-tenant manufacturing ERP for CNC / metalworking SMEs.

- Product context: [docs/ZCORE_CONTEXT.md](docs/ZCORE_CONTEXT.md)
- Working rules: [CLAUDE.md](CLAUDE.md)
- Progress: [docs/STATUS.md](docs/STATUS.md) · Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)

## Setup

```bash
npm ci
cp .env.example .env.local   # fill in Supabase URL, anon key, service-role key
npm run dev
```

## Commands

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | local app on http://localhost:3000                     |
| `npm run check`     | typecheck + lint + unit tests                          |
| `npm run e2e`       | Playwright smoke tests                                 |
| `npm run test:db`   | RLS / tenant-isolation tests (linked Supabase project) |
| `npm run seed:demo` | create/refresh the `demo` organization and users       |
| `npm run db:types`  | regenerate `src/lib/supabase/types.ts`                 |
| `npm run format`    | Prettier on the whole repo                             |
