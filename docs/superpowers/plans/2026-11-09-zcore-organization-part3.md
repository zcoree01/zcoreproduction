# Zcore firma, dio 3 — prijave problema, zakazana podrška, korištenje — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Korisnici firmi prijavljuju problem iz gornje trake ("?"), Zcore odgovara ili zakazuje ulazak u firmu (zakazani zahtjev za pristup koji odobrava admin/direktor firme), platforma bilježi aktivne korisnike po danu, a početna Zcore firme dobija kartice prijava i korištenja; zahtjevi za pristup podrške dobijaju svoju listu.

**Architecture:** Nove tenant tabele (`problem_reports`, `problem_report_messages`, `problem_report_files`, `member_activity_days`) s RLS i `lock_guard` (prijave dozvoljene i u zaključanoj firmi); svi upisi kroz RPC. `support_access_requests` dobija `scheduled_start` i `problem_report_id`; odobrenje zakazanog zahtjeva otvara prozor od zakazanog početka. Zcore strana čita kroz `platform_*` RPC-ove (nova dozvola `platform.reports.manage`), `platform_home()` se proširuje brojevima prijava i korištenja.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres RPC, RLS, Storage signed URLs), Zod, next-intl, shadcn (Sheet, Card, Tabs), lucide-react, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-zcore-organization-design.md` — dio 3. Izmjene vlasnika 2026-11-09: **brzina stranica se ne pravi** (ni mjerenje ni kartica; kategorija "Sporo radi" ostaje bez izmjerenog vremena); grafikon korištenja i "aktivni 7 dana" se prave; pločica "Podrška na čekanju" vodi na listu svih zahtjeva za pristup (kartica "Pristup podrške" na stranici Prijave).

## Global Constraints

- Migracije s timestampom većim od `20261110240000`; nikad ne mijenjati primijenjenu.
- Svaka nova tabela s `organization_id`: RLS, composite tenant FK gdje postoji `(organization_id, id)`, `lock_guard` trigger; `lock_guard` (zadnja definicija u `20261110140000_lock_review_fixes.sql`) dozvoljava upise u `problem_reports`, `problem_report_messages`, `problem_report_files`, `member_activity_days` i dok je firma zaključana (spec: zaključana firma može slati prijave i odobravati zakazanu sesiju). Arhivirana firma ne može ništa (već presječeno kroz `private.user_org_ids`).
- Kategorije (tačne vrijednosti): `broken` (Nešto ne radi), `slow` (Sporo radi), `howto` (Ne znam kako da…), `idea` (Prijedlog), `billing` (Paket i plaćanje), `other` (Ostalo). Opis obavezan za `other`, inače opcionalan; max 4000 znakova.
- Stanja prijave: `new` (Nova) → `in_progress` (U obradi) → `waiting_user` (Čeka korisnika) → `resolved` (Riješena). Odgovor korisnika na `waiting_user` ili `resolved` vraća u `in_progress`.
- Automatski kontekst prijave: stranica (`page_path`, bez query stringa), firma, korisnik, vrijeme (server), uređaj (`user_agent`, max 500). Bez mjerenja brzine.
- Prijavu šalje svaki član firme koja nije Zcore (bez posebne dozvole); vidi samo svoje prijave ("Moje prijave"). Zcore: čitanje `platform.read`, odgovori / stanja / zakazivanje `platform.reports.manage` (nova dozvola, Administrator i Tehničar); zakazivanje dodatno `platform.support`.
- Zakazana sesija: Zcore bira početak (≥ sada), trajanje 15–480 min i razlog; nastaje `support_access_requests` sa `status = 'pending'`, `scheduled_start`, `duration_minutes`, `problem_report_id`. Odobrava admin/direktor firme (`support.approve`) bilo kada prije kraja termina; `approved_until = scheduled_start + duration`; "Uđi u firmu" radi tek od `scheduled_start`. Termin kojem je prošao kraj, a nije odobren, ističe (`cancelled`); odobren/aktivan s prošlim krajem → `ended`.
- Prijavljivač dobija obavještenje kad stigne odgovor Zcore-a i kad je sesija predložena / odobrena / odbijena; Zcore dobija obavještenje za novu prijavu i odgovor korisnika. Samo u aplikaciji (zvono / tačka na "?"), bez e-maila.
- Slike ekrana: privatni bucket `problem-report-files` (PNG/JPG/WEBP, 10 MB), putanja `<organization_id>/<report_id>/<file_id>`; upload kroz potpisani URL (obrazac iz `src/modules/products/actions.ts`); bucket se dodaje u `ORGANIZATION_BUCKETS` u `src/modules/platform/purge.ts`.
- Korištenje: jedan red po (firma, korisnik, dan u vremenskoj zoni firme) u `member_activity_days`; bilježi se pri učitavanju stranice aplikacije ili pogona (ne u Zcore firmi, ne za support naloge); "aktivni 7 dana" = različiti korisnici zadnjih 7 dana uključujući danas; grafikon = 30 dana, svaki dan prisutan.
- UI tekstovi kroz `messages/bs.json` (bez tačke u ključu, ICU množina); lucide ikone mirne kao u meniju; shadcn komponente; grafikoni po skillu `dataviz` (kao `src/app/(app)/dashboard/platform-home/revenue-chart.tsx`: HTML oznake, telefon kraći raspon).
- Mobilni pogon: velika dugmad (≥ 48 px), prijava na cijelom ekranu.

## Review Focus

1. Dvostruki klik / slaba mreža pri slanju prijave → jedna prijava (idempotency key). Test u Task 1.
2. Korisnik firme A pokuša čitati prijavu ili sliku firme B, ili tuđu prijavu iste firme → odbijeno. Test u Task 1.
3. Zcore zakaže sesiju za firmu koja već ima otvoren zahtjev za pristup → jasna greška `support_open` (ne pad). Test u Task 2.
4. Admin firme odobri zakazanu sesiju prije početka → Zcore ne može ući prije `scheduled_start`, može poslije. Test u Task 2.
5. Prijava iz zaključane firme prolazi; iz arhivirane ne. Test u Task 1.

---

### Task 1: Prijave problema — baza

**Files:**

- Create: `supabase/migrations/20261110250000_problem_reports.sql`, `tests/db/problem-reports.test.ts`
- Regenerate: `src/lib/supabase/types.ts`

**Interfaces:**

- Produces tabele: `problem_reports (id, organization_id, created_by uuid, category text, description text, page_path text, user_agent text, status text default 'new', idempotency_key uuid unique, created_at, updated_at, resolved_at, last_message_at)`, `problem_report_messages (id, organization_id, report_id, author_id uuid, from_zcore boolean, body text 1–4000, created_at)`, `problem_report_files (id, organization_id, report_id, storage_path, mime_type, size_bytes, created_by, created_at)`. RLS select: vlastite prijave (`created_by = auth.uid()`) i njihove poruke / fajlovi, uz `private.user_org_ids()`; nema direktnog insert/update.
- Produces dozvolu `platform.reports.manage` (modul `platform`, `default_roles {platform_admin, platform_technician}`, dodijeljena objema ulogama Zcore firme; dodati u `PERMISSION_KEYS` u `src/lib/auth/permissions.ts`).
- Produces RPC-ove (SECURITY DEFINER, `search_path ''`):
  - `submit_problem_report(p_org uuid, p_category text, p_description text, p_page_path text, p_user_agent text, p_idempotency_key uuid) returns uuid` — član firme (ne platformske); isti ključ vraća postojeći id.
  - `reply_problem_report(p_org uuid, p_report_id uuid, p_body text) returns uuid` — samo autor prijave; vraća stanje u `in_progress` ako je bilo `waiting_user`/`resolved`.
  - `register_problem_report_file(p_org uuid, p_report_id uuid, p_path text, p_mime text, p_size bigint) returns uuid` — autor; putanja mora počinjati s `<org>/<report>/`.
  - `platform_problem_reports(p_status text default null, p_category text default null, p_org uuid default null) returns table (id, organization_id, organization_name, category, status, description, created_at, last_message_at, author_name, message_count)` — `platform.read`.
  - `platform_problem_report(p_id uuid) returns jsonb` (prijava, firma, autor, poruke, fajlovi, povezani zahtjev za pristup) — `platform.read`.
  - `platform_reply_problem_report(p_id uuid, p_body text, p_status text default null) returns uuid` i `platform_set_problem_status(p_id uuid, p_status text) returns void` — `platform.reports.manage`; `resolved` postavlja `resolved_at`.
  - `private.lock_guard` — dodati četiri tabele na listu dozvoljenih (kopija zadnje definicije).
- Produces Storage bucket `problem-report-files` + politike: upload u vlastitu putanju člana firme; čitanje vlastitih fajlova; Zcore čita preko servera (service-role potpisani URL nakon `platform.read` provjere u Task 5).

- [ ] **Step 1: Failing tests** `tests/db/problem-reports.test.ts` (tenant A/B fiksture iz `tests/db/fixtures.ts`, Zcore korisnici kao u `tests/db/platform-roles.test.ts`, brisanje vlastitih redova u `afterAll`):
  - `"submits a report once per idempotency key"` (Review Focus 1)
  - `"requires a description only for other"`
  - `"shows a member only their own reports, never another firm's"` (Review Focus 2: drugi korisnik iste firme i korisnik firme B čitaju 0 redova)
  - `"lets the author reply and moves the report back to in_progress"`
  - `"lets the Tehničar reply and change the status; refuses a tenant admin the platform RPCs"` (`42501`)
  - `"accepts a report from a locked firm"` (Review Focus 5; `setTenantLocked` iz fixtures) i `"refuses a report from an archived firm"`
- [ ] **Step 2:** `npx vitest run --config vitest.db.config.mts tests/db/problem-reports.test.ts` → FAIL.
- [ ] **Step 3:** migracija, `npx supabase db push --linked`, tipovi, `PERMISSION_KEYS`.
- [ ] **Step 4:** isti test + `tests/db/tenant-isolation.test.ts`, `tests/db/organization-lock.test.ts`, `tests/db/platform-roles.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(support): problem reports in the database`

### Task 2: Zakazana sesija podrške — baza

**Files:**

- Create: `supabase/migrations/20261110251000_scheduled_support.sql`, `tests/db/scheduled-support.test.ts`

**Interfaces:**

- Consumes: `problem_reports` (Task 1).
- Produces: kolone `support_access_requests.scheduled_start timestamptz`, `support_access_requests.problem_report_id uuid` (composite FK na `problem_reports (organization_id, id)`).
- Produces: `private.expire_support_requests(p_org uuid) returns void` (pravila isteka iz Global Constraints), pozvan na početku `platform_request_support`, `platform_schedule_support_session`, `decide_support_request`, `platform_begin_support`, `platform_support_requests`, `pending_support_requests`.
- Produces: `platform_schedule_support_session(p_report_id uuid, p_start timestamptz, p_minutes integer, p_reason text) returns uuid` — `platform.reports.manage` i `platform.support`; `p_start >= now() - interval '1 minute'`, trajanje 15–480, razlog 1–1000; ako firma ima otvoren zahtjev → `22023 support_open`; upisuje Zcore poruku u prijavu s tijelom `p_reason` (UI uz nju prikazuje termin iz povezanog zahtjeva) i stavlja prijavu u `waiting_user`.
- Changes (od TRENUTNIH definicija; `platform_begin_support` i `platform_request_support` su zadnji put patchovani u `20261110171000_platform_permission_checks.sql`, `decide_support_request` u `20261027210000`, `pending_support_requests` u `20261028100000`, `platform_support_requests` u `20261027210000`):
  - `decide_support_request`: za zakazan zahtjev koristi njegov `duration_minutes` (`p_minutes` se ignoriše) i `approved_until = scheduled_start + duration`.
  - `platform_begin_support`: odbija prije `scheduled_start` (`22023 not_started`).
  - `platform_support_requests` / `pending_support_requests`: vraćaju i `scheduled_start`, `problem_report_id` (dodati na kraj; promjena povratnog tipa = drop + create s istim grantovima).

- [ ] **Step 1: Failing tests** `tests/db/scheduled-support.test.ts`:
  - `"schedules a session from a report as a pending request with its start"`
  - `"refuses scheduling while the firm has an open support request"` (Review Focus 3, `support_open`)
  - `"approval opens the window from the scheduled start for the scheduled duration"`
  - `"does not let Zcore enter before the start, lets it enter after"` (Review Focus 4; početak u prošlosti postaviti service clientom)
  - `"expires an unapproved request whose window has passed"`
  - `"refuses scheduling for the Tehničar without platform.support"` (napraviti vlastitu ulogu u Zcore firmi samo s `platform.read` + `platform.reports.manage`)
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** migracija, push, tipovi.
- [ ] **Step 4:** isti test + `tests/db/company-directory.test.ts` (podrška) + `tests/db/organization-archive.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(support): scheduled support sessions from problem reports`

### Task 3: Korištenje i brojevi za početnu — baza

**Files:**

- Create: `supabase/migrations/20261110252000_member_activity.sql`, `tests/db/member-activity.test.ts`
- Modify: `tests/db/platform-home.test.ts`

**Interfaces:**

- Produces: `member_activity_days (organization_id, user_id, day date, primary key (organization_id, user_id, day))`, RLS bez direktnog pristupa.
- Produces: `record_member_activity(p_org uuid) returns void` — član firme, ne support nalog, ne platformska firma (tada ništa); `day = private.org_today(p_org)`; `on conflict do nothing`.
- Produces: proširen `platform_home()` (od definicije u `20261110240000_platform_home.sql`) s ključevima:
  - `"usage": { "active_7d": 286, "by_day": [{ "day": "2026-10-11", "users": 120 }] }` — tačno 30 dana do danas (platforma tz), ne-arhivirane ne-platformske firme;
  - `"problems": { "open": 5, "slow_open": 2, "resolved_this_month": 12, "avg_resolution_days": "1.4" | null }` — `open` = stanje ≠ `resolved`; `avg_resolution_days` = prosjek (`resolved_at − created_at`) prijava riješenih ovaj mjesec, string s jednom decimalom ili `null`;
  - `todo.problem_reports_open`, `todo.slow_open` (isti brojevi kao `problems.open` / `problems.slow_open`).
- Ažurirati `platformHomeSchema` u `src/modules/platform/home.ts` (+ test) za nove ključeve.

- [ ] **Step 1: Failing tests:** `member-activity.test.ts` — `"records one row per user and day"`, `"ignores support accounts and the Zcore organization"`; `platform-home.test.ts` — `"counts active users of the last 7 days and returns 30 days"` (delta prema baseline), `"counts open and slow reports and the average resolution"`; `home.test.ts` — schema prihvata nove ključeve.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** migracija, push, tipovi, schema.
- [ ] **Step 4:** testovi → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(platform): usage per day and report counts for the Zcore home`

