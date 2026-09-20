import { expect, test } from "@playwright/test";
import { createMerchant, origin, unique } from "./helpers";

test("journal d'activité : un OWNER retrouve une action staff et peut la filtrer", async ({ page }) => {
  await createMerchant(page, "activity-log");
  const email = `${unique("activity-employee")}@example.com`;

  const created = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email, password: "Password-test-123!", role: "EMPLOYEE" },
  });
  expect(created.status()).toBe(201);

  await page.goto("/dashboard/analytics");
  await page.getByRole("link", { name: "Journal d’activité" }).click();
  await expect(page).toHaveURL(/\/dashboard\/activity/);
  await expect(page.getByText("Employé créé")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  await page.getByLabel("Action ou employé").fill(email);
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByLabel("Action ou employé").fill("introuvable");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page.getByText(/0 événement/)).toBeVisible();
  await expect(page.getByText("Aucune activité sur cette période.")).toBeVisible();
});
