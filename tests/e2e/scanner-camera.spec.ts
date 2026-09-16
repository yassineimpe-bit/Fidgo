import { expect, test } from "@playwright/test";
import { createMerchant } from "./helpers";

test("scanner : erreurs caméra précises et saisie manuelle toujours disponible", async ({ page }) => {
  await createMerchant(page, "camera-errors");
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        attempts += 1;
        throw new DOMException(
          attempts === 1 ? "Permission refused for test" : "Camera busy for test",
          attempts === 1 ? "NotAllowedError" : "NotReadableError",
        );
      },
    });
  });

  await page.goto("/s");
  await expect(page.getByText("Autorisation caméra refusée")).toBeVisible();
  await expect(page.getByPlaceholder("Code court ou email")).toBeVisible();

  await page.getByRole("button", { name: "Réessayer la caméra" }).click();
  await expect(page.getByText("Caméra déjà utilisée")).toBeVisible();
  await expect(page.getByPlaceholder("Code court ou email")).toBeVisible();
});
