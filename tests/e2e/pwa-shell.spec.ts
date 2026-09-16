import { expect, test } from "@playwright/test";

test("PWA : manifeste installable, icônes et fallback hors-ligne neutre", async ({ page, request }) => {
  const documentResponse = await request.get("/login");
  const csp = documentResponse.headers()["content-security-policy"];
  expect(csp).toContain("worker-src 'self' blob:");
  expect(documentResponse.headers()["permissions-policy"]).toContain("camera=(self)");

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
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" }),
  ]));

  for (const icon of ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
    const response = await request.get(icon);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image/png");
  }

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.text();
  expect(worker).toContain("retiko-shell-v3");
  expect(worker).toContain("/offline");
  expect(worker).toContain("/apple-touch-icon.png");

  // Le fallback de qr-scanner utilise exactement ce type de Worker blob sur
  // Safari iOS, où BarcodeDetector n'est pas disponible.
  await page.goto("/login");
  const workerResult = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const source = URL.createObjectURL(new Blob(["postMessage('worker-ready')"], { type: "application/javascript" }));
    const decoderWorker = new Worker(source);
    const timeout = window.setTimeout(() => reject(new Error("Blob worker timeout")), 3_000);
    decoderWorker.onmessage = (event) => {
      window.clearTimeout(timeout);
      decoderWorker.terminate();
      URL.revokeObjectURL(source);
      resolve(String(event.data));
    };
    decoderWorker.onerror = (event) => reject(new Error(event.message));
  }));
  expect(workerResult).toBe("worker-ready");

  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Connexion indisponible" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revenir au scanner" })).toHaveAttribute("href", "/s");
});
