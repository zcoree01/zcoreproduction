# Zcore firma, dio 1 — uloge, meni, pretplata unaprijed, arhiva i brisanje firmi — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zcore firma dobija svoje uloge (Administrator, Tehničar) s granularnim platformskim dozvolama i meni bez proizvodnje; naplata prelazi na pretplatu unaprijed s trajnim zapisom uplata; firme se arhiviraju i, uz 30 dana za opoziv, trajno brišu.

**Architecture:** `platform.manage` se zamjenjuje s 12 platformskih dozvola; `private.is_platform_admin()` postaje "član Zcore firme s `platform.read`", a svaki platformski RPC za pisanje dobija svoju dozvolu preko `private.require_platform_permission(text)` (tijela se mijenjaju dinamičkom zamjenom jedne linije u `pg_get_functiondef`, s provjerom da je zamjena uspjela). Arhiva i brisanje su RPC-ovi u bazi; trajno brisanje radi Vercel Cron ruta (Storage preko API-ja, zatim `purge_organization` RPC koji dijeli kod s `purge_test_organization`).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (RLS, SECURITY DEFINER RPC), Zod, next-intl (`messages/bs.json`), Vitest (`npm run check`, `npm run test:db`), Playwright (`npm run e2e`), Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-11-09-zcore-organization-design.md` (dijelovi 1 i 1b; dijelovi 2 i 3 su posebni planovi).

## Global Constraints

- Nove migracije: timestamp veći od `20261110160000` (zadnja primijenjena). Nikad ne mijenjati primijenjenu migraciju.
- Svaka tabela s `organization_id`: RLS + `lock_guard` trigger (D-049). Platformske tabele: RLS uključen, `revoke all ... from anon, authenticated`, pristup samo kroz RPC.
- Tabela trajnog zapisa uplata **ne smije imati kolonu `organization_id`** (purge briše sve tabele s tom kolonom); kolona se zove `firm_id`, bez FK.
- Svaka mutacija: provjera dozvole na serveru (server action + RPC), Zod na ulazu, audit zapis (`private.billing_audit` ili `write_audit`), višekoračni upisi u jednom RPC-u.
- UI tekstovi samo kroz `messages/bs.json`; ključevi bez tačke u imenu (postojeći test). Ikone: `lucide-react` kao u ostatku aplikacije.
- Service role samo na serveru; Cron ruta provjerava `Authorization: Bearer ${process.env.CRON_SECRET}`.
- Potvrda brisanja: upisano ime nakon `trim()` mora biti **tačno** jednako `organizations.name` (velika/mala slova se razlikuju), provjera u UI i u RPC-u.
- Brisanje 30 dana nakon potvrde: `delete_after = now() + interval '30 days'`.
- Pretplata unaprijed: `due_on = greatest(period + grace, prepaid_since + grace)`; `prepaid_since` = dan migracije (prelazni rok za postojeće firme).
- Tehničar vidi cijene paketa; ne vidi zbirni prihod (to je dio 2 — ovdje samo dozvola `platform.revenue.read` postoji i dodijeljena je samo Administratoru).

## Review Focus

1. Ime firme upisano s razmacima na krajevima / drugačijim velikim slovima → razmaci se ignorišu, velika slova ne (odbijeno). Test u Task 5.
2. Arhiviranje firme dok Zcore ima aktivnu sesiju podrške u njoj → sesija se završava (`status = 'ended'`). Test u Task 5.
3. "Vrati iz arhive" na firmi zakazanoj za brisanje → odbijeno dok se brisanje ne opozove. Test u Task 5.
4. Cron se pokrene dvaput ili firma više ne postoji → bez greške, ništa se ne briše dvaput. Test u Task 6.
5. Tehničar zove RPC za poništavanje uplate / brisanje / pakete direktno preko API-ja → `42501`. Test u Task 2.

---

### Task 1: Platformske dozvole i uloge Zcore firme

**Files:**

- Create: `supabase/migrations/20261110170000_platform_roles.sql`
- Create: `tests/db/platform-roles.test.ts`
- Modify: `src/lib/auth/permissions.ts` (lista ključeva), `src/lib/auth/roles.ts` (`SYSTEM_ROLE_KEYS`), `scripts/create-platform-admin.ts:52` (`role: "platform_admin"`), `tests/db/platform-billing.test.ts`, `tests/db/organization-lock.test.ts`, `tests/db/company-directory.test.ts` i e2e helperi koji prave Zcore korisnika s `role: "admin"` → `"platform_admin"`
- Regenerate: `src/lib/supabase/types.ts`

**Interfaces:**

- Produces: dozvole (modul `platform`):
  `platform.read`, `platform.revenue.read`, `platform.modules.manage`, `platform.packages.assign`, `platform.packages.manage`, `platform.support`, `platform.directory.approve`, `platform.payments.record`, `platform.payments.cancel`, `platform.lock`, `platform.settings.manage`, `platform.organizations.archive`, `platform.organizations.delete`.
- Produces: sistemske uloge u Zcore firmi `platform_admin` ("Administrator") i `platform_technician` ("Tehničar").
- Produces: `private.has_platform_permission(p_permission text) returns boolean` (član ne-arhivirane `is_platform` firme s tom dozvolom) i `private.require_platform_permission(p_permission text) returns void` (inače `42501`). `private.is_platform_admin()` = `private.has_platform_permission('platform.read')`.

- [ ] **Step 1: Write the failing DB test** `tests/db/platform-roles.test.ts`:
  - `"gives the Zcore organization only Administrator and Tehničar as active system roles"`: aktivne uloge Zcore firme s `is_system` = tačno `['platform_admin','platform_technician']`; 7 standardnih ima `archived_at`.
  - `"grants the Tehničar the agreed platform permissions only"`: `role_permissions` Tehničara = `{platform.read, platform.modules.manage, platform.packages.assign, platform.support, platform.directory.approve, platform.payments.record, platform.lock}`.
  - `"grants the Administrator every platform permission and Zcore user management"`: svih 13 platformskih + `users.read`, `users.manage`, `roles.manage`, `audit.read`.
  - `"no longer has platform.manage"`: `permissions` nema ključ `platform.manage`.
  - `"moves existing Zcore members to Administrator"`: nijedna aktivna Zcore članarina nema arhiviranu ulogu.
- [ ] **Step 2:** `npx vitest run --config vitest.db.config.mts tests/db/platform-roles.test.ts` → FAIL.
- [ ] **Step 3: Migration** `20261110170000_platform_roles.sql`: insert 13 dozvola s `default_roles` (`{platform_admin}` ili `{platform_admin,platform_technician}` po tabeli iz spec-a); `users.read/users.manage/roles.manage/audit.read` dobijaju `platform_admin` u `default_roles`; insert dvije uloge u Zcore firmu + njihovi `role_permissions`; Zcore članarine → `platform_admin`; arhiviraj 7 standardnih uloga Zcore firme; obriši `role_permissions` i `permissions` red `platform.manage`; `has_platform_permission`, `require_platform_permission`, `create or replace private.is_platform_admin()` i `private.require_platform_admin()` (= `require_platform_permission('platform.read')`). `bootstrap_organization` se ne mijenja (nove firme nikad nisu platformske).
- [ ] **Step 4:** `npx supabase db push`, regeneriši tipove, ažuriraj `PERMISSION_KEYS` (ukloni `platform.manage`, dodaj 13) i `SYSTEM_ROLE_KEYS` (+ `platform_admin`, `platform_technician`), pa ponovi test → PASS. `tests/db/tenant-isolation.test.ts` (provjera da se lista ključeva slaže s bazom) → PASS.
- [ ] **Step 5: Commit** `feat(platform): Administrator and Tehničar roles with granular platform permissions`

### Task 2: Dozvole u platformskim RPC-ovima

**Files:**

- Create: `supabase/migrations/20261110171000_platform_permission_checks.sql`
- Modify: `tests/db/platform-roles.test.ts`

**Interfaces:**

- Consumes: `private.require_platform_permission(text)`, `private.has_platform_permission(text)` (Task 1).
- Produces: mapiranje RPC → dozvola (svi ostali platformski RPC-ovi ostaju na `platform.read`):

| RPC                                                                                                 | dozvola                       |
| --------------------------------------------------------------------------------------------------- | ----------------------------- |
| `platform_set_module`                                                                               | `platform.modules.manage`     |
| `platform_assign_package`                                                                           | `platform.packages.assign`    |
| `platform_save_package`, `platform_set_package_archived`                                            | `platform.packages.manage`    |
| `platform_set_lock`, `platform_unlock_until`, `platform_set_org_billing`                            | `platform.lock`               |
| `platform_save_billing_settings`, `platform_set_trial_days`                                         | `platform.settings.manage`    |
| `platform_request_support`, `platform_begin_support`                                                | `platform.support`            |
| `decide_company_change` (platformska grana, `is_platform_admin()` na liniji ~910 izvorne migracije) | `platform.directory.approve`  |
| `platform_set_payment`                                                                              | prepravlja se cijeli u Task 4 |

- [ ] **Step 1: Failing tests** u `platform-roles.test.ts` (korisnici `db.platform.admin` / `db.platform.tech` u Zcore firmi preko `ensureUser`, arhivirani u `afterAll`):
  - `"lets the Tehničar change modules, assign a package, lock and unlock"` → `error` null.
  - `"refuses the Tehničar packages, platform settings and trial days"`: `platform_save_package`, `platform_save_billing_settings`, `platform_set_trial_days` → `error.code === "42501"`.
  - `"refuses every platform RPC for a tenant admin"` (postojeći test iz `platform-billing.test.ts` ostaje zelen).
- [ ] **Step 2:** run → FAIL (Tehničar trenutno ima samo `platform.read` pa prolazi kroz `require_platform_admin`).
- [ ] **Step 3: Migration**: `DO` blok s nizom `(regprocedure, staro, novo)`; za svaku funkciju `execute replace(pg_get_functiondef(f), staro, novo)`, a prije toga `raise exception` ako `strpos(def, staro) = 0` ili se `staro` pojavljuje više puta. `staro` = `perform private.require_platform_admin();` (ili izraz iz `decide_company_change`), `novo` = `perform private.require_platform_permission('<ključ>');`. Grant-ovi ostaju (replace zadržava potpis).
- [ ] **Step 4:** `npx supabase db push` → run → PASS; cijeli `tests/db/platform-billing.test.ts` i `company-directory.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(platform): each platform action needs its own permission`

### Task 3: Aplikacija — dozvole, meni Zcore firme, uređivač uloga

**Files:**

- Modify: `src/lib/navigation/registry.ts` (+ `registry.test.ts`), `src/app/(app)/platform/page.tsx`, `src/app/(app)/platform/organizations/[id]/page.tsx` (+ `package-card.tsx`, `modules-card.tsx`, `lock-controls.tsx`, `payments-table.tsx`), `src/app/(app)/platform/requests/page.tsx`, `src/app/(app)/platform/settings/page.tsx`, `src/modules/platform/actions.ts`, `src/modules/platform/billing-actions.ts`, `src/modules/support/actions.ts`, `src/modules/roles/queries.ts`, `src/modules/roles/schemas.ts` (+ test), `src/app/(app)/settings/roles/role-editor.tsx`, `src/app/(app)/dashboard/page.tsx`
- Create: `supabase/migrations/20261110172000_platform_custom_roles.sql` (nova verzija `save_custom_role`)

**Interfaces:**

- Consumes: ključevi iz Task 1, mapiranje iz Task 2.
- Produces: `NavItemDef.platformOrg?: true` — u firmi s modulom `platform` `buildNavigation` prikazuje **samo** stavke s `platformOrg: true`: `dashboard`, `users`, `roles`, `platform-organizations`, `platform-requests`, `platform-settings`.
- Produces: `customRolePermissionKeys(isPlatformOrg: boolean, all: {key, module}[]) : PermissionKey[]` u `src/modules/roles/queries.ts` — platformska firma: modul `platform` + `users.read`, `users.manage`, `roles.manage`, `audit.read`; ostale firme: sve osim modula `platform`. `platform.organizations.delete` se nikad ne nudi vlastitoj ulozi (moja odluka: samo sistemski Administrator briše).

- [ ] **Step 1: Failing unit tests**:
  - `registry.test.ts` `"shows only the platform items in the Zcore organization"`: `buildNavigation("app", { modules: new Set(["core","platform"]), permissions: <svi ključevi> })` → id-evi `["dashboard","users","roles","platform-organizations","platform-requests","platform-settings"]` (nema `machines`, `employees`, `customers`).
  - `registry.test.ts` `"hides platform settings from the Tehničar"`: s dozvolama Tehničara nema `platform-settings` ni `users`/`roles`.
  - `schemas.test.ts` (roles) `"refuses platform permissions outside the platform organization and the delete permission everywhere"`.
- [ ] **Step 2:** `npm run check` → FAIL.
- [ ] **Step 3: Implement**: zastavica u registry + filter; stavke platforme na `platform.read`, postavke na `platform.settings.manage` ili `platform.packages.manage`; stranice: `platform.read` za pregled, a dugmad/kartice se prikazuju po dozvoli (moduli → `modules.manage`, paket → `packages.assign`, zaključavanje / rok / auto-lock → `lock`, "Označi plaćeno" → `payments.record`, "Poništi" → `payments.cancel`, podrška → `support`, odluka o zahtjevu → `directory.approve`); server actions zovu `permitAction(org, '<ista dozvola>')`. `/dashboard` u platformskoj firmi: `redirect("/platform")` dok dio 2 ne napravi početnu. Migracija `save_custom_role`: ista provjera kao `customRolePermissionKeys` u bazi (`invalid_permission`).
- [ ] **Step 4:** `npm run check` → PASS; `npx vitest run tests/db/roles.test.ts` → PASS (ažuriraj `"never grants platform.manage"` na `"never grants platform permissions to a tenant role"`).
- [ ] **Step 5: Commit** `feat(platform): Zcore menu without production, role editor with platform permissions`

### Task 4: Pretplata unaprijed i trajni zapis uplata

**Files:**

- Create: `supabase/migrations/20261110180000_prepaid_billing.sql`
- Modify: `tests/db/platform-billing.test.ts`, `messages/bs.json` (tekst upozorenja firmi: "pretplata za <mjesec>", rok "dospijeva <datum>"), komponenta trake obavještenja (`src/modules/platform/billing-notice.ts` + mjesto gdje se renderuje)

**Interfaces:**

- Produces: `platform_settings.prepaid_since date not null` (vrijednost = `current_date` pri migraciji).
- Produces: tabela `public.platform_payment_records (id uuid pk, firm_id uuid not null, firm_name text not null, firm_slug text not null, period date not null, amount numeric(12,2) not null, paid_on date not null, note text, recorded_by uuid, recorded_at timestamptz not null default now(), cancelled_at timestamptz, cancelled_by uuid)`; unique `(firm_id, period) where cancelled_at is null`; RLS on, bez grantova.
- Produces: `private.billing_months` s novim `due_on` (vidi Global Constraints); `platform_set_payment` pri plaćanju upisuje red u `platform_payment_records` (iznos = `private.package_price_on` za taj mjesec), pri poništavanju postavlja `cancelled_at/by` (red ostaje); dozvola `platform.payments.record` / `platform.payments.cancel` po `p_paid`.

- [ ] **Step 1: Failing tests** (u `platform-billing.test.ts`; test postavlja `prepaid_since` preko service role i vraća ga u `afterAll`):
  - zamijeni `"computes due dates in the organization's timezone"`: uz `prepaid_since = '2026-01-01'` i grace 15, oktobar `due_on === "2026-10-16"`.
  - `"gives existing firms a transition deadline"`: uz `prepaid_since = '2026-11-10'`, neplaćen oktobar `due_on === "2026-11-25"` i firma nije `locked` prije toga.
  - `"locks in the running month once its due date passed"`: paket od tekućeg mjeseca, `prepaid_since` i grace tako da je rok prošao → `state === "locked"`.
  - `"keeps a permanent payment record and marks it cancelled instead of deleting"`: plati → red s `amount`, `firm_name`; poništi → isti red ima `cancelled_at`.
  - `"refuses cancelling a payment for the Tehničar"` → `42501`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Migration**: kolona, tabela, backfill postojećih `billing_payments` u `platform_payment_records` (iznos iz `private.billing_months`), `create or replace private.billing_months` i `public.platform_set_payment`. Tekstovi obavještenja u `bs.json`.
- [ ] **Step 4:** push, tipovi, run → PASS; `organization-lock.test.ts` → PASS (testovi koji računaju rok prilagođeni novom pravilu).
- [ ] **Step 5: Commit** `feat(platform): prepaid subscription and permanent payment records`

### Task 5: Arhiviranje, vraćanje, zakazivanje i opoziv brisanja

**Files:**

- Create: `supabase/migrations/20261110190000_organization_archive.sql`
- Create: `tests/db/organization-archive.test.ts`

**Interfaces:**

- Produces: kolone `organizations.archived_reason text`, `organizations.delete_after timestamptz`; tabela `public.organization_archive_periods (organization_id uuid not null references organizations on delete restrict, archived_at timestamptz not null, restored_at timestamptz, archived_by uuid, reason text)` s RLS, bez grantova, s `lock_guard`.
- Produces RPC-ovi (SECURITY DEFINER, `assert_billable_org`, audit `organization.*` u Zcore firmi preko `private.billing_audit` ili ekvivalenta):
  - `platform_archive_organization(p_org_id uuid, p_reason text) returns void` — `platform.organizations.archive`; razlog 1–300 znakova; postavlja `archived_at`, `archived_reason`, otvara period; završava otvoreni `support_access_requests` (`ended`).
  - `platform_restore_organization(p_org_id uuid) returns void` — `platform.organizations.archive`; odbija (`22023 deletion_scheduled`) dok je `delete_after` postavljen; zatvara period.
  - `platform_schedule_organization_deletion(p_org_id uuid, p_confirm_name text) returns timestamptz` — `platform.organizations.delete`; firma mora biti arhivirana (`22023 not_archived`); `btrim(p_confirm_name) = name` inače `22023 name_mismatch`; vraća `delete_after`.
  - `platform_cancel_organization_deletion(p_org_id uuid) returns void` — `platform.organizations.delete`.
- Produces: `private.billing_months` ne vraća mjesec M kad postoji period s `archived_at::date <= M` i (`restored_at is null` ili `date_trunc('month', restored_at) > M`); `private.org_lock_state` vraća `state = 'archived'` za arhiviranu firmu (prije svih ostalih provjera); `platform_billing_overview` vraća i `archived_at`, `delete_after`.
- Produces: `kiosk_session` i `kiosk_clock` ne rade za arhiviranu firmu (kopija zadnjeg tijela iz `20261028130000_kiosk_repeat_guard.sql` / `20261109100000_kiosk_host.sql` + uslov `o.archived_at is null`).

- [ ] **Step 1: Failing tests** u `organization-archive.test.ts` (privremena firma `dbt-reg-arch-<rand>` preko `ensureOrganization` — prefiks već odgovara `purge_test_organization`, kojom se briše u `afterAll`; korisnik u njoj):
  - `"archives a firm: its users lose access and the kiosk stops"`: nakon arhiviranja korisnik firme čita 0 redova iz `customers`; `kiosk_session` za njen uređaj → null/greška.
  - `"ends an open support session when archiving"` (Review Focus 2).
  - `"does not bill archived months and bills again from the restore month"`.
  - `"refuses archive and deletion for the Tehničar"` → `42501`.
  - `"schedules deletion only for an archived firm with the exact name"`: neaktivna → `not_archived`; `"  <ime>  "` → OK; ime s drugačijim velikim slovima → `name_mismatch` (Review Focus 1); vraća datum ≈ now + 30 dana.
  - `"refuses restore while deletion is scheduled, allows it after cancelling"` (Review Focus 3).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Migration** po Interfaces.
- [ ] **Step 4:** push, tipovi, run → PASS; `platform-billing.test.ts`, `attendance-kiosk.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(platform): archive and restore firms, schedule deletion with a 30-day undo`

### Task 6: Trajno brisanje (purge + Cron)

**Files:**

- Create: `supabase/migrations/20261110200000_purge_organization.sql`
- Create: `src/app/api/cron/purge-organizations/route.ts`, `src/modules/platform/purge.ts`, `src/modules/platform/purge.test.ts`
- Create: `vercel.json` izmjena: `"crons": [{ "path": "/api/cron/purge-organizations", "schedule": "0 3 * * *" }]`
- Modify: `.env.example` (`CRON_SECRET=`), `tests/db/organization-archive.test.ts`

**Interfaces:**

- Produces: `private.purge_organization_rows(p_org_id uuid, p_remove_directory boolean) returns void` — izvučeno tijelo `purge_test_organization` (petlja po tabelama s `organization_id`, audit guard, `auth.users`); s `false` imenik (`companies`, `company_bank_accounts`) ostaje, samo se `owner_organization_id` / `created_by_organization_id` postave na null. `purge_test_organization` = provjera slug-a + `purge_organization_rows(id, true)` (ponašanje i regex nepromijenjeni).
- Produces: `public.purge_organization(p_org_id uuid) returns boolean` — samo `service_role`; `false` ako firma ne postoji; `42501` ako nije arhivirana, je `is_platform`, ili `delete_after > now()`; prije brisanja upiše audit u Zcore firmu (`organization.purged`, ime, slug, broj korisnika); vraća `true`.
- Produces: `purgeDueOrganizations(service: SupabaseClient<Database>, now: Date): Promise<{ purged: string[]; failed: { id: string; error: string }[] }>` u `src/modules/platform/purge.ts` — bira firme s `delete_after <= now` i `archived_at is not null`; za svaku briše Storage objekte pod `<orgId>/` u bucketima `product-files`, `stock-certificates`, `organization-files`, `absence-documents` (list + remove u stranicama), pa zove `purge_organization`; greška jedne firme ne zaustavlja ostale.
- Produces: `GET /api/cron/purge-organizations` — 401 bez tačnog `Authorization: Bearer <CRON_SECRET>` (i kad `CRON_SECRET` nije postavljen); inače `purgeDueOrganizations(createAdminClient(), new Date())` → JSON.

- [ ] **Step 1: Failing tests**:
  - `purge.test.ts` `"rejects a request without the cron secret"` i `"rejects every request when CRON_SECRET is not set"` (handler pozvan s `new Request(...)`).
  - `organization-archive.test.ts` `"refuses purge before the 30 days and purges after"`: `delete_after` u budućnosti → `42501`; service postavi `delete_after` u prošlost → `true`, nema redova s tim `organization_id` ni korisnika u `auth.users`, `platform_payment_records` za tu firmu postoje, `companies` zapis firme postoji s `owner_organization_id = null`.
  - `"is safe to run twice"`: drugi `purge_organization` → `false`, bez greške (Review Focus 4).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** migraciju, modul, rutu, `vercel.json`, `.env.example`.
- [ ] **Step 4:** `npm run check` i `npx vitest run tests/db/organization-archive.test.ts tests/db/company-directory.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(platform): permanent deletion 30 days after confirmation (daily cron)`

### Task 7: Ekrani — arhiva i brisanje na stranici firme, filter "Arhiva"

**Files:**

- Create: `src/app/(app)/platform/organizations/[id]/archive-controls.tsx`, `delete-organization-dialog.tsx`
- Modify: `src/app/(app)/platform/organizations/[id]/page.tsx`, `src/app/(app)/platform/page.tsx`, `src/app/(app)/platform/billing-state-badge.tsx`, `src/modules/platform/schemas.ts` (+ test), `src/modules/platform/billing-actions.ts`, `src/modules/platform/billing-queries.ts`, `messages/bs.json`
- Modify: `e2e/platform.spec.ts`, `e2e/platform-billing.spec.ts` (Zcore korisnik s `platform_admin`)
- Create: `e2e/platform-archive.spec.ts`

**Interfaces:**

- Consumes: RPC-ovi iz Task 5, `BillingState` + `'archived'`.
- Produces: `OVERVIEW_FILTERS = ["all","late","locked","trial","archived"]`; "Sve" ne prikazuje arhivirane; "Arhiva" prikazuje arhivirane i zakazane za brisanje (s datumom).
- Produces: Zod šeme `archiveOrganizationSchema {orgId: uuid, reason: 1–300}`, `deleteOrganizationSchema {orgId: uuid, confirmName: 1–200}`; server actions `archiveOrganization`, `restoreOrganization`, `scheduleOrganizationDeletion`, `cancelOrganizationDeletion` (svaka `permitAction` s dozvolom iz Task 5, greške `name_mismatch` / `not_archived` / `deletion_scheduled` → poruke uz polje).

Ponašanje (iz spec-a): dugme "Arhiviraj firmu" pored "Zaključaj" (samo s `platform.organizations.archive`), dijalog s razlogom. Arhivirana firma: traka "Arhivirana <datum> · <razlog>", dugmad "Vrati iz arhive" i "Obriši firmu" (samo `platform.organizations.delete`). "Obriši firmu" → `ConfirmDialog` "Da li ste sigurni da želite obrisati firmu <ime>?" → drugi dijalog: puno ime kao tekst gore, polje "Potvrdite brisanje ponovnim upisom punog imena firme", dugme "Obriši" onemogućeno dok `input.trim() !== name`. Zakazana: traka "Zakazana za brisanje <datum>" + "Opozovi brisanje". Ikone iz `lucide-react` (`Archive`, `ArchiveRestore`, `Trash2`, `Undo2`).

- [ ] **Step 1: Failing tests**: `schemas.test.ts` `"accepts the archived filter"`; `e2e/platform-archive.spec.ts` `"admin archives a firm, schedules deletion with the exact name, cancels and restores"` (firma `e2e-arch-<rand>` napravljena service role-om, obrisana `purge_test_organization` u `afterAll`) i `"Tehničar sees no archive or delete buttons"`.
- [ ] **Step 2:** `npm run check` / `npx playwright test e2e/platform-archive.spec.ts` → FAIL.
- [ ] **Step 3: Implement** po Interfaces i Ponašanju.
- [ ] **Step 4:** `npm run check`, `npx playwright test e2e/platform*.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(platform): archive, restore and delete a firm from its page`

### Task 8: Dokumentacija i završne provjere

**Files:**

- Modify: `docs/DECISIONS.md` (D-050: uloge Zcore firme i granularne platformske dozvole; pretplata unaprijed — mijenja rok iz D-049; trajni zapis uplata; arhiva i brisanje kao svjesni izuzetak od pravila 8, 30 dana, Cron; imenik ostaje), `docs/STATUS.md` (Implemented, Known gaps: `CRON_SECRET` mora biti postavljen u Vercelu, inače se ništa ne briše; dio 2 i 3 sljedeći), `docs/superpowers/specs/2026-11-09-zcore-organization-design.md` (status: dio 1 urađen)

- [ ] **Step 1:** `npm run check` → zeleno (broj testova u izvještaju).
- [ ] **Step 2:** cijeli `npm run test:db` → zeleno.
- [ ] **Step 3:** `npm run e2e` (bar `platform*`, `roles`, `auth`) → zeleno.
- [ ] **Step 4:** `npm run build` → zeleno.
- [ ] **Step 5: Commit** `docs: Zcore organization part 1 (D-050)`. Bez push-a dok vlasnik ne kaže; reći mu da postavi `CRON_SECRET` u Vercelu.
