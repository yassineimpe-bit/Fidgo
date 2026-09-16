import { expect, test } from "@playwright/test";

test("PWA : manifeste installable et fallback hors-ligne neutre", async ({ page, request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "Retiko",
    short_name: "Retiko",
    start_url: "/s",
    scope: "/",
    display: "standalone",
  });

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.text();
  expect(worker).toContain("retiko-shell-v2");
  expect(worker).toContain("/offline");

  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Connexion indisponible" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revenir au scanner" })).toHaveAttribute("href", "/s");
});
