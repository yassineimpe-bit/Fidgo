import { describe, expect, it } from "vitest";
import { diffFingerprints, restoreVerdict, upgradeVerdict, type Fingerprint } from "../scripts/db-fingerprint.mjs";

const base: Fingerprint = {
  rows: { cards: "2", transactions: "5", product_events: "3" },
  aggregates: { cards: { balanceTotal: "7", activeCards: "2" }, ledgerBalanceMismatches: "0" },
};
const clone = (value: Fingerprint): Fingerprint => JSON.parse(JSON.stringify(value));

describe("empreinte du restore drill", () => {
  it("valide une restauration identique à une source stable", () => {
    expect(restoreVerdict(base, clone(base), clone(base))).toEqual({ status: "match", differences: [] });
  });

  it("détecte une ligne perdue, une table absente et un solde altéré", () => {
    const restored = clone(base);
    restored.rows.product_events = "2";
    delete restored.rows.transactions;
    restored.aggregates = { cards: { balanceTotal: "8", activeCards: "2" }, ledgerBalanceMismatches: "0" };
    const verdict = restoreVerdict(base, clone(base), restored);
    expect(verdict.status).toBe("mismatch");
    expect(verdict.differences).toEqual([
      "table product_events : 3 ligne(s) attendue(s), 2 trouvée(s)",
      "table transactions : 5 ligne(s) attendue(s), absente trouvée(s)",
      expect.stringContaining("agrégats différents"),
    ]);
  });

  it("ne conclut pas quand la source a changé pendant le dump", () => {
    const after = clone(base);
    after.rows.product_events = "4";
    const verdict = restoreVerdict(base, after, clone(after));
    expect(verdict.status).toBe("inconclusive");
    expect(verdict.differences).toEqual(["table product_events : 3 ligne(s) attendue(s), 4 trouvée(s)"]);
  });

  it("ne signale aucune différence entre deux empreintes égales", () => {
    expect(diffFingerprints(base, clone(base))).toEqual([]);
  });
});

describe("empreinte de la répétition des migrations", () => {
  it("accepte des tables ajoutées quand les données existantes sont intactes", () => {
    const migrated = clone(base);
    migrated.rows.reward_notifications = "0";
    migrated.rows.establishment_logos = "0";
    expect(upgradeVerdict(base, migrated)).toEqual({
      status: "match",
      differences: [],
      addedTables: ["establishment_logos", "reward_notifications"],
    });
  });

  it("refuse une table disparue, une ligne perdue ou un solde modifié", () => {
    const migrated = clone(base);
    delete migrated.rows.product_events;
    migrated.rows.transactions = "4";
    migrated.aggregates = { cards: { balanceTotal: "6", activeCards: "2" }, ledgerBalanceMismatches: "0" };
    const verdict = upgradeVerdict(base, migrated);
    expect(verdict.status).toBe("mismatch");
    expect(verdict.differences).toEqual([
      "table product_events : 3 ligne(s) avant migration, absente après",
      "table transactions : 5 ligne(s) avant migration, 4 après",
      expect.stringContaining("agrégats modifiés par les migrations"),
    ]);
  });
});
