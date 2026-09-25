import { describe, expect, it } from "vitest";
import {
  CLIENT_PROOF_DISCLAIMER,
  buildPilotFieldReport,
  buildScanMetricsExport,
  nearestRank,
  nearestRankPosition,
  parseScanMetricsExport,
  renderPilotFieldReportMarkdown,
  renderPilotFieldReportText,
  sanitizeScanMetric,
  summarizeDurations,
  validateScanMetricsExport,
  type PilotFieldReport,
  type ScanMetricsExport,
} from "@/lib/pilot-field-report.mjs";
import type { ScannerDevice } from "@/lib/pilot-gate.mjs";

const BASE_TIME = Date.UTC(2026, 8, 30, 10, 0, 0);

type RawMetric = Record<string, unknown>;

function at(minutes: number) {
  return new Date(BASE_TIME + minutes * 60_000).toISOString();
}

function action(totalMs: number, overrides: RawMetric = {}): RawMetric {
  return { phase: "action", action: "credit", source: "qr", networkMs: 200, serverMs: 50, totalMs, ok: true, at: at(0), ...overrides };
}

function lookup(totalMs: number, overrides: RawMetric = {}): RawMetric {
  return { phase: "lookup", source: "qr", networkMs: 150, serverMs: 40, totalMs, ok: true, at: at(0), ...overrides };
}

/** Série réaliste : un lookup puis une action par scan, 3 minutes d'écart (cooldown). */
function series(totals: number[]): RawMetric[] {
  return totals.flatMap((totalMs, index) => [lookup(400, { at: at(index * 3) }), action(totalMs, { at: at(index * 3) })]);
}

function exportOf(device: ScannerDevice, metrics: unknown[], storageLimit = 200): ScanMetricsExport {
  return buildScanMetricsExport(metrics, { device, exportedAt: at(120), storageLimit });
}

function range(count: number, start: number, step: number) {
  return Array.from({ length: count }, (_, index) => start + index * step);
}

function report(iphone: unknown[] | null, android: unknown[] | null, extra: Parameters<typeof buildPilotFieldReport>[0] = {}) {
  return buildPilotFieldReport({
    exports: {
      ...(iphone ? { iphone: exportOf("iphone", iphone) } : {}),
      ...(android ? { android: exportOf("android", android) } : {}),
    },
    files: { iphone: "iphone.json", android: "android.json" },
    generatedAt: at(180),
    ...extra,
  });
}

// "NO-GO" contient "GO" : seul un GO autonome signifierait un feu vert.
const STANDALONE_GO = /(?<![-\w])GO(?![-\w])/;

function expectNoGo(result: PilotFieldReport) {
  expect(result.verdict.status).not.toBe("GO");
  expect(renderPilotFieldReportText(result)).not.toMatch(STANDALONE_GO);
  expect(renderPilotFieldReportMarkdown(result)).not.toMatch(STANDALONE_GO);
}

describe("nearest-rank", () => {
  it("calcule le rang R = ceil(p × N)", () => {
    expect(nearestRankPosition(30, 50)).toBe(15);
    expect(nearestRankPosition(30, 90)).toBe(27);
    expect(nearestRankPosition(30, 95)).toBe(29);
    expect(nearestRankPosition(30, 100)).toBe(30);
    expect(nearestRankPosition(1, 95)).toBe(1);
    expect(nearestRankPosition(29, 95)).toBe(28);
    expect(nearestRankPosition(31, 95)).toBe(30);
  });

  it("n'est jamais faussé par l'arrondi flottant", () => {
    // 0.07 × 100 = 7.000000000000001 et 0.95 × 20 donnerait un rang de trop.
    expect(nearestRankPosition(100, 7)).toBe(7);
    expect(nearestRankPosition(20, 95)).toBe(19);
    for (let count = 1; count <= 400; count += 1) {
      for (let percent = 1; percent <= 100; percent += 1) {
        const exact = Number((BigInt(percent * count) + 99n) / 100n);
        expect(nearestRankPosition(count, percent)).toBe(exact);
      }
    }
  });

  it("refuse un percentile ou un effectif invalide", () => {
    expect(() => nearestRankPosition(0, 95)).toThrow(RangeError);
    expect(() => nearestRankPosition(2.5, 95)).toThrow(RangeError);
    expect(() => nearestRankPosition(30, 0)).toThrow(RangeError);
    expect(() => nearestRankPosition(30, 101)).toThrow(RangeError);
    expect(() => nearestRankPosition(30, 95.5)).toThrow(RangeError);
  });

  it("sur exactement 30 valeurs, p95 est la 29e valeur triée et non une interpolation", () => {
    const sorted = range(30, 100, 100);
    const shuffled = [...sorted].reverse().sort((a, b) => (a % 700) - (b % 700));
    expect(nearestRank(shuffled, 50)).toBe(sorted[14]);
    expect(nearestRank(shuffled, 90)).toBe(sorted[26]);
    expect(nearestRank(shuffled, 95)).toBe(sorted[28]);
    expect(nearestRank(shuffled, 95)).toBe(2900);
    expect(nearestRank(shuffled, 100)).toBe(3000);
    expect(summarizeDurations(shuffled)).toEqual({ n: 30, p50: 1500, p90: 2700, p95: 2900, max: 3000 });
  });

  it("renvoie null sans valeur et rejette NaN, Infinity et les non-nombres", () => {
    expect(nearestRank([], 95)).toBeNull();
    expect(summarizeDurations([])).toEqual({ n: 0, p50: null, p90: null, p95: null, max: null });
    expect(() => nearestRank([1, Number.NaN], 95)).toThrow(TypeError);
    expect(() => nearestRank([1, Number.POSITIVE_INFINITY], 95)).toThrow(TypeError);
    expect(() => nearestRank([1, "2" as unknown as number], 95)).toThrow(TypeError);
  });
});

