// Source de vérité unique du gate terrain physique : seuils p95 et taille de
// l'échantillon. Lue par /s/stats (navigateur) ET par `npm run
// pilot:field-report` (Node sans TypeScript), d'où ce module JavaScript pur ;
// les types sont dans pilot-gate.d.mts.
//
// Divergence non tranchée (voir docs/protocole-validation-physique-retiko.md) :
// - seuil historique p95 < 2 500 ms : issue #2, SPEC-V0.md, README, PILOT.md,
//   /s/stats, depuis l'import du MVP (15/09/2026) ;
// - seuil renforcé p95 ≤ 2 000 ms et cible interne ≤ 1 500 ms : protocole
//   physique ajouté par la PR #121 (24/09/2026), sans décision documentée ni
//   mise à jour des autres sources.
// Tant que PILOT_THRESHOLD_DECISION.status vaut "pending", aucun verdict ne
// choisit entre les deux : un p95 compris entre eux exige une décision produit.

export const HISTORICAL_PILOT_THRESHOLD_MS = 2500;
export const STRICT_PILOT_THRESHOLD_MS = 2000;
export const INTERNAL_TARGET_MS = 1500;

export const PILOT_P95_THRESHOLDS = Object.freeze([
  Object.freeze({
    id: "internal",
    label: "Cible interne",
    limitMs: INTERNAL_TARGET_MS,
    comparator: "lte",
    role: "target",
    source: "protocole physique (PR #121, 24/09/2026)",
  }),
  Object.freeze({
    id: "strict",
    label: "Seuil renforcé",
    limitMs: STRICT_PILOT_THRESHOLD_MS,
    comparator: "lte",
    role: "candidate",
    source: "protocole physique (PR #121, 24/09/2026)",
  }),
  Object.freeze({
    id: "historical",
    label: "Seuil historique",
    limitMs: HISTORICAL_PILOT_THRESHOLD_MS,
    comparator: "lt",
    role: "candidate",
    source: "issue #2, SPEC-V0.md, README, PILOT.md, /s/stats (15/09/2026)",
  }),
]);

// Une fois la décision prise, passer status à "decided" et officialThresholdId
// à "strict" ou "historical" : le verdict n'utilisera plus que ce seuil.
export const PILOT_THRESHOLD_DECISION = Object.freeze({
  status: "pending",
  officialThresholdId: null,
  summary: "DÉCISION PRODUIT ENCORE REQUISE : seuil officiel final = 2000 ou 2500 ms",
});

export const PILOT_GATE = Object.freeze({
  devices: Object.freeze(["iphone", "android"]),
  deviceLabels: Object.freeze({ iphone: "iPhone", android: "Android" }),
  actionsPerDevice: 15,
  totalActions: 30,
  criterion: "QR détecté → action fidélité validée",
});

export function describeThresholdRule(threshold) {
  return `p95 ${threshold.comparator === "lt" ? "<" : "≤"} ${threshold.limitMs} ms`;
}

export function passesThreshold(valueMs, threshold) {
  if (typeof valueMs !== "number" || !Number.isFinite(valueMs)) return false;
  return threshold.comparator === "lt" ? valueMs < threshold.limitMs : valueMs <= threshold.limitMs;
}

export function evaluateP95Thresholds(p95Ms, thresholds = PILOT_P95_THRESHOLDS) {
  return thresholds.map((threshold) => ({
    id: threshold.id,
    label: threshold.label,
    limitMs: threshold.limitMs,
    comparator: threshold.comparator,
    role: threshold.role,
    source: threshold.source,
    rule: describeThresholdRule(threshold),
    pass: passesThreshold(p95Ms, threshold),
  }));
}

/**
 * Verdict du seul critère p95, sur un échantillon déjà jugé complet.
 * - décision prise : le seuil officiel seul tranche (GO / NO_GO) ;
 * - décision en attente : GO seulement si tous les seuils candidats passent,
 *   NO_GO si aucun ne passe, DECISION_REQUIRED sinon.
 */
export function p95GateStatus(p95Ms, decision = PILOT_THRESHOLD_DECISION, thresholds = PILOT_P95_THRESHOLDS) {
  const candidates = thresholds.filter((threshold) => threshold.role === "candidate");
  if (decision.status === "decided") {
    const official = candidates.find((threshold) => threshold.id === decision.officialThresholdId);
    if (!official) throw new Error(`Seuil officiel inconnu : ${decision.officialThresholdId}`);
    return passesThreshold(p95Ms, official) ? "GO" : "NO_GO";
  }
  const passed = candidates.filter((threshold) => passesThreshold(p95Ms, threshold)).length;
  if (passed === candidates.length) return "GO";
  if (passed === 0) return "NO_GO";
  return "DECISION_REQUIRED";
}
