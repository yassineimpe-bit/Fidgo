import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildScanMetricsExport } from "@/lib/pilot-field-report.mjs";
import type { ScannerDevice } from "@/lib/pilot-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "pilot-field-report.mjs");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pilot-field-report-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeExport(name: string, device: ScannerDevice, totals: number[], patch: Record<string, unknown> = {}) {
  const metrics = totals.flatMap((totalMs, index) => {
    const at = new Date(Date.UTC(2026, 8, 30, 10, index * 3)).toISOString();
    return [
      { phase: "lookup", source: "qr", networkMs: 150, serverMs: 40, totalMs: 400, ok: true, at },
      { phase: "action", action: "credit", source: "qr", networkMs: 200, serverMs: 50, totalMs, ok: true, at },
    ];
  });
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify({ ...buildScanMetricsExport(metrics, { device, exportedAt: "2026-09-30T11:00:00.000Z", storageLimit: 200 }), ...patch }));
  return file;
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const fifteen = (start: number) => Array.from({ length: 15 }, (_, index) => start + index * 20);

describe("npm run pilot:field-report", () => {
  it("produit le rapport, le Markdown et le JSON archivables, code 0 sur GO", () => {
    const iphone = writeExport("iphone.json", "iphone", fifteen(1_000));
    const android = writeExport("android.json", "android", fifteen(1_300));
    const markdown = path.join(dir, "pilot-result.md");
    const json = path.join(dir, "pilot-result.json");

    const result = run("--iphone", iphone, "--android", android, "--markdown-output", markdown, "--json-output", json);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("VERDICT : GO — p95 = 1560 ms (N = 30)");
    expect(result.stdout).toContain("Ce rapport prouve les mesures client/performance. Il ne prouve pas à lui seul l'intégrité du ledger serveur.");

    const archived = readFileSync(markdown, "utf8");
    expect(archived).toContain("| **Verdict** | **GO** —");
    // Seuls les noms de fichiers sont archivés, jamais le chemin local.
    expect(archived).not.toContain(dir);
    const report = JSON.parse(readFileSync(json, "utf8"));
    expect(report.verdict.status).toBe("GO");
    expect(report.devices.iphone.file).toBe("iphone.json");
    expect(report.combined.stats).toEqual({ n: 30, p50: 1280, p90: 1520, p95: 1560, max: 1580 });
  });

  it("code 1 et NO-GO / INCOMPLET avec 29 actions ou un seul export", () => {
    const iphone = writeExport("iphone.json", "iphone", fifteen(1_000));
    const android = writeExport("android.json", "android", fifteen(1_300).slice(0, 14));
    const markdown = path.join(dir, "incomplet.md");

    const incomplete = run("--iphone", iphone, "--android", android, "--markdown-output", markdown);
    expect(incomplete.status).toBe(1);
    expect(incomplete.stdout).toContain("VERDICT : NO-GO / INCOMPLET");
    expect(readFileSync(markdown, "utf8")).toContain("**NO-GO / INCOMPLET**");

    const alone = run("--iphone", iphone);
    expect(alone.status).toBe(1);
    expect(alone.stdout).toContain("Export Android manquant");
  });

  it("code 1 quand le p95 dépend du seuil encore à décider", () => {
    const iphone = writeExport("iphone.json", "iphone", fifteen(1_000));
    const android = writeExport("android.json", "android", [...fifteen(1_300).slice(0, 13), 2_100, 2_400]);
    const result = run("--iphone", iphone, "--android", android);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VERDICT : DÉCISION PRODUIT REQUISE — p95 = 2100 ms");
  });

  it("rejette un JSON invalide sans produire de rapport (code 2)", () => {
    const iphone = writeExport("iphone.json", "iphone", fifteen(1_000));
    const broken = path.join(dir, "android.json");
    writeFileSync(broken, '{"format":"retiko-scan-metrics","version":1,');
    const markdown = path.join(dir, "rapport.md");

    const result = run("--iphone", iphone, "--android", broken, "--markdown-output", markdown);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("export --android rejeté");
    expect(result.stderr).toContain("JSON invalide");
    expect(result.stdout).toBe("");
    expect(existsSync(markdown)).toBe(false);
  });

  it("rejette une version inconnue, des valeurs négatives et des fichiers inversés (code 2)", () => {
    const iphone = writeExport("iphone.json", "iphone", fifteen(1_000));
    const future = writeExport("future.json", "android", fifteen(1_300), { version: 2 });
    expect(run("--iphone", iphone, "--android", future).stderr).toContain("version d'export inconnue : 2");

    // Fichier retouché à la main : le navigateur n'exporte jamais une durée négative.
    const negative = writeExport("negative.json", "android", fifteen(1_300));
    const tampered = JSON.parse(readFileSync(negative, "utf8"));
    tampered.metrics[29].totalMs = -1;
    writeFileSync(negative, JSON.stringify(tampered));
    const rejected = run("--iphone", iphone, "--android", negative);
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain("totalMs : nombre fini ≥ 0 attendu (reçu -1)");

    const android = writeExport("android.json", "android", fifteen(1_300));
    const swapped = run("--iphone", android, "--android", iphone);
    expect(swapped.status).toBe(2);
    expect(swapped.stderr).toContain("fichiers inversés");
  });

  it("refuse d'écraser un export d'entrée et signale les arguments invalides", () => {
    const iphone = writeExport("iphone.json", "iphone", fifteen(1_000));
    const android = writeExport("android.json", "android", fifteen(1_300));
    const before = readFileSync(android, "utf8");
    const overwrite = run("--iphone", iphone, "--android", android, "--json-output", android);
    expect(overwrite.status).toBe(2);
    expect(readFileSync(android, "utf8")).toBe(before);

    expect(run().status).toBe(2);
    expect(run().stderr).toContain("fournir au moins un export");
    expect(run("--ipone", iphone).status).toBe(2);
    expect(run("--iphone", path.join(dir, "absent.json")).stderr).toContain("fichier introuvable");
    const help = run("--help");
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--iphone <iphone.json> --android <android.json>");
  });
});
