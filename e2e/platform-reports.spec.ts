import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { toAuthEmail } from "@/lib/auth/username";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";

// Zcore side of problem reports: the list, the conversation, scheduling a
// support session that the firm's admin approves, and the home cards.
// Every report made here carries RUN in its description and is removed afterwards.

const RUN = `e2e-zprijava-${randomUUID().slice(0, 8)}`;
const TECH = { username: "e2e.preports.tech", password: testTenantPassword() };
const TENANT_ADMIN = { username: "admin", password: testTenantPassword() };

let techId = "";
let tenantAId = "";

async function closeOpenRequests(organizationId: string) {
  await createAdminClient()
    .from("support_access_requests")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .in("status", ["pending", "approved", "active"]);
}

test.beforeAll(async () => {
  const service = createAdminClient();
  const zcore = await ensureOrganization(service, { slug: "zcore", name: "Zcore" });
  techId = await ensureUser(service, zcore, {
    username: TECH.username,
    password: TECH.password,
    fullName: "E2E Reports Tech",
    role: "platform_technician",
  });
  await service.from("memberships").update({ archived_at: null }).eq("user_id", techId);
  const tenantA = await service
    .from("organizations")
    .select("id")
    .eq("slug", TEST_TENANTS.a.slug)
    .single();
  tenantAId = tenantA.data?.id ?? "";
  await closeOpenRequests(tenantAId);
});

test.afterAll(async () => {
  const service = createAdminClient();
  const reports = (
    await service.from("problem_reports").select("id").like("description", `%${RUN}%`)
  ).data;
  const ids = (reports ?? []).map((row) => row.id);
  if (ids.length > 0) {
    // Requests reference the report: remove them first, never leave one open.
    await service.from("support_access_requests").delete().in("problem_report_id", ids);
    await service.from("problem_report_messages").delete().in("report_id", ids);
    await service.from("problem_reports").delete().in("id", ids);
  }
  await closeOpenRequests(tenantAId);
  await service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", techId);
});

test("Tehničar answers a report and schedules a session that the firm's admin approves", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  // The firm's admin reports a problem (through the database, as the sheet does).
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const signedIn = await anon.auth.signInWithPassword({
    email: toAuthEmail(TENANT_ADMIN.username, TEST_TENANTS.a.slug),
    password: TENANT_ADMIN.password,
  });
  expect(signedIn.error).toBeNull();
  const submitted = await anon.rpc("submit_problem_report", {
    p_org: tenantAId,
    p_category: "broken",
    p_description: `Ne radi štampa ${RUN}`,
    p_page_path: "/orders",
    p_user_agent: "e2e",
    p_idempotency_key: randomUUID(),
  });
  expect(submitted.error).toBeNull();
  await anon.auth.signOut();

  // The firm's admin is signed in in another browser.
  const orgContext = await browser.newContext();
  const org = await orgContext.newPage();
  await login(org, TENANT_ADMIN, TEST_TENANTS.a.slug);
  await expectPath(org, "/dashboard");

  await login(page, TECH, "zcore");
  await expectPath(page, "/dashboard");

  // The new report shows in the bell, and the menu leads to the list.
  await page.getByTestId("notification-bell").click();
  await expect(
    page.getByTestId("notification-item").filter({ hasText: RUN }).first(),
  ).toContainText("Nova prijava problema");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Prijave", exact: true }).click();
  await expectPath(page, "/platform/reports");
  const row = page.getByTestId("report-row").filter({ hasText: RUN });
  await expect(row).toContainText(TEST_TENANTS.a.name);
  await expect(row).toContainText("Nešto ne radi");
  await expect(row).toContainText("Nova");
  await row.getByRole("link", { name: TEST_TENANTS.a.name }).click();

  // Detail: context, answer with a state.
  await expect(page.getByText("/orders")).toBeVisible();
  await expect(page.getByTestId("report-messages")).toContainText("Još nema poruka");
  await page.getByLabel("Odgovor korisniku").fill(`Pogledat ćemo ${RUN}`);
  await page.getByLabel("Nakon odgovora").selectOption({ label: "Čeka korisnika" });
  await page.getByRole("button", { name: "Pošalji odgovor" }).click();
  await expect(page.getByText("Odgovor je poslan.").first()).toBeVisible();
  await expect(page.getByTestId("report-messages").getByText(`Pogledat ćemo ${RUN}`)).toBeVisible();
  await expect(page.getByLabel("Stanje", { exact: true })).toHaveValue("waiting_user");

  // Schedule a session for tomorrow.
  const tomorrow = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10);
  await page.getByRole("button", { name: "Zakaži sesiju" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Datum").fill(tomorrow);
  await dialog.getByLabel("Vrijeme").fill("10:00");
  await dialog.getByLabel("Trajanje").selectOption({ label: "30 minuta" });
  await dialog.getByLabel("Razlog (vidi ga firma)").fill(`Provjera štampe ${RUN}`);
  await dialog.getByRole("button", { name: "Pošalji prijedlog" }).click();
  await expect(page.getByText("Termin je predložen firmi.").first()).toBeVisible();
  const sessions = page.getByTestId("report-sessions");
  await expect(sessions).toContainText("Čeka odobrenje");
  await expect(sessions).toContainText("30 minuta");

  // The firm's admin gets the proposal with the fixed window and approves it.
  const prompt = org.getByRole("alertdialog", { name: "Zcore podrška traži pristup" });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt.getByTestId("support-scheduled")).toBeVisible();
  await prompt.getByRole("button", { name: "Odobri pristup" }).click();
  await expect(org.getByText("Termin je odobren.").first()).toBeVisible();

  // Zcore sees the approval on the report and in the support list.
  await page.reload();
  await expect(page.getByTestId("report-sessions")).toContainText("Odobreno");
  await page.goto("/platform/reports?tab=support");
  const supportRow = page.getByTestId("support-row").filter({ hasText: TEST_TENANTS.a.name });
  await expect(supportRow).toContainText("Odobreno");
  await expect(supportRow).toContainText(`Provjera štampe ${RUN}`);
  await supportRow.getByRole("link", { name: TEST_TENANTS.a.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: TEST_TENANTS.a.name })).toBeVisible();

  await orgContext.close();
});

test("home shows the report and usage cards and the support tile opens the support list", async ({
  page,
}) => {
  await login(page, TECH, "zcore");
  await expectPath(page, "/dashboard");
  await expect(page.getByTestId("usage-card")).toContainText(
    "Korištenje — aktivni korisnici po danu",
  );
  await expect(page.getByTestId("problems-card")).toContainText("Riješene ovaj mjesec");
  await expect(page.getByTestId("problems-card")).toContainText("Prosječno rješavanje");
  await expect(page.getByTestId("kpi-cards")).toContainText("aktivni 7 dana:");
  await expect(page.getByRole("link", { name: /Prijave problema \d+ Otvori/ })).toHaveAttribute(
    "href",
    "/platform/reports",
  );
  await expect(page.getByRole("link", { name: /Sporo radi \d+ Otvori/ })).toHaveAttribute(
    "href",
    "/platform/reports?category=slow",
  );
  await page.getByRole("link", { name: /Podrška na čekanju \d+ Otvori/ }).click();
  await expectPath(page, "/platform/reports");
  await expect(page).toHaveURL(/tab=support/);
  await expect(page.getByRole("tab", { name: "Pristup podrške", selected: true })).toBeVisible();
});