describe("export navigateur des mesures", () => {
  it("ne conserve que les champs de performance, sans donnée client ni secret", () => {
    // Android : le libellé « iphone » contiendrait lui-même la sous-chaîne « phone ».
    const exported = exportOf("android", [
      {
        ...action(1_200),
        token: "LOY1:abcdefghijklmnopqrstuvwxyz0123",
        email: "camille@example.com",
        phone: "+33612345678",
        firstName: "Camille",
        shortCode: "ABC123",
        customerId: "0f5c2b0e-1111-4a2b-9c3d-222222222222",
        userAgent: "Mozilla/5.0 (iPhone)",
      },
      { ...lookup(300), card: { token: "secret" } },
    ]);
    const json = JSON.stringify(exported);
    for (const forbidden of ["LOY1", "camille", "Camille", "@", "+33", "ABC123", "0f5c2b0e", "Mozilla", "token", "email", "phone", "shortCode", "customerId", "card"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(exported)).toEqual(["format", "version", "exportedAt", "device", "storageLimit", "storedCount", "metrics"]);
    expect(exported.metrics[0]).toEqual({
      phase: "action", action: "credit", source: "qr", networkMs: 200, serverMs: 50, totalMs: 1_200, ok: true, at: at(0),
    });
    expect(validateScanMetricsExport(exported, { expectedDevice: "android" }).ok).toBe(true);
  });

  it("marque les mesures sans origine et normalise les codes d'erreur", () => {
    const legacy = { phase: "action", action: "credit", networkMs: 1, serverMs: 1, totalMs: 1, ok: true, at: at(0) };
    expect(sanitizeScanMetric(legacy)?.source).toBe("unknown");
    expect(sanitizeScanMetric({ ...legacy, source: "camera" })?.source).toBe("unknown");
    expect(sanitizeScanMetric({ ...legacy, ok: false, errorCode: "COOLDOWN" })?.errorCode).toBe("COOLDOWN");
    expect(sanitizeScanMetric({ ...legacy, ok: false, errorCode: "UNEXPECTED TOKEN '<', \"<!DOCTYPE\"" })?.errorCode).toBe("ERROR");
    expect(sanitizeScanMetric({ ...legacy, ok: true, errorCode: "COOLDOWN" })).not.toHaveProperty("errorCode");
    expect(sanitizeScanMetric({ ...lookup(10), action: "credit" })).not.toHaveProperty("action");
  });

  it("écarte les entrées locales inexploitables et les compte", () => {
    const exported = exportOf("android", [
      action(1_000),
      action(-5),
      action(Number.NaN),
      action(Number.POSITIVE_INFINITY),
      { ...action(1_000), action: undefined },
      { ...action(1_000), phase: "scan" },
      { ...action(1_000), at: "hier" },
      { ...action(1_000), ok: "true" },
      null,
      "texte",
    ]);
    expect(exported.storedCount).toBe(10);
    expect(exported.metrics).toHaveLength(1);
    const result = buildPilotFieldReport({ exports: { android: exported } });
    expect(result.devices.android.present && result.devices.android.discardedCount).toBe(9);
  });

  it("refuse un appareil ou une date d'export invalide", () => {
    expect(() => buildScanMetricsExport([], { device: "ipad" as ScannerDevice, exportedAt: at(0), storageLimit: 200 })).toThrow();
    expect(() => buildScanMetricsExport([], { device: "iphone", exportedAt: "maintenant", storageLimit: 200 })).toThrow();
  });
});

describe("validation stricte des exports", () => {
  const valid = () => JSON.parse(JSON.stringify(exportOf("iphone", series([1_000, 1_100])))) as Record<string, unknown> & { metrics: RawMetric[] };

  function errorsOf(value: unknown, expectedDevice?: ScannerDevice) {
    const result = validateScanMetricsExport(value, { expectedDevice });
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.errors.join("\n");
  }

  it("accepte un export conforme, y compris vide ou précédé d'un BOM", () => {
    expect(parseScanMetricsExport(`﻿${JSON.stringify(valid())}`, { expectedDevice: "iphone" }).ok).toBe(true);
    expect(validateScanMetricsExport(exportOf("android", []), { expectedDevice: "android" }).ok).toBe(true);
  });

  it("rejette un JSON invalide", () => {
    const result = parseScanMetricsExport('{"version": 1, "metrics": [');
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors[0]).toMatch(/^JSON invalide/);
    expect(parseScanMetricsExport("").ok).toBe(false);
  });

  it("rejette une version inconnue ou absente sans interpréter le reste", () => {
    expect(errorsOf({ ...valid(), version: 2 })).toMatch(/version d'export inconnue : 2/);
    expect(errorsOf({ ...valid(), version: "1" })).toMatch(/version d'export inconnue/);
    const withoutVersion = valid();
    delete withoutVersion.version;
    expect(errorsOf(withoutVersion)).toMatch(/version d'export inconnue : absent/);
  });

  it("rejette tout fichier qui ne vient pas de /s/stats", () => {
    expect(errorsOf([])).toMatch(/objet JSON/);
    expect(errorsOf({ ...valid(), format: "autre" })).toMatch(/format/);
    expect(errorsOf({ ...valid(), note: "ajout manuel" })).toMatch(/note : champ inattendu/);
    expect(errorsOf({ ...valid(), metrics: {} })).toMatch(/metrics : tableau attendu/);
    expect(errorsOf({ ...valid(), storedCount: 1 })).toMatch(/2 mesures pour storedCount = 1|4 mesures pour storedCount = 1/);
    expect(errorsOf({ ...valid(), exportedAt: "30/09/2026" })).toMatch(/exportedAt/);
  });

  it("rejette les valeurs négatives, NaN, Infinity et non numériques", () => {
    const withTotal = (totalMs: unknown) => {
      const value = valid();
      value.metrics[1] = { ...value.metrics[1], totalMs };
      return value;
    };
    expect(errorsOf(withTotal(-1))).toMatch(/metrics\[1\]\.totalMs : nombre fini ≥ 0 attendu \(reçu -1\)/);
    expect(errorsOf(withTotal(Number.NaN))).toMatch(/reçu NaN/);
    expect(errorsOf(withTotal(Number.POSITIVE_INFINITY))).toMatch(/reçu Infinity/);
    expect(errorsOf(withTotal("1200"))).toMatch(/reçu "1200"/);
    // JSON.stringify(NaN) produit null : le fichier réel est rejeté aussi.
    expect(parseScanMetricsExport(JSON.stringify(withTotal(Number.NaN))).ok).toBe(false);
  });

  it("rejette les champs de mesure inconnus ou incohérents", () => {
    const withMetric = (patch: RawMetric) => {
      const value = valid();
      value.metrics[1] = { ...value.metrics[1], ...patch };
      return value;
    };
    expect(errorsOf(withMetric({ token: "LOY1:abcdefghijklmnopqrstuvwxyz" }))).toMatch(/metrics\[1\]\.token : champ inattendu/);
    expect(errorsOf(withMetric({ email: "a@b.c" }))).toMatch(/email : champ inattendu/);
    expect(errorsOf(withMetric({ action: "refund" }))).toMatch(/action : "credit" ou "redeem"/);
    expect(errorsOf(withMetric({ source: "camera" }))).toMatch(/source/);
    expect(errorsOf(withMetric({ ok: 1 }))).toMatch(/ok : booléen/);
    expect(errorsOf(withMetric({ at: "2026-09-30" }))).toMatch(/at : date ISO 8601/);
    expect(errorsOf(withMetric({ errorCode: "COOLDOWN" }))).toMatch(/errorCode : réservé aux mesures en échec/);
    expect(errorsOf(withMetric({ ok: false, errorCode: "cooldown" }))).toMatch(/errorCode : code technique/);
    const lookupWithAction = valid();
    lookupWithAction.metrics[0] = { ...lookupWithAction.metrics[0], action: "credit" };
    expect(errorsOf(lookupWithAction)).toMatch(/metrics\[0\]\.action : interdit/);
  });

  it("détecte des fichiers iPhone / Android inversés", () => {
    expect(errorsOf(valid(), "android")).toMatch(/étiqueté "iphone" fourni comme export android/);
  });

  it("borne la liste d'erreurs affichée", () => {
    const value = valid();
    value.metrics = Array.from({ length: 50 }, () => ({ phase: "action" }));
    value.storedCount = 50;
    const result = validateScanMetricsExport(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(21);
      expect(result.errors[20]).toMatch(/autre\(s\) erreur\(s\)/);
    }
  });
});

describe("rapport combiné du gate terrain", () => {
  const iphoneTotals = range(15, 1_000, 20);
  const androidTotals = range(15, 1_300, 20);

  it("fusionne 15 actions iPhone et 15 actions Android : N = 30, p95 au rang 29", () => {
    const result = report(series(iphoneTotals), series(androidTotals));
    const merged = [...iphoneTotals, ...androidTotals].sort((a, b) => a - b);
    expect(result.combined.officialActions).toBe(30);
    expect(result.combined.stats).toEqual({ n: 30, p50: merged[14], p90: merged[26], p95: merged[28], max: merged[29] });
    expect(result.combined.stats.p95).toBe(1_560);
    expect(result.combined.sorted[28]).toMatchObject({ rank: 29, totalMs: 1_560, device: "android" });
    expect(result.devices.iphone.present && result.devices.iphone.officialActions).toBe(15);
    expect(result.devices.android.present && result.devices.android.stats.p95).toBe(1_580);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.verdict.status).toBe("GO");
    const text = renderPilotFieldReportText(result);
    expect(text).toContain("VERDICT : GO");
    expect(text).toContain("p95 :   1560 ms  (rang 29)");
    expect(text).toContain("iPhone  : iphone.json");
  });

  it("affiche séparément les trois seuils et exige encore la décision produit", () => {
    const result = report(series(iphoneTotals), series(androidTotals));
    expect(result.thresholds.map((threshold) => [threshold.id, threshold.rule, threshold.pass])).toEqual([
      ["internal", "p95 ≤ 1500 ms", false],
      ["strict", "p95 ≤ 2000 ms", true],
      ["historical", "p95 < 2500 ms", true],
    ]);
    const text = renderPilotFieldReportText(result);
    expect(text).toMatch(/Cible interne \(p95 ≤ 1500 ms\)\s+: NON/);
    expect(text).toMatch(/Seuil renforcé \(p95 ≤ 2000 ms\)\s+: OUI/);
    expect(text).toMatch(/Seuil historique \(p95 < 2500 ms\)\s+: OUI/);
    expect(text).toContain("DÉCISION PRODUIT ENCORE REQUISE : seuil officiel final = 2000 ou 2500 ms");
  });

  it("ne tranche pas entre 2000 et 2500 ms tant que la décision est en attente", () => {
    const between = report(series(range(15, 1_000, 20)), series([...range(14, 1_300, 20), 2_400]).map((metric, index) => (
      index === 27 ? { ...metric, totalMs: 2_100 } : metric
    )));
    expect(between.combined.stats.p95).toBe(2_100);
    expect(between.verdict.status).toBe("DECISION_REQUIRED");
    expect(between.verdict.label).toBe("DÉCISION PRODUIT REQUISE");
    expectNoGo(between);

    const decidedHistorical = buildPilotFieldReport({
      exports: { iphone: exportOf("iphone", series(range(15, 1_000, 20))), android: exportOf("android", series([...range(13, 1_300, 20), 2_100, 2_400])) },
      decision: { status: "decided", officialThresholdId: "historical", summary: "" },
    });
    expect(decidedHistorical.verdict.status).toBe("GO");
    const decidedStrict = buildPilotFieldReport({
      exports: { iphone: exportOf("iphone", series(range(15, 1_000, 20))), android: exportOf("android", series([...range(13, 1_300, 20), 2_100, 2_400])) },
      decision: { status: "decided", officialThresholdId: "strict", summary: "" },
    });
    expect(decidedStrict.verdict.status).toBe("NO_GO");
  });

  it("applique exactement les comparateurs historiques (< 2500) et renforcés (≤ 2000)", () => {
    const withP95 = (p95: number) => report(
      series(range(15, 1_000, 10)),
      series([...range(13, 1_100, 10), p95, p95 + 500]),
    );
    expect(withP95(2_000).combined.stats.p95).toBe(2_000);
    expect(withP95(2_000).verdict.status).toBe("GO");
    expect(withP95(2_001).verdict.status).toBe("DECISION_REQUIRED");
    expect(withP95(2_499).verdict.status).toBe("DECISION_REQUIRED");
    expect(withP95(2_500).verdict.status).toBe("NO_GO");
    expectNoGo(withP95(2_500));
    expect(withP95(1_500).thresholds[0].pass).toBe(true);
  });

  it("29 actions réussies : NO-GO / INCOMPLET, jamais GO, même avec un excellent p95", () => {
    const result = report(series(range(15, 500, 1)), series(range(14, 500, 1)));
    expect(result.combined.officialActions).toBe(29);
    expect(result.verdict.status).toBe("INCOMPLETE");
    expect(result.verdict.label).toBe("NO-GO / INCOMPLET");
    expect(result.verdict.reasons.join("\n")).toContain("Android : 14 action(s) QR réussie(s) (attendu : exactement 15)");
    expect(renderPilotFieldReportText(result)).toContain("(calcul indicatif : N = 29 < 30)");
    expectNoGo(result);
  });

  it("30 actions réparties 14/16 : répartition 15/15 non respectée", () => {
    const result = report(series(range(14, 500, 1)), series(range(16, 500, 1)));
    expect(result.combined.officialActions).toBe(30);
    expect(result.verdict.status).toBe("NON_COMPLIANT");
    expect(result.verdict.reasons).toEqual(expect.arrayContaining([
      "iPhone : 14 action(s) QR réussie(s) (attendu : exactement 15)",
      "Android : 16 action(s) QR réussie(s) (attendu : exactement 15)",
    ]));
    expect(renderPilotFieldReportMarkdown(result)).toContain("Répartition attendue 15/15 : **non respectée** (iPhone 14 / Android 16)");
    expectNoGo(result);
  });

  it("un export manquant, vide ou deux exports absents ne donnent jamais GO", () => {
    for (const result of [report(series(iphoneTotals), null), report(null, series(androidTotals)), report(null, null), report([], [])]) {
      expect(result.verdict.status).toBe("INCOMPLETE");
      expectNoGo(result);
    }
    const empty = report([], []);
    expect(empty.combined.stats).toEqual({ n: 0, p50: null, p90: null, p95: null, max: null });
    expect(renderPilotFieldReportText(empty)).toContain("p95 :         —");
    expect(renderPilotFieldReportMarkdown(empty)).toContain("Aucune action QR réussie.");
    expect(report(series(iphoneTotals), null).verdict.reasons).toContain("Export Android manquant");
  });

  it("exclut les actions échouées des percentiles mais les compte et bloque le GO", () => {
    const android = [...series(androidTotals), action(99_999, { ok: false, errorCode: "NETWORK_ERROR" }), lookup(88_888, { ok: false, errorCode: "RATE_LIMITED" })];
    const result = report(series(iphoneTotals), android);
    expect(result.combined.stats.max).toBe(1_580);
    expect(result.combined.stats.p95).toBe(1_560);
    expect(result.combined.failedActions).toBe(1);
    expect(result.combined.failedLookups).toBe(1);
    expect(result.combined.failureCodes).toEqual({ NETWORK_ERROR: 1, RATE_LIMITED: 1 });
    expect(result.verdict.status).toBe("NON_COMPLIANT");
    expect(result.verdict.reasons.join("\n")).toContain("2 échec(s) QR pendant la série (1 action(s), 1 lookup(s) ; codes : NETWORK_ERROR ×1, RATE_LIMITED ×1)");
    expectNoGo(result);
  });

  it("n'utilise jamais le lookup QR → fiche client comme p95 officiel", () => {
    const iphone = series(iphoneTotals).map((metric) => (metric.phase === "lookup" ? { ...metric, totalMs: 50_000 } : metric));
    const result = report(iphone, series(androidTotals));
    expect(result.combined.stats.p95).toBe(1_560);
    expect(result.combined.lookup.p95).toBe(50_000);
    expect(result.verdict.status).toBe("GO");
  });

  it("exclut la saisie manuelle du critère sans bloquer, et bloque les mesures d'origine inconnue", () => {
    const withManual = report([...series(iphoneTotals), action(10, { source: "manual" })], series(androidTotals));
    expect(withManual.combined.stats.p95).toBe(1_560);
    expect(withManual.combined.manualActions).toBe(1);
    expect(withManual.checks.find((check) => check.id === "manual")).toMatchObject({ ok: false, blocking: false });
    expect(withManual.verdict.status).toBe("GO");

    const withLegacy = report([...series(iphoneTotals), { ...action(10), source: undefined }], series(androidTotals));
    expect(withLegacy.combined.unknownSource).toBe(1);
    expect(withLegacy.verdict.status).toBe("NON_COMPLIANT");
    expectNoGo(withLegacy);

    const onlyLegacy = report(series(iphoneTotals).map((metric) => ({ ...metric, source: undefined })), series(androidTotals));
    expect(onlyLegacy.devices.iphone.present && onlyLegacy.devices.iphone.officialActions).toBe(0);
    expect(onlyLegacy.verdict.status).toBe("INCOMPLETE");
  });

  it("refuse de conclure si le stockage local a pu perdre ou ignorer des mesures", () => {
    const truncated = buildPilotFieldReport({
      exports: { iphone: exportOf("iphone", series(iphoneTotals), 30), android: exportOf("android", series(androidTotals)) },
    });
    expect(truncated.devices.iphone.present && truncated.devices.iphone.possiblyTruncated).toBe(true);
    expect(truncated.verdict.status).toBe("NON_COMPLIANT");

    const discarded = report([...series(iphoneTotals), { phase: "action" }], series(androidTotals));
    expect(discarded.verdict.status).toBe("NON_COMPLIANT");
    expect(discarded.verdict.reasons.join("\n")).toContain("1 entrée(s) locale(s) illisible(s) sur iPhone");
  });

  it("compte les utilisations de récompense réussies comme actions, avec un avertissement", () => {
    const result = report(series(iphoneTotals), [...series(range(14, 1_300, 20)), lookup(400), action(1_580, { action: "redeem" })]);
    expect(result.combined.redeems).toBe(1);
    expect(result.combined.officialActions).toBe(30);
    expect(result.checks.find((check) => check.id === "redeem")).toMatchObject({ ok: false, blocking: false });
    expect(result.verdict.status).toBe("GO");
  });

  it("calcule les diagnostics réseau et serveur sur les seules actions QR réussies", () => {
    const iphone = series(iphoneTotals).map((metric, index) => (metric.phase === "action" ? { ...metric, networkMs: 100 + index, serverMs: 10 + index } : metric));
    const result = report(iphone, series(androidTotals));
    expect(result.combined.networkP95).toBe(nearestRank([...range(15, 101, 2), ...Array(15).fill(200)], 95));
    expect(result.combined.serverP95).toBe(nearestRank([...range(15, 11, 2), ...Array(15).fill(50)], 95));
  });

  it("produit un Markdown archivable avec la mention de périmètre", () => {
    const markdown = renderPilotFieldReportMarkdown(report(series(iphoneTotals), series(androidTotals)));
    expect(markdown).toContain(CLIENT_PROOF_DISCLAIMER);
    expect(CLIENT_PROOF_DISCLAIMER).toBe("Ce rapport prouve les mesures client/performance. Il ne prouve pas à lui seul l'intégrité du ledger serveur.");
    expect(markdown).toContain(`| Généré le | ${at(180)} |`);
    expect(markdown).toContain("## A. Preuve client / performance");
    expect(markdown).toContain("## B. Preuve serveur / intégrité — à établir séparément");
    expect(markdown).toContain("| p95 | 29 | 1560 ms | 1280 ms | 1580 ms |");
    expect(markdown).toContain("| Seuil historique | p95 < 2500 ms |");
    expect(markdown).toContain("**DÉCISION PRODUIT ENCORE REQUISE : seuil officiel final = 2000 ou 2500 ms.**");
    expect(markdown).toContain("| p95 réseau des actions QR réussies | 200 ms |");
    expect(markdown).toContain("| p95 serveur des actions QR réussies | 50 ms |");
    expect(markdown).toContain("| Lookup QR → fiche client | N = 30");
    expect(markdown).toContain("exactement 30 `earn` et 0 `redeem`");
    expect(markdown).not.toMatch(/- \[x\]/i);
  });
});
