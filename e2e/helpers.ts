import { expect, type Page } from "@playwright/test";

export async function login(
  page: Page,
  user: { username: string; password: string },
  org: string | null,
) {
  await page.goto(org ? `/login?org=${org}` : "/login");
  await page.getByLabel("Korisničko ime").fill(user.username);
  await page.getByLabel("Lozinka").fill(user.password);
  await page.getByRole("button", { name: "Prijavi se" }).click();
}

export async function expectPath(page: Page, path: string) {
  await expect(page).toHaveURL((url) => url.pathname === path);
}
