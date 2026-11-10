import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { toAuthEmail } from "@/lib/auth/username";
import { ensureOrganization, ensureUser } from "../src/modules/organizations/provision";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";
import { ensureFloorFixture, FLOOR_OPERATOR } from "./production-fixture";

// Reporting a problem from the top bar (floor header and management app),
// "Moje prijave", the Zcore reply and its notifications. Every report made
// here carries RUN in its description and is removed afterwards. Runs in the
// permanent test tenants (A: admin, B: floor fixture operator), never the demo firm.

const RUN = `e2e-prijava-${randomUUID().slice(0, 8)}`;
const TECH = { username: "e2e.reports.tech", password: testTenantPassword() };
const HELP = "Pomoć i prijava problema";

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let techId = "";

test.beforeAll(async () => {
  const service = createAdminClient();
  await ensureFloorFixture();
  const zcore = await ensureOrganization(service, { slug: "zcore", name: "Zcore" });
  techId = await ensureUser(service, zcore, {
    username: TECH.username,
    password: TECH.password,
    fullName: TECH.username,
    role: "platform_technician",
  });
  await service.from("memberships").update({ archived_at: null }).eq("user_id", techId);
});

test.afterAll(async () => {
  const service = createAdminClient();
  const reports = (
    await service.from("problem_reports").select("id").like("description", `%${RUN}%`)
  ).data;
  const ids = (reports ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const files = (
      await service.from("problem_report_files").select("storage_path").in("report_id", ids)
    ).data;
    if (files && files.length > 0) {
      await service.storage.from("problem-report-files").remove(files.map((f) => f.storage_path));
    }
    await service.from("problem_report_files").delete().in("report_id", ids);
    await service.from("problem_report_messages").delete().in("report_id", ids);
    await service.from("problem_reports").delete().in("id", ids);
  }
  await service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", techId);
});

test("a worker reports a problem from the floor and sees it in Moje prijave @mobile", async ({
  page,
}) => {
  await login(
    page,
    { username: FLOOR_OPERATOR.username, password: testTenantPassword() },
    TEST_TENANTS.b.slug,
  );
  await expectPath(page, "/floor");

  await page.getByRole("button", { name: HELP }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("tab", { name: "Prijavi problem" })).toBeVisible();
  for (const label of [
    "Nešto ne radi",
    "Sporo radi",
    "Ne znam kako da…",
    "Prijedlog",
    "Paket i plaćanje",
    "Ostalo",
  ]) {
    await expect(sheet.getByRole("button", { name: label })).toBeVisible();
  }
  await sheet.getByRole("button", { name: "Sporo radi" }).click();
  await sheet.getByLabel("Opis").fill(`Stranica se sporo otvara ${RUN}`);
  await sheet.getByRole("button", { name: "Pošalji", exact: true }).click();

  await expect(page.getByText("Prijava je poslana").first()).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "Moje prijave", selected: true })).toBeVisible();
  const row = sheet.getByTestId("my-report").filter({ hasText: RUN });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Sporo radi");
  await expect(row).toContainText("Nova");

  const service = createAdminClient();
  const stored = await service
    .from("problem_reports")
    .select("category, status, page_path, user_agent")
    .like("description", `%${RUN}%`)
    .single();
  expect(stored.data).toMatchObject({ category: "slow", status: "new", page_path: "/floor" });
  expect(stored.data?.user_agent).toBeTruthy();
});

test("an admin reports with a screenshot and reads the Zcore reply", async ({ page }) => {
  test.slow();
  const service = createAdminClient();
  await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.a.slug);
  await expectPath(page, "/dashboard");

  await page.getByRole("button", { name: HELP }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Ostalo" }).click();
  // "Ostalo" needs a description.
  await sheet.getByRole("button", { name: "Pošalji", exact: true }).click();
  await expect(sheet.getByText("Opis je obavezan za Ostalo")).toBeVisible();
  await sheet.getByLabel("Opis").fill(`Ne mogu naći izvještaj ${RUN}`);
  await sheet
    .locator('input[type="file"]')
    .setInputFiles({ name: "ekran.png", mimeType: "image/png", buffer: PNG });
  await expect(sheet.getByText("ekran.png")).toBeVisible();
  await sheet.getByRole("button", { name: "Pošalji", exact: true }).click();
  // The toast and "Moje prijave" do not wait for the screenshot upload.
  await expect(page.getByText("Prijava je poslana").first()).toBeVisible();
  await expect(sheet.getByTestId("my-report").filter({ hasText: RUN })).toBeVisible();

  const report = await service
    .from("problem_reports")
    .select("id")
    .like("description", `%izvještaj ${RUN}`)
    .single();
  const reportId = report.data!.id;
  await expect
    .poll(async () => {
      const files = await service
        .from("problem_report_files")
        .select("id")
        .eq("report_id", reportId);
      return files.data?.length ?? 0;
    })
    .toBe(1);

  // The Zcore technician answers.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
    },
  );
  const signedIn = await anon.auth.signInWithPassword({
    email: toAuthEmail(TECH.username, "zcore"),
    password: TECH.password,
  });
  expect(signedIn.error).toBeNull();
  const replied = await anon.rpc("platform_reply_problem_report", {
    p_id: reportId,
    p_body: `Izvještaji su u meniju Proizvodnja ${RUN}`,
    p_status: "waiting_user",
  });
  expect(replied.error).toBeNull();
  await anon.auth.signOut();

  // Dot on the button and an item in the bell.
  await page.reload();
  await expect(page.getByTestId("help-unread-dot")).toBeVisible();
  await page.getByTestId("notification-bell").click();
  const item = page.getByTestId("notification-item").filter({ hasText: "Odgovor Zcore podrške" });
  await expect(item).toBeVisible();
  await item.getByRole("menuitem").click();

  // The click opens Moje prijave; the thread shows the reply.
  await expect(sheet.getByRole("tab", { name: "Moje prijave", selected: true })).toBeVisible();
  const row = sheet.getByTestId("my-report").filter({ hasText: RUN });
  await expect(row).toContainText("Čeka vas");
  await row.click();
  await expect(sheet.getByText(`Izvještaji su u meniju Proizvodnja ${RUN}`)).toBeVisible();
  await expect(sheet.getByText("Zcore podrška").first()).toBeVisible();
  await expect(page.getByTestId("help-unread-dot")).toHaveCount(0);

  // Own answer returns the report to "U obradi".
  await sheet.getByLabel("Vaš odgovor").fill(`Hvala, pronašao sam ${RUN}`);
  await sheet.getByRole("button", { name: "Pošalji odgovor" }).click();
  await expect(sheet.getByLabel("Vaš odgovor")).toHaveValue("");
  await expect(
    sheet.getByTestId("report-thread").locator("p", { hasText: `Hvala, pronašao sam ${RUN}` }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await service.from("problem_reports").select("status").eq("id", reportId).single()).data
          ?.status,
    )
    .toBe("in_progress");
});
