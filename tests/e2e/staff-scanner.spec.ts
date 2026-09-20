import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

test("scanner auth : la page et l'API refusent une session absente", async ({ page, request }) => {
  await page.goto("/s");
  await expect(page).toHaveURL(/\/login$/);

  const response = await request.post("/api/scan", {
    headers: { origin },
    data: { token: `LOY1:${"A".repeat(20)}` },
  });
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
});

test("équipe pilote : un Owner crée un Employé scanner qui se connecte et crédite une carte", async ({ page }) => {
  test.setTimeout(60_000);
  await createMerchant(page, "staff-scanner");
  const { shortCode } = await enrollCustomer(
    page,
    "Client test caisse",
    `${unique("staff-card")}@example.com`,
  );

  const employeeEmail = `${unique("staff-scanner")}@example.com`;
  const employeePassword = "Password-test-123!";
  await page.goto("/dashboard/employees");
  await page.getByLabel("Email").fill(employeeEmail);
  await page.getByLabel("Mot de passe temporaire").fill(employeePassword);
  await page.getByLabel("Rôle").selectOption("EMPLOYEE");
  await page.getByRole("button", { name: "Créer l’accès" }).click();
  await expect(page.getByText("Employé créé.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(employeeEmail) })).toContainText("Employé");

  // Le poste Owner et le téléphone caisse sont deux sessions indépendantes :
  // la connexion Employé ne doit ni réutiliser ni révoquer le cookie Owner.
  const employeeContext = await page.context().browser()!.newContext();
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(employeePassword);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/s$/);

    // Chromium CI n'a pas de caméra. Le refus simulé doit conserver le parcours
    // caisse manuel, puis l'Employé doit pouvoir scanner/créditer sans droits admin.
    await employeePage.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          throw new DOMException("No camera in CI", "NotFoundError");
        },
      });
    });
    await employeePage.goto("/s");
    await expect(employeePage.getByText("Aucune caméra disponible")).toBeVisible();
    await employeePage.getByPlaceholder("Code court ou email").fill(shortCode);
    await employeePage.getByRole("button", { name: "Chercher" }).click();
    await expect(employeePage.getByText("0 / 10 tampons")).toBeVisible();
    await employeePage.getByRole("button", { name: "+1 tampon" }).click();
    await expect(employeePage.getByText("+1 validé")).toBeVisible();

    await employeePage.goto("/s/stats");
    await expect(employeePage.getByRole("heading", { name: "Latence scanner" })).toBeVisible();
  } finally {
    await employeeContext.close();
  }
});
