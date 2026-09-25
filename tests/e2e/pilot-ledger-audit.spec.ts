import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { buildScanMetricsExport } from "../../lib/pilot-field-report.mjs";
import type { ScannerDevice } from "../../lib/pilot-gate.mjs";
import { createMerchant, origin, unique } from "./helpers";

function writeExport(dir: string, device: ScannerDevice, times: string[]) {
  const metrics = times.flatMap((at) => [
    { phase: "lookup", source: "qr", networkMs: 120, serverMs: 30, totalMs: 350, ok: true, at },
    { phase: "action", action: "credit", source: "qr", networkMs: 150, serverMs: 40, totalMs: 1_100, ok: true, at },
  ]);
  const file = path.join(dir, `${device}.json`);
  writeFileSync(file, JSON.stringify(buildScanMetricsExport(metrics, { device, exportedAt: new Date().toISOString(), storageLimit: 200 })));
  return file;
}

test("preuve serveur : le rapprochement lecture seule concorde puis détecte un crédit hors série", async ({ page }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "ledger-audit");

  const program = await page.request.get("/api/program").then((response) => response.json());
  const programUpdate = await page.request.patch("/api/program", {
    headers: { origin },
    data: {
      programName: program.program_name,
      mode: "STAMPS",
      pointsRule: "PER_PURCHASE",
      rewardThreshold: 100,
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
  const tokens: string[] = [];
  for (const label of ["carte-android", "carte-iphone"]) {
    const enrollment = await page.request.post("/api/enroll", {
      headers: { origin },
      data: { slug: restaurant.slug, firstName: label, email: `${unique(label)}@example.com`, marketingConsent: false },
    });
    expect(enrollment.status()).toBe(201);
    tokens.push(String((await enrollment.json()).token));
  }

  async function credit(token: string) {
    const response = await page.request.post("/api/credit", { headers: { origin }, data: { token, idempotencyKey: crypto.randomUUID() } });
    expect(response.ok()).toBeTruthy();
    return new Date().toISOString();
  }

  // L'iPhone scanne la carte Android, l'Android scanne la carte iPhone.
  const iphoneTimes = [await credit(tokens[0]), await credit(tokens[0]), await credit(tokens[0])];
  const androidTimes = [await credit(tokens[1]), await credit(tokens[1])];

  const dir = mkdtempSync(path.join(tmpdir(), "ledger-audit-e2e-"));
  try {
    const iphone = writeExport(dir, "iphone", iphoneTimes);
    const android = writeExport(dir, "android", androidTimes);
    const json = path.join(dir, "rapprochement.json");
    const audit = () => spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts", "pilot-ledger-audit.mjs"),
      "--establishment", restaurant.slug,
      "--iphone", iphone,
      "--android", android,
      "--json-output", json,
    ], { env: process.env, encoding: "utf8" });

    const consistent = audit();
    expect(consistent.stderr).toBe("");
    expect(consistent.status).toBe(0);
    expect(consistent.stdout).toContain("RAPPROCHEMENT : COHÉRENT");
    const report = JSON.parse(readFileSync(json, "utf8"));
    expect(report.readOnly).toBe(true);
    expect(report.plan.reduce((total: number, window: { expected: { earn: number } }) => total + window.expected.earn, 0)).toBe(5);
    expect(report.observations.windows.reduce((total: number, window: { earn: number }) => total + window.earn, 0)).toBe(5);
    expect(report.observations.cards).toEqual({ total: 2, negativeBalances: 0, ledgerMismatches: 0 });

    // Un crédit que les téléphones n'ont pas enregistré doit être signalé.
    await credit(tokens[0]);
    const extra = audit();
    expect(extra.status).toBe(1);
    expect(extra.stdout).toContain("RAPPROCHEMENT : À ANALYSER");
    expect(extra.stdout).toMatch(/crédit\(s\) en base pour \d+ action\(s\) de crédit réussie\(s\) — écriture en trop/);

    const unknown = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts", "pilot-ledger-audit.mjs"),
      "--establishment", "commerce-inexistant-0000",
      "--iphone", iphone,
    ], { env: process.env, encoding: "utf8" });
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("aucun commerce avec le slug");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