### Task 4: Prijava problema u firmi — ekrani

**Files:**

- Create: `src/modules/support/problem-reports/schemas.ts` (+ test), `actions.ts`, `queries.ts`; `src/components/shared/problem-report/help-button.tsx`, `report-sheet.tsx`, `my-reports.tsx`, `report-thread.tsx`
- Modify: `src/app/(app)/site-header.tsx` ili `src/app/(app)/layout.tsx` (dugme pored zvona), `src/app/(floor)/layout.tsx` (dugme u zaglavlju), oba layouta (bilježenje aktivnosti), `src/app/(app)/close-request-bell.tsx` + `src/modules/notifications/rules.ts` (vrsta `report`), `messages/bs.json` (namespace `problemReports`)
- Create: `e2e/problem-reports.spec.ts`

**Interfaces:**

- Consumes: RPC-ovi iz Task 1, `record_member_activity` (Task 3), `pending_support_requests` sa `scheduled_start` (Task 2).
- Produces: `problemReportSchema` (Zod: kategorija iz liste, opis ≤ 4000, obavezan za `other`, `pagePath`, `userAgent`, `idempotencyKey` uuid); server actions `submitProblemReport`, `replyProblemReport`, `prepareProblemReportUpload` / `registerProblemReportFile`; `listMyProblemReports(orgId)` (RLS select); bilježenje aktivnosti `after(() => recordMemberActivity(member))` iz `next/server` u oba layouta (preskočiti Zcore firmu).

