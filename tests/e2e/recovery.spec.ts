import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

/**
 * /api/recovery/request ne doit jamais laisser deviner si une adresse est
 * associée à une carte : même statut, même corps de réponse, qu'une carte
 * existe ou non.
 */
test("récupération de carte : réponse identique qu'une carte existe ou non", async ({ page }) => {
  await createMerchant(page, "recovery");
  const slugCode = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  const slug = slugCode?.replace("/j/", "").trim();
  expect(slug).toBeTruthy();

  const realEmail = `${unique("client")}@example.com`;
  await enrollCustomer(page, "Alix", realEmail);

  const withCard = await page.request.post("/api/recovery/request", {
    headers: { origin },
    data: { slug, email: realEmail },
  });
  const withoutCard = await page.request.post("/api/recovery/request", {
    headers: { origin },
    data: { slug, email: `${unique("nobody")}@example.com` },
  });

  expect(withCard.status()).toBe(withoutCard.status());
  expect(await withCard.json()).toEqual(await withoutCard.json());
});
