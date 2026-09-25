import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HISTORICAL_PILOT_THRESHOLD_MS,
  INTERNAL_TARGET_MS,
  PILOT_GATE,
  PILOT_P95_THRESHOLDS,
  PILOT_THRESHOLD_DECISION,
  STRICT_PILOT_THRESHOLD_MS,
  evaluateP95Thresholds,
  p95GateStatus,
  passesThreshold,
} from "@/lib/pilot-gate.mjs";

describe("seuils du gate terrain (source unique)", () => {
  it("expose les trois seuils et laisse la décision produit ouverte", () => {
    expect(HISTORICAL_PILOT_THRESHOLD_MS).toBe(2500);
    expect(STRICT_PILOT_THRESHOLD_MS).toBe(2000);
    expect(INTERNAL_TARGET_MS).toBe(1500);
    expect(PILOT_P95_THRESHOLDS.map((threshold) => [threshold.id, threshold.limitMs, threshold.comparator, threshold.role])).toEqual([
      ["internal", 1500, "lte", "target"],
      ["strict", 2000, "lte", "candidate"],
      ["historical", 2500, "lt", "candidate"],
    ]);
    expect(PILOT_THRESHOLD_DECISION).toMatchObject({ status: "pending", officialThresholdId: null });
    expect(PILOT_THRESHOLD_DECISION.summary).toBe("DÉCISION PRODUIT ENCORE REQUISE : seuil officiel final = 2000 ou 2500 ms");
    expect(PILOT_GATE).toMatchObject({ devices: ["iphone", "android"], actionsPerDevice: 15, totalActions: 30 });
    expect(Object.isFrozen(PILOT_P95_THRESHOLDS) && Object.isFrozen(PILOT_P95_THRESHOLDS[0])).toBe(true);
  });

  it("respecte les comparateurs d'origine : < 2500 historique, ≤ 2000 et ≤ 1500 protocole", () => {
    const [internal, strict, historical] = PILOT_P95_THRESHOLDS;
    expect(passesThreshold(2499, historical)).toBe(true);
    expect(passesThreshold(2500, historical)).toBe(false);
    expect(passesThreshold(2000, strict)).toBe(true);
    expect(passesThreshold(2001, strict)).toBe(false);
    expect(passesThreshold(1500, internal)).toBe(true);
    expect(passesThreshold(null, historical)).toBe(false);
    expect(passesThreshold(Number.NaN, historical)).toBe(false);
    expect(evaluateP95Thresholds(1840).map((result) => [result.label, result.rule, result.pass])).toEqual([
      ["Cible interne", "p95 ≤ 1500 ms", false],
      ["Seuil renforcé", "p95 ≤ 2000 ms", true],
      ["Seuil historique", "p95 < 2500 ms", true],
    ]);
  });

  it("ne choisit jamais silencieusement entre 2000 et 2500 ms", () => {
    expect(p95GateStatus(1840)).toBe("GO");
    expect(p95GateStatus(2000)).toBe("GO");
    expect(p95GateStatus(2001)).toBe("DECISION_REQUIRED");
    expect(p95GateStatus(2499)).toBe("DECISION_REQUIRED");
    expect(p95GateStatus(2500)).toBe("NO_GO");
    const strict = { status: "decided", officialThresholdId: "strict", summary: "" } as const;
    const historical = { status: "decided", officialThresholdId: "historical", summary: "" } as const;
    expect(p95GateStatus(2200, strict)).toBe("NO_GO");
    expect(p95GateStatus(2200, historical)).toBe("GO");
    expect(() => p95GateStatus(2200, { status: "decided", officialThresholdId: null, summary: "" })).toThrow();
  });

  it("aucun écran ni script ne réécrit un seuil en dur", () => {
    for (const file of ["components/scan-stats.tsx", "scripts/pilot-field-report.mjs", "lib/pilot-field-report.mjs"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\b(?:1\s?500|2\s?000|2\s?500)\s?ms\b/);
    }
  });
});
