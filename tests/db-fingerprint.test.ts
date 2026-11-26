import { describe, expect, it } from "vitest";
import { diffFingerprints, restoreVerdict, type Fingerprint } from "../scripts/db-fingerprint.mjs";

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
