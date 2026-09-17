import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, origin, randomizeClientIp, unique } from "./helpers";

/**
 * Régressions du durcissement P0 pilote : ces scénarios reproduisent, sans
 * jamais toucher à la logique métier stable (caméra, wallet), les défaillances
 * réellement observées pendant l'audit (voir la PR pour le détail) plutôt que
 * de re-décrire le happy path déjà couvert ailleurs.
 */

test("dashboard : une perte réseau pendant l'enregistrement ne bloque jamais le bouton", async ({ page }) => {
  await createMerchant(page, "resilience-settings");
  await page.goto("/dashboard/settings");

  // Simule une coupure réseau precisement sur la requête de sauvegarde, sans
  // mocker la logique métier : la requête part réellement puis échoue au
  // niveau transport, exactement comme un téléphone qui perd le réseau en
  // plein service.
  await page.route("**/api/restaurant", (route) => route.abort("connectionfailed"));

  await page.getByLabel("Nom").fill(`Commerce ${unique("renamed")}`);
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Connexion perdue. Vérifie le réseau puis réessaie.")).toBeVisible();
  // Avant le correctif, l'absence de try/catch/finally laissait le bouton
  // bloqué sur "Enregistrement…" indéfiniment après un fetch() qui rejette.
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
});

test("scanner : un vrai 429 affiche le message de rate-limit dédié, pas le message technique générique", async ({ page }) => {
  await createMerchant(page, "resilience-429");

  // Épuise réellement le quota de /api/lookup (60/60s par staff) avant de
  // passer par l'UI. Le rate-limit inclut l'IP apparente de la requête
  // (lib/rate-limit.ts) : il faut passer par le fetch() de la page elle-même
  // (comme le fera le formulaire) plutôt que par page.request, qui ne
  // reprend pas les extra-headers (x-real-ip) posés par randomizeClientIp()
  // et retomberait sur un tout autre compartiment de quota.
  await page.evaluate(async () => {
    for (let i = 0; i < 61; i += 1) {
      await fetch(`/api/lookup?q=nonexistent-${i}`);
    }
  });

  await page.goto("/s");
  await page.getByPlaceholder("Code court ou email").fill("DOESNOTEXIST");
  await page.getByRole("button", { name: "Chercher" }).click();

  // Avant le correctif, RATE_LIMITED (le code réel renvoyé par
  // enforceRateLimit) n'avait pas d'entrée dans scannerErrorInfo et tombait
  // sur "Erreur technique. Réessaie ou recharge le scanner si le problème persiste."
  await expect(page.locator(".scan-error[role=alert]")).toHaveText("Trop de tentatives. Réessayez dans quelques instants.");
});

test("carte client : une carte révoquée pendant que l'onglet reste ouvert ne reste pas affichée comme utilisable", async ({ page, browser }) => {
  await createMerchant(page, "resilience-revoke");
  const marker = unique("revoke-client");
  const { cardUrl } = await enrollCustomer(page, "Client", `${marker}@example.com`);

  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  try {
    await randomizeClientIp(clientPage);
    await clientPage.goto(cardUrl);
    await expect(clientPage.getByText(/\d+ \/ \d+/)).toBeVisible();

    // Le commerçant ferme son établissement pendant que le client a toujours
    // sa carte ouverte (l'établissement doit être renseigné correctement).
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const suspend = await page.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: restaurant.slug },
    });
    expect(suspend.ok()).toBeTruthy();

    // Avant le correctif, refresh() ignorait silencieusement tout statut
    // non-2xx (`if (!response.ok) return;`) : le solde figé restait affiché
    // indéfiniment comme si la carte était toujours valide. Le prochain
    // sondage (toutes les 3 s) doit maintenant recharger la page.
    await expect(clientPage.getByText(/\d+ \/ \d+/)).toBeHidden({ timeout: 8000 });
  } finally {
    await clientContext.close();
  }
});
