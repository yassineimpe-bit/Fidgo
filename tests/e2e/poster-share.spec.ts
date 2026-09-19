import { expect, test } from "@playwright/test";
import { createMerchant } from "./helpers";

test("affiche QR : téléchargement et lien d'inscription sont disponibles", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createMerchant(page, "poster-share");
  await page.goto("/dashboard/poster");

  const download = page.getByRole("link", { name: "Télécharger le QR" });
  await expect(download).toHaveAttribute("href", /^data:image\/png;base64,/);
  await expect(download).toHaveAttribute("download", /^retiko-.+-qr\.png$/);

  await page.getByRole("button", { name: "Copier le lien" }).click();
  await expect(page.getByRole("status")).toHaveText("Lien copié.");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toMatch(/^http:\/\/127\.0\.0\.1:3000\/j\//);
});