Ponašanje: ikona `CircleHelp` u gornjoj traci (aplikacija pored zvona; pogon u zaglavlju, `icon-lg`), naziv "Pomoć i prijava problema"; otvara `Sheet` (na telefonu cijeli ekran) s karticama "Prijavi problem" i "Moje prijave". Prijava: šest velikih dugmadi kategorija, opis, "Dodaj sliku ekrana" (jedna slika), dugme "Pošalji"; kontekst (`pathname` bez query stringa, `navigator.userAgent`) šalje klijent, ključ idempotencije nastaje pri otvaranju forme i čuva se do uspjeha (obrazac s pogona: vrijednosti ostaju pri grešci mreže). "Moje prijave": lista (kategorija, stanje, datum), klik → razgovor s porukama, odgovor, prijedlog sesije s terminom i stanjem odobrenja. Tačka na ikoni kad postoji nepročitan Zcore odgovor; u zvonu aplikacije stavka "Odgovor Zcore podrške" (ključ `report:<message id>`), klik otvara "Moje prijave".

- [ ] **Step 1: Failing tests:** `schemas.test.ts` (kategorije, opis za `other`, max dužine); `e2e/problem-reports.spec.ts` — `"a worker reports a problem from the floor and sees it in Moje prijave"` (mobile, demo `operater`), `"an admin reports with a screenshot and reads the Zcore reply"` (odgovor ubačen kroz `platform_reply_problem_report` kao Zcore test korisnik).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implementacija.
- [ ] **Step 4:** `npm run check`, `npx playwright test e2e/problem-reports.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(support): report a problem from the top bar, my reports`

