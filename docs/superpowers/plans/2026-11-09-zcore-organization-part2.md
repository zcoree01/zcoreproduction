# Zcore firma, dio 2 — početna strana platforme — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zcore firma dobija svoju fiksnu početnu stranu (`/dashboard`) po odobrenom rasporedu A: četiri broja, "Za riješiti", stanje firmi, prihod po mjesecima i tabela firmi koje kasne; Tehničar ne vidi prihod.

**Architecture:** Jedan RPC `public.platform_home()` (SECURITY DEFINER, `platform.read`) vraća sve brojeve kao jsonb u vremenskoj zoni platforme; dio o prihodu (`revenue`) je `null` bez `platform.revenue.read`. Server komponenta na `/dashboard` (samo u firmi s modulom `platform`) čita ga preko `getPlatformHome()` (Zod) i crta kartice; grafikoni su mali SVG bez nove biblioteke.

**Tech Stack:** Next.js 16 App Router (server components), Supabase Postgres RPC, Zod, next-intl, shadcn `Card`, lucide-react, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-zcore-organization-design.md` — dio 2 (kartice označene "dio 3" nisu u ovom planu; brzina stranica je izbačena, vlasnik 2026-11-09). Odobrena skica: `.superpowers/brainstorm/1404-1794236632/content/platform-home-v2.html` (raspored A).

## Global Constraints

- Migracija s timestampom većim od `20261110230000`; nikad ne mijenjati primijenjenu.
- `platform_home()` zahtijeva `platform.read` (`private.require_platform_permission`); `revenue` je `null` kad pozivalac nema `platform.revenue.read` — Tehničar ga ne dobija ni preko API-ja.
- Brojevi isključuju Zcore firmu (`is_platform`) i arhivirane firme (`archived_at is not null`); korisnici isključuju support naloge (`profiles.is_support`) i arhivirane članarine.
- Mjeseci i "danas" u vremenskoj zoni platformske firme (`private.org_today(private.platform_org_id())`).
- Prihod iz `platform_payment_records` (samo `cancelled_at is null`), po `period` (pretplata za taj mjesec, D-050 odluka vlasnika).
- Novac kao `numeric` → string u TS (`src/lib/decimal.ts`), nikad float; prikaz "4.350 KM" (bs format).
- Bez lažnih brojeva: kartice dijela 3 (prijave, korištenje) se ne prikazuju.
- UI tekstovi samo kroz `messages/bs.json` (ključevi bez tačke); ikone `lucide-react` mirne, kao u meniju — bez emojija i šarenih kvadrata; kartice shadcn `Card` kao na dashboardu firmi.
- Grafikoni: prije pisanja učitaj skill `dataviz`; jednostavan SVG, čitljiv u svijetloj i tamnoj temi, s tekstualnom alternativom (`aria-label` / skrivena tabela).

## Review Focus

1. Nema nijedne firme s paketom / očekivano = 0 → traka napretka 0 %, bez dijeljenja nulom, kartice s praznim stanjem. Test u Task 2.
2. Poništena uplata se ne broji u prihod. Test u Task 1.
3. Arhivirana firma i Zcore firma se ne broje nigdje (firme, korisnici, kasne, očekivano). Test u Task 1.
4. Granica mjeseca po Europe/Sarajevo (uplata za prošli mjesec ne ulazi u "ovaj mjesec"). Test u Task 1.
5. Tehničar direktno zove RPC → `revenue === null`, a sve ostalo dobija. Test u Task 1.

---

### Task 1: RPC `platform_home()`

**Files:**

- Create: `supabase/migrations/20261110240000_platform_home.sql`
- Create: `tests/db/platform-home.test.ts`
- Regenerate: `src/lib/supabase/types.ts`

**Interfaces:**

- Produces: `public.platform_home() returns jsonb`, grant `authenticated`, revoke `public, anon`. Oblik:

```json
{
  "today": "2026-11-09",
  "firms": {
    "using": 14,
    "using_last_month": 12,
    "trial": 3,
    "active": 11,
    "warning": 3,
    "overdue": 0,
    "locked": 1
  },
  "users": 412,
  "todo": {
    "directory_requests": 4,
    "support_pending": 1,
    "trials_ending": 2,
    "deletions_scheduled": 1
  },
  "overdue": [
    {
      "organization_id": "…",
      "name": "…",
      "package_name": "…",
      "period": "2026-10-01",
      "amount": "450.00",
      "days_late": 9,
      "state": "locked"
    }
  ],
  "revenue": {
    "paid": "4350.00",
    "expected": "5200.00",
    "overdue_total": "1250.00",
    "by_month": [{ "period": "2025-12-01", "paid": "…" }]
  }
}
```

- `firms.using` = ne-arhivirane ne-platformske firme koje za tekući mjesec imaju paket (`private.org_package_on`); `using_last_month` isto za prošli mjesec; `trial/active/warning/overdue/locked` = brojevi po `private.org_lock_state(...).state` za ne-arhivirane ne-platformske firme.
- `todo.directory_requests` = broj redova koje vraća postojeći `public.company_change_requests_to_decide(<platform org id>)` (isti skup kao `/platform/requests`); `support_pending` = `support_access_requests.status = 'pending'`; `trials_ending` = broj različitih firmi s `org_modules.enabled` i `active_until` između danas i danas + 7; `deletions_scheduled` = firme s `delete_after is not null`.
- `overdue` = firme u stanju `overdue` ili `locked` s razlogom `unpaid`, najstariji neplaćen dospjeli mjesec iz `private.billing_months` (`period`, `amount`, `days_late = danas − due_on`), sortirano po `days_late` opadajuće.
- `revenue.by_month` = tačno 12 mjeseci, od tekućeg − 11 do tekućeg, svaki mjesec prisutan (0 kad nema uplata); `overdue_total` = zbir `amount` iz `overdue`.

- [ ] **Step 1: Failing tests** u `tests/db/platform-home.test.ts` (korisnici `platform_admin` i `platform_technician` u Zcore firmi kao u `tests/db/platform-roles.test.ts`; fiksture tenant B / privremena firma `dbt-reg-home-<rand>` brisana `purge_test_organization`; uplate i paketi kao u `tests/db/platform-billing.test.ts`; mjeseci preko `tests/db/months.ts`; per-firm `organization_billing.prepaid_since`, nikad `platform_settings`):
  - `"returns the counts for the Administrator with revenue"`: `revenue.paid` uključuje uplatu tenant B za tekući mjesec; `by_month` ima 12 stavki, zadnja = tekući mjesec.
  - `"hides revenue from the Tehničar"`: `revenue === null`, `firms` i `todo` prisutni.
  - `"refuses a tenant admin"`: `error.code === "42501"`.
  - `"ignores cancelled payments and last month's payment in this month"` (Review Focus 2, 4).
  - `"leaves out archived firms and the Zcore organization"` (Review Focus 3): arhivirana privremena firma s paketom ne mijenja `firms.using`, `users` ni `revenue.expected`.
  - `"lists an unpaid due month in overdue with days late"`.
- [ ] **Step 2:** `npx vitest run --config vitest.db.config.mts tests/db/platform-home.test.ts` → FAIL (funkcija ne postoji).
- [ ] **Step 3:** migracija; `npx supabase db push`; regeneriši tipove.
- [ ] **Step 4:** isti test → PASS; `platform-billing`, `platform-roles` → PASS.
- [ ] **Step 5: Commit** `feat(platform): platform_home RPC for the Zcore home page`

### Task 2: Upit i pomoćne funkcije u TS

**Files:**

- Create: `src/modules/platform/home-queries.ts`, `src/modules/platform/home.ts`, `src/modules/platform/home.test.ts`

**Interfaces:**

- Consumes: `platform_home()` (Task 1).
- Produces:
  - `platformHomeSchema` (Zod, u `home.ts`) i `type PlatformHome = z.infer<typeof platformHomeSchema>`; iznosi ostaju stringovi.
  - `getPlatformHome(): Promise<PlatformHome>` u `home-queries.ts` (`server-only`, RPC + parse, greška se baca).
  - `revenueProgress(paid: string, expected: string): number` — cijeli procenat 0–100 (zaokružen naniže, ograničen na 100; `expected` "0" → 0).
  - `firmTrend(now: number, lastMonth: number): { delta: number; direction: "up" | "down" | "same" }`.
  - `stateSlices(firms: PlatformHome["firms"]): { key: "active" | "trial" | "warning" | "overdue" | "locked"; value: number }[]` — bez nula, redoslijed active, trial, warning, overdue, locked.

- [ ] **Step 1: Failing tests** `home.test.ts`: `revenueProgress("4350.00","5200.00") === 83`, `revenueProgress("10","0") === 0`, `revenueProgress("6000","5200") === 100` (Review Focus 1); `firmTrend(14,12)` → `{ delta: 2, direction: "up" }`, `firmTrend(5,5).direction === "same"`; `stateSlices` izbacuje nule i drži redoslijed; `platformHomeSchema.parse` prihvata primjer iz Task 1 i `revenue: null`.
- [ ] **Step 2:** `npm run check` → FAIL.
- [ ] **Step 3:** implementacija (decimale preko `src/lib/decimal.ts`).
- [ ] **Step 4:** `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(platform): platform home query and helpers`

### Task 3: Početna strana Zcore firme

**Files:**

- Modify: `src/app/(app)/dashboard/page.tsx` (umjesto `redirect("/platform")` renderuj `PlatformHome`)
- Create: `src/app/(app)/dashboard/platform-home/platform-home.tsx`, `kpi-cards.tsx`, `todo-tiles.tsx`, `firm-states.tsx`, `revenue-chart.tsx`, `overdue-table.tsx`
- Modify: `messages/bs.json` (namespace `platformHome`)
- Create: `e2e/platform-home.spec.ts`

**Interfaces:**

- Consumes: `getPlatformHome`, `revenueProgress`, `firmTrend`, `stateSlices` (Task 2); `getMemberAccess(member).permissions.has("platform.revenue.read")` za prikaz (podaci su ionako `null` bez dozvole).

Raspored (skica A, mreža 12 kolona na `xl`, jedna kolona na telefonu):

1. Red od četiri kartice: Prihod ovaj mjesec (iznos, "od <očekivano> KM očekivano", traka `revenueProgress`) — samo s prihodom; Firme koje koriste (`firms.using`, trend, "<trial> u probi"); Korisnici (`users`); Kasne s uplatom (broj firmi iz `overdue`, `revenue.overdue_total` samo Administratoru, broj zaključanih). Bez prihoda red ima tri kartice.
2. "Za riješiti": četiri pločice (Zahtjevi za imenik → `/platform/requests`; Podrška na čekanju → `/platform`; Probe ističu (7 dana) → `/platform?filter=trial`; Zakazane za brisanje → `/platform?filter=archived`), svaka s brojem i "Otvori →"; pored nje "Stanje firmi" (SVG prsten iz `stateSlices` + legenda s brojevima).
3. "Prihod po mjesecima" (12 stubaca, tekući mjesec svjetliji, oznake mjeseci, vrijednost u tooltipu/`title` i u skrivenoj tabeli) — samo s prihodom.
4. "Firme koje kasne s uplatom" — tabela: firma (link `/platform/organizations/<id>`), paket, mjesec, iznos, kasni (dana), stanje (`BillingStateBadge`); prazno stanje "Nijedna firma ne kasni s uplatom".
   Ikone (lucide): `Wallet`, `Building2`, `Users`, `Clock`, `Inbox`, `LifeBuoy`, `Hourglass`, `Trash2`.

- [ ] **Step 1: Failing e2e** `e2e/platform-home.spec.ts`: `"Administrator sees revenue, firm states and the to-do tiles"` (prijava kao Zcore `platform_admin`, `/dashboard` ostaje na `/dashboard`, vidljivi naslovi "Prihod ovaj mjesec", "Stanje firmi", "Za riješiti", "Firme koje kasne s uplatom"; klik na "Zahtjevi za imenik" vodi na `/platform/requests`) i `"Tehničar sees no revenue"` (nema "Prihod ovaj mjesec" ni "Prihod po mjesecima", ima "Za riješiti"). Korisnike napraviti kao u `e2e/platform-archive.spec.ts`.
- [ ] **Step 2:** `npx playwright test e2e/platform-home.spec.ts` → FAIL.
- [ ] **Step 3:** implementacija (loading kroz postojeći `PageSuspense`, greška kroz `ErrorState`); učitaj skill `dataviz` prije grafikona.
- [ ] **Step 4:** `npm run check`, `npx playwright test e2e/platform-home.spec.ts e2e/platform.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(platform): Zcore home page with revenue, firm states and to-dos`

### Task 4: Dokumentacija i provjere

**Files:** `docs/DECISIONS.md` (D-050 dopuna: početna strana, definicije brojeva), `docs/STATUS.md` (Implemented, Next step: dio 3 bez brzine stranica + grafikon korištenja, Docker test baza), spec status (dio 2 urađen).

- [ ] **Step 1:** `npm run check`, cijeli `npm run test:db`, `npx playwright test e2e/platform*.spec.ts`, `npm run build` → zeleno (stvarni brojevi u izvještaju).
- [ ] **Step 2: Commit** `docs: Zcore organization part 2 (platform home)`. Bez push-a dok vlasnik ne kaže.
