import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAdminClient } from "../scripts/lib/admin-client";
import { TEST_TENANTS, testTenantPassword } from "../tests/shared/test-tenants";
import { expectPath, login } from "./helpers";
import { ensureFloorFixture } from "./production-fixture";

// Notifications (D-038) in test tenant B: two attendance alerts of the floor
// employee (sessions in 2020, so they never overlap real ones). The admin
// gets pop-ups with "Otvori" and ✕; ✕ marks one read; in the bell "Označi
// sve kao pročitano" clears the counter and ✕ removes an item for good.

test("pop-ups and the bell: open, mark all read, remove", async ({ page }) => {
  test.slow();
  await ensureFloorFixture();
  const admin = createAdminClient();
  const org = (
    await admin.from("organizations").select("id").eq("slug", TEST_TENANTS.b.slug).single()
  ).data!.id;
  const employee = (
    await admin
      .from("employees")
      .select("id")
      .eq("organization_id", org)
      .eq("employee_number", 800001)
      .single()
  ).data!.id;

  const minute = Math.floor(Math.random() * 50_000);
  const at = (offset: number) => new Date(Date.UTC(2020, 0, 1, 0, minute + offset)).toISOString();
  const sessions = (
    await admin
      .from("attendance_sessions")
      .insert(
        [0, 20].map((offset) => ({
          organization_id: org,
          employee_id: employee,
          work_date: at(offset).slice(0, 10),
          clock_in_at: at(offset),
          clock_out_at: at(offset + 10),
          clock_in_source: "manual",
          clock_out_source: "auto",
          idempotency_key: randomUUID(),
        })),
      )
      .select("id")
      .throwOnError()
  ).data!.map((row) => row.id);
  const alerts = (
    await admin
      .from("attendance_alerts")
      .insert(
        sessions.map((session) => ({
          organization_id: org,
          employee_id: employee,
          session_id: session,
          kind: "auto_clock_out",
        })),
      )
      .select("id")
      .throwOnError()
  ).data!.map((row) => row.id);

  try {
    await login(page, { username: "admin", password: testTenantPassword() }, TEST_TENANTS.b.slug);
    await expectPath(page, "/dashboard");

    // Pop-ups: one per new alert, each with "Otvori" and a close button.
    const popups = page.locator("[data-sonner-toast]").filter({ hasText: "zaboravljena odjava" });
    await expect(popups.first()).toBeVisible();
    await expect(popups.first().getByRole("button", { name: "Otvori" })).toBeVisible();
    await popups
      .first()
      .getByRole("button", { name: /close|zatvori/i })
      .click();

    const bell = page.getByTestId("notification-bell");
    const ours = page
      .getByTestId("notification-item")
      .filter({ hasText: "E2E Floor" })
      .filter({ hasText: "Zaboravljena odjava" });
    await bell.click();
    await expect(ours).toHaveCount(2);
    // The closed pop-up counts as read.
    await expect(ours.and(page.locator("[data-read=true]"))).toHaveCount(1);

    await page.getByRole("button", { name: "Označi sve kao pročitano" }).click();
    await expect(ours.and(page.locator("[data-read=false]"))).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Označi sve kao pročitano" })).toHaveCount(0);

    await ours
      .first()
      .getByRole("button", { name: /Ukloni obavještenje/ })
      .click();
    await expect(ours).toHaveCount(1);

    // Saved in the background: wait for both rows, one of them removed.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("notification_reads")
            .select("dismissed_at")
            .in(
              "item_key",
              alerts.map((id) => `alert:${id}`),
            );
          return (data ?? []).map((row) => row.dismissed_at !== null).sort();
        },
        { timeout: 30_000 },
      )
      .toEqual([false, true]);

    // Clicking an item opens it.
    await ours.first().getByRole("menuitem").click();
    await expectPath(page, "/attendance");

    // After a reload the removed item stays away and nothing pops up again.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(popups).toHaveCount(0);
    await bell.click();
    await expect(ours).toHaveCount(1);
  } finally {
    await admin
      .from("notification_reads")
      .delete()
      .in(
        "item_key",
        alerts.map((id) => `alert:${id}`),
      );
    await admin.from("attendance_alerts").delete().in("id", alerts);
    await admin.from("attendance_sessions").delete().in("id", sessions);
  }
});