### Task 5: Prijave i pristup podrške u Zcore firmi + kartice početne

**Files:**

- Create: `src/app/(app)/platform/reports/page.tsx`, `src/app/(app)/platform/reports/[id]/page.tsx`, `reports-table.tsx`, `support-requests-table.tsx`, `report-detail.tsx`, `schedule-session-dialog.tsx`; `src/modules/platform/reports-queries.ts`, `reports-actions.ts`, `reports-schemas.ts` (+ test)
- Modify: `src/lib/navigation/registry.ts` (+ test; stavka `platform-reports` "Prijave", `/platform/reports`, ikona `inbox`/postojeća, `platformOrg: true`, `platform.read`), `src/app/(app)/dashboard/platform-home/*` (kartice "Prijave problema" i "Korištenje", pločice "Prijave problema" i "Sporo radi", "aktivni 7 dana" na kartici Korisnici, link "Podrška na čekanju" → `/platform/reports?tab=support`), `src/app/(app)/close-request-bell.tsx` (Zcore: nova prijava / odgovor korisnika), `src/modules/platform/purge.ts` (+ test: `problem-report-files` u `ORGANIZATION_BUCKETS`), `messages/bs.json`
- Create: `e2e/platform-reports.spec.ts`

**Interfaces:**

- Consumes: RPC-ovi Task 1–3; `getPlatformHome` sa `usage`, `problems` (Task 3).
- Produces: stranica `/platform/reports` s karticama (`?tab=reports` default, `?tab=support`): Prijave — tabela (firma, kategorija, opis skraćeno, stanje, zadnja aktivnost; filteri stanje / kategorija / firma); Pristup podrške — sve iz `platform_support_requests()` (firma, ko je tražio, razlog, kada, termin, stanje, preostalo), red vodi na `/platform/organizations/<id>`. Detalj `/platform/reports/[id]`: kontekst (firma, korisnik, stranica, uređaj, vrijeme), slike (potpisani URL kroz service-role klijent nakon `platform.read` provjere), razgovor, odgovor + izbor stanja, "Zakaži sesiju" (datum, vrijeme, trajanje, razlog) samo s `platform.reports.manage` i `platform.support`. Server actions s `permitAction` i istim dozvolama kao RPC.
- Kartice početne: "Korištenje — aktivni korisnici po danu" (30 dana; telefon zadnjih 14), "Prijave problema" (otvorene, riješene ovaj mjesec, prosječno vrijeme rješavanja ili "—").

