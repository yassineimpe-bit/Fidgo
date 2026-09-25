import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { createMerchant, origin, unique } from "./helpers";
import { buildPilotFieldReport, validateScanMetricsExport } from "../../lib/pilot-field-report.mjs";

const EXPORT_METRIC_KEYS = new Set(["phase", "action", "source", "networkMs", "serverMs", "totalMs", "ok", "at", "errorCode"]);

function metricValue(page: Page, label: string) {
  return page.locator(".metric", { hasText: label }).locator("strong");
}

async function downloadExport(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter les mesures" }).click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), "utf8");
  return { filename: download.suggestedFilename(), text };
}

test("stats pilote : 30 actions QR calculent p50/p90/p95/max, l'export ne sort que des mesures", async ({ page }) => {
  await createMerchant(page, "scan-stats");

  const at = (offset: number) => new Date(Date.now() + offset).toISOString();
  const metrics: Record<string, unknown>[] = Array.from({ length: 30 }, (_, index) => ({
    phase: "action",
    action: "credit",
    source: "qr",
    networkMs: 300 + index,
    serverMs: 100 + index,
    totalMs: 1_000 + index * 10,
    ok: true,
    at: at(index),
  }));
  // Chaque intrus ci-dessous ferait mentir le p95 officiel s'il était retenu.
  metrics.push({ phase: "action", action: "credit", source: "qr", networkMs: 9_999, serverMs: 9_999, totalMs: 9_999, ok: false, at: at(40), errorCode: "NETWORK_ERROR" });
  metrics.push({ phase: "lookup", source: "qr", networkMs: 50, serverMs: 20, totalMs: 60_000, ok: true, at: at(41) });
  metrics.push({ phase: "action", action: "credit", source: "manual", networkMs: 1, serverMs: 1, totalMs: 1, ok: true, at: at(42) });
  metrics.push({ phase: "action", action: "credit", networkMs: 1, serverMs: 1, totalMs: 1, ok: true, at: at(43) });
  metrics.push({
    phase: "lookup",
    source: "manual",
    networkMs: 5,
    serverMs: 5,
    totalMs: 10,
    ok: true,
    at: at(44),
    token: "LOY1:abcdefghijklmnopqrstuvwxyz012345",
    email: "camille@example.com",
    phone: "+33612345678",
    firstName: "Camille",
  });

  await page.evaluate((storedMetrics) => {
    localStorage.setItem("loyalty_scan_metrics", JSON.stringify(storedMetrics));
  }, metrics);
  await page.goto("/s/stats");

  await expect(metricValue(page, "actions QR validées")).toHaveText("30");
  await expect(metricValue(page, "p50 détection")).toHaveText("1140 ms");
  await expect(metricValue(page, "p90 détection")).toHaveText("1260 ms");
  await expect(metricValue(page, "p95 détection")).toHaveText("1280 ms");
  await expect(metricValue(page, "max détection")).toHaveText("1290 ms");
  await expect(metricValue(page, "p95 QR → fiche client")).toHaveText("60000 ms");
  await expect(metricValue(page, "p95 réseau")).toHaveText("328 ms");
  await expect(metricValue(page, "p95 serveur")).toHaveText("128 ms");
  await expect(page.getByText("1 échec(s) QR enregistré(s)")).toBeVisible();
  await expect(page.getByText("2 mesure(s) via saisie manuelle")).toBeVisible();
  await expect(page.getByText(/1 mesure\(s\) enregistrée\(s\) par une version précédente/)).toBeVisible();
  await expect(page.getByText("DÉCISION PRODUIT ENCORE REQUISE : seuil officiel final = 2000 ou 2500 ms.")).toBeVisible();

  // Pixel 7 : l'appareil est présélectionné sans rien conserver de l'user-agent.
  await expect(page.getByRole("radio", { name: "Android" })).toBeChecked();
  const android = await downloadExport(page);
  expect(android.filename).toBe("android.json");
  for (const forbidden of ["LOY1", "camille", "Camille", "+33", "@", "token", "email", "phone", "firstName"]) {
    expect(android.text).not.toContain(forbidden);
  }
  const parsed = JSON.parse(android.text);
  const validation = validateScanMetricsExport(parsed, { expectedDevice: "android" });
  expect(validation.ok).toBe(true);
  expect(parsed).toMatchObject({ format: "retiko-scan-metrics", version: 1, device: "android", storageLimit: 200, storedCount: 35 });
  expect(parsed.metrics).toHaveLength(35);
  for (const metric of parsed.metrics) {
    for (const key of Object.keys(metric)) expect(EXPORT_METRIC_KEYS.has(key)).toBe(true);
  }
  expect(parsed.metrics[33].source).toBe("unknown");
  expect(parsed.metrics[30]).toMatchObject({ ok: false, errorCode: "NETWORK_ERROR" });

  // Un seul téléphone ne suffit jamais : le rapport combiné reste incomplet.
  if (validation.ok) {
    const report = buildPilotFieldReport({ exports: { android: validation.value } });
    expect(report.verdict.status).toBe("INCOMPLETE");
  }

  await page.getByRole("radio", { name: "iPhone" }).check();
  const iphone = await downloadExport(page);
  expect(iphone.filename).toBe("iphone.json");
  expect(JSON.parse(iphone.text).device).toBe("iphone");

  // Repli si le presse-papiers est refusé (PWA iOS) : JSON sélectionnable.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.getByRole("button", { name: "Copier le JSON" }).click();
  const manual = page.getByRole("textbox", { name: "JSON des mesures" });
  await expect(manual).toBeVisible();
  const manualExport = validateScanMetricsExport(JSON.parse(await manual.inputValue()), { expectedDevice: "iphone" });
  expect(manualExport.ok).toBe(true);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Effacer les mesures" }).click();
  await expect(metricValue(page, "actions QR validées")).toHaveText("30");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Effacer les mesures" }).click();
  await expect(metricValue(page, "actions QR validées")).toHaveText("0");
  await expect(metricValue(page, "p95 détection")).toHaveText("—");
  expect(await page.evaluate(() => localStorage.getItem("loyalty_scan_metrics"))).toBeNull();
});

