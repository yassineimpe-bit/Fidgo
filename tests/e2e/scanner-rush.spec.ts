import { expect, test, type Page } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

// Inscription + premières compilations à la demande du serveur de dev (lookup, scan, credit).
test.describe.configure({ timeout: 60_000 });

async function merchantWithCard(page: Page, label: string) {
  await createMerchant(page, label);
  return enrollCustomer(page, "Rush", `${unique(`${label}-client`)}@example.com`);
}

test("scanner rush : succès confirmé par le serveur, boutons verrouillés puis retour caméra", async ({ page }) => {
  const { shortCode } = await merchantWithCard(page, "rush-success");
  await openCardInScanner(page, shortCode);

  await page.getByRole("button", { name: "+1 tampon" }).click();
  const banner = page.locator(".scan-feedback[data-tone=success]");
  await expect(banner).toContainText("+1 validé", { timeout: 15_000 });
  await expect(banner).toContainText("Confirmé par le serveur");
  await expect(banner.locator("svg")).toHaveCount(1);
  // Plus aucun bouton d'action tant que l'écran n'est pas revenu à la caméra.
  await expect(page.getByRole("button", { name: "+1 tampon" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scanner le client suivant" })).toBeVisible();
  // Retour automatique à l'écran de scan (ici sans caméra : saisie manuelle).
  await expect(page.getByPlaceholder("Code court ou email")).toBeVisible({ timeout: 4_000 });
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scanner le client suivant" })).toHaveCount(0);
});

test("scanner rush : réseau lent annoncé, aucun succès avant la réponse", async ({ page }) => {
  const { shortCode } = await merchantWithCard(page, "rush-slow");
  await openCardInScanner(page, shortCode);

  await page.route("**/api/credit", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await page.getByRole("button", { name: "+1 tampon" }).click();
  const pending = page.locator(".scan-feedback[data-tone=pending]");
  await expect(pending).toContainText("Envoi du crédit…");
  await expect(pending).toContainText("Rien n’est validé tant que ce message est affiché");
  await expect(page.getByRole("button", { name: "+1 tampon" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Utiliser récompense" })).toBeDisabled();
  await expect(page.getByText("+1 validé")).toHaveCount(0);

  await expect(page.getByText("+1 validé")).toBeVisible({ timeout: 15_000 });
  await expect(pending).toHaveCount(0);
});

test("scanner rush : coupure réseau non confirmée, relance sans doublon", async ({ page }) => {
  const { shortCode } = await merchantWithCard(page, "rush-offline");
  await openCardInScanner(page, shortCode);

  await page.route("**/api/credit", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "+1 tampon" }).click();
  const failure = page.locator(".scan-feedback[data-tone=network]");
  await expect(failure).toContainText("Non confirmé");
  await expect(failure.locator(".scan-error[role=alert]")).toContainText("n’a pas été confirmée");
  await expect(page.getByText("+1 validé")).toHaveCount(0);

  await page.unroute("**/api/credit");
  await page.getByRole("button", { name: "Réessayer sans doublon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible({ timeout: 15_000 });

  // Un seul crédit enregistré malgré la relance.
  await page.waitForTimeout(1_400);
  await openCardInScanner(page, shortCode);
  await expect(page.getByText("1 / 10 tampons")).toBeVisible();
});

test("scanner rush : carte inconnue, son coupé par défaut, pas de torche fantôme", async ({ page }) => {
  await createMerchant(page, "rush-states");
  await page.goto("/s");

  // Son : coupé tant que le poste ne l'active pas, choix mémorisé sur l'appareil.
  const sound = page.getByRole("button", { name: /^Son/ });
  await expect(sound).toHaveText("Son coupé");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveText("Son activé");
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Son/ })).toHaveText("Son activé");

  // Le navigateur de test ne pilote aucune torche : aucun bouton affiché.
  await expect(page.getByRole("button", { name: /Torche/ })).toHaveCount(0);

  await page.getByPlaceholder("Code court ou email").fill("ZZZZZZ");
  await page.getByRole("button", { name: "Chercher" }).click();
  const unknown = page.locator(".scan-feedback[data-tone=wrong-card]");
  await expect(unknown).toContainText("Carte inconnue ici");
  await expect(unknown.locator("svg")).toHaveCount(1);
});

for (const width of [320, 390, 430]) {
  test(`scanner rush : fiche utilisable à ${width} px, cibles tactiles ≥ 44 px`, async ({ page }) => {
    const { shortCode } = await merchantWithCard(page, `rush-${width}`);
    await page.setViewportSize({ width, height: 640 });
    await openCardInScanner(page, shortCode);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const target of [
      page.getByRole("button", { name: "+1 tampon" }),
      page.getByRole("button", { name: "Utiliser récompense" }),
      page.getByRole("button", { name: "Annuler" }),
      page.getByRole("button", { name: /^Son/ }),
      page.getByRole("link", { name: "Stats" }),
    ]) {
      await expect(target).toBeVisible();
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
}