- [ ] **Step 1: Failing tests:** `reports-schemas.test.ts` (odgovor 1–4000, stanje iz liste, trajanje 15–480, početak ne u prošlosti); `registry.test.ts` (Zcore meni sadrži `platform-reports`); `purge.test.ts` (bucket na listi); `e2e/platform-reports.spec.ts` — `"Tehničar answers a report and schedules a session that the firm's admin approves"` (dva preglednika kao `e2e/platform.spec.ts`), `"home shows the report and usage cards and the support tile opens the support list"`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implementacija (učitaj skill `dataviz` prije grafikona korištenja).
- [ ] **Step 4:** `npm run check`, `npx playwright test e2e/platform-reports.spec.ts e2e/platform-home.spec.ts e2e/platform.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(platform): reports, support requests list and home cards`

### Task 6: Dokumentacija i provjere

**Files:** `docs/DECISIONS.md` (D-051: prijave problema, zakazana podrška, korištenje; brzina stranica izbačena), `docs/STATUS.md`, spec status (dio 3 urađen, bez brzine stranica).

- [ ] **Step 1:** `npm run check`, cijeli `npm run test:db`, `npx playwright test e2e/platform*.spec.ts e2e/problem-reports.spec.ts`, `npm run build` → zeleno (stvarni brojevi).
- [ ] **Step 2: Commit** `docs: Zcore organization part 3 (problem reports, usage)`. Bez push-a dok vlasnik ne kaže.
