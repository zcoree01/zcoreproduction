import { expect, test } from "@playwright/test";

test("home page renders in Bosnian", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "bs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Zcore Production");
  await expect(page.getByText("Sistem za upravljanje proizvodnjom")).toBeVisible();
});