test("scanner : un QR lu par la caméra compte pour le gate, la saisie manuelle en reste exclue", async ({ page }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "scan-source");

  const program = await page.request.get("/api/program").then((response) => response.json());
  const programUpdate = await page.request.patch("/api/program", {
    headers: { origin },
    data: {
      programName: program.program_name,
      mode: "STAMPS",
      pointsRule: "PER_PURCHASE",
      rewardThreshold: 10,
      rewardLabel: program.reward_label,
      cardMessage: program.card_message,
      stampsPerVisit: 1,
      pointsPerPurchase: 10,
      pointsPerEuro: 1,
      dailyEarnLimit: 0,
      cooldownSeconds: 0,
      expiresAfterDays: null,
    },
  });
  expect(programUpdate.ok()).toBeTruthy();

  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  const customerEmail = `${unique("scan-source")}@example.com`;
  const enrollment = await page.request.post("/api/enroll", {
    headers: { origin },
    data: { slug: restaurant.slug, firstName: "Source", email: customerEmail, marketingConsent: false },
  });
  expect(enrollment.status()).toBe(201);
  const { token } = await enrollment.json();
  const qrDataUrl = await QRCode.toDataURL(`LOY1:${token}`, { width: 360, margin: 4, errorCorrectionLevel: "M" });

  // Caméra simulée : un canvas qui filme le QR de la carte, décodé par le
  // vrai qr-scanner de la page (même chemin que sur un téléphone).
  await page.addInitScript((qr) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    const image = new Image();
    image.src = qr;
    const draw = () => {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if ((window as typeof window & { __showQr?: boolean }).__showQr !== false && image.complete) {
        context.drawImage(image, 140, 60, 360, 360);
      }
    };
    window.setInterval(draw, 50);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        draw();
        return canvas.captureStream(20);
      },
    });
  }, qrDataUrl);

  await page.goto("/s");
  await expect(page.getByText("0 / 10 tampons")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => { (window as typeof window & { __showQr?: boolean }).__showQr = false; });
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  await expect(page.getByPlaceholder("Code court ou email")).toBeVisible();
  await page.getByPlaceholder("Code court ou email").fill(customerEmail);
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("1 / 10 tampons")).toBeVisible();
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("loyalty_scan_metrics") || "[]"));
  expect(stored.map((metric: { phase: string; source: string; ok: boolean }) => `${metric.phase}:${metric.source}:${metric.ok}`)).toEqual([
    "lookup:qr:true",
    "action:qr:true",
    "lookup:manual:true",
    "action:manual:true",
  ]);

  await page.goto("/s/stats");
  await expect(metricValue(page, "actions QR validées")).toHaveText("1");
  await expect(page.getByText("2 mesure(s) via saisie manuelle")).toBeVisible();
});
