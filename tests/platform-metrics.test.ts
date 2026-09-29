import { describe, expect, it } from "vitest";
import {
  WATCH_RULES, daysSince, describeWatchReason, formatCalendarDate, formatDuration, formatMs, formatPercent, formatRatio,
  parseEstablishmentFilters, ratePercent, rewardUsageRate, scanErrorRate, watchReasons,
} from "../lib/platform-metrics";

describe("cockpit super-admin : taux sans division par zéro", () => {
  it("renvoie null (affiché « — ») quand le dénominateur est nul", () => {
    expect(ratePercent(0, 0)).toBeNull();
    expect(ratePercent(3, 0)).toBeNull();
    expect(ratePercent(Number.NaN, 4)).toBeNull();
    expect(formatPercent(ratePercent(0, 0))).toBe("—");
    expect(ratePercent(1, 3)).toBe(33);
    expect(formatPercent(ratePercent(2, 2))).toBe("100 %");
  });

  it("reprend les formules de l'analytics commerçant", () => {
    // Taux d'utilisation = utilisées / (utilisées + disponibles).
    expect(rewardUsageRate(1, 3)).toBe(25);
    expect(rewardUsageRate(0, 0)).toBeNull();
    // Taux d'échec scanner = échecs / (réussis + échecs).
    expect(scanErrorRate(8, 2)).toBe(20);
    expect(scanErrorRate(0, 0)).toBeNull();
  });

  it("formate ratios, durées et latences sans NaN", () => {
    expect(formatRatio(5, 2)).toBe("2.5");
    expect(formatRatio(5, 0)).toBe("—");
    expect(formatMs(null)).toBe("—");
    expect(formatMs(1234.4)).toBe("1234 ms");
    expect(formatMs("abc")).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(600)).toBe("< 1 h");
    expect(formatDuration(5 * 3600)).toBe("5 h");
    expect(formatDuration(2 * 86_400 + 3 * 3600)).toBe("2 j 3 h");
    expect(formatDuration(3 * 86_400)).toBe("3 j");
  });

  it("formate les dates calendaires sans « Invalid Date »", () => {
    expect(formatCalendarDate(new Date("2026-09-28T00:00:00Z"))).toBe("28/09/2026");
    expect(formatCalendarDate("2026-09-28")).toBe("28/09/2026");
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDate("pas une date")).toBe("—");
    expect(daysSince("pas une date")).toBeNull();
    expect(daysSince(new Date("2026-09-20T12:00:00Z"), new Date("2026-09-25T13:00:00Z"))).toBe(5);
  });
});

describe("cockpit super-admin : filtres de la liste", () => {
  it("n'accepte que les valeurs connues", () => {
    expect(parseEstablishmentFilters({})).toEqual({ status: "all", activity: "all", subscription: "all", watch: false, sort: "created" });
    expect(parseEstablishmentFilters({ status: "suspended", activity: "inactive7", subscription: "none", watch: "1", sort: "scans_30d" }))
      .toEqual({ status: "suspended", activity: "inactive7", subscription: "none", watch: true, sort: "scans_30d" });
    expect(parseEstablishmentFilters({ status: "x' or 1=1", activity: ["7d", "30d"], subscription: "PILOT", watch: "true", sort: "id; drop" }))
      .toEqual({ status: "all", activity: "7d", subscription: "all", watch: false, sort: "created" });
  });
});

describe("cockpit super-admin : règles « À surveiller »", () => {
  const now = new Date("2026-09-29T12:00:00Z");

  it("liste les règles déclenchées dans un ordre stable", () => {
    expect(watchReasons({})).toEqual([]);
    expect(watchReasons({ watch_scanner: true, watch_never_started: true })).toEqual(["never_started", "scanner"]);
  });

  it("explique chaque règle par des faits", () => {
    expect(describeWatchReason("never_started", { created_at: new Date("2026-09-24T10:00:00Z") }, now))
      .toBe("Inscrit depuis 5 j · aucun passage crédité");
    expect(describeWatchReason("dropped", { last_earn_at: new Date("2026-09-19T12:00:00Z"), earn_total: 12 }, now))
      .toBe("Dernier passage crédité il y a 10 j · 12 passages au total");
    expect(describeWatchReason("trial_at_risk", { trial_ends_at: new Date("2026-10-02T12:00:00Z") }, now))
      .toBe("Essai terminé dans 3 j · aucun passage crédité sur 7 j");
    expect(describeWatchReason("scanner", { scan_success_7d: 8, scan_failed_7d: 4 }, now))
      .toBe("Scanner : 4 échecs sur 12 tentatives en 7 j (33 %)");
  });

  it("garde des seuils documentés", () => {
    expect(WATCH_RULES).toEqual({ neverStartedAfterDays: 3, droppedAfterDays: 7, trialEndingWithinDays: 7, scannerMinAttempts7d: 10, scannerFailurePercent: 20 });
  });
});
