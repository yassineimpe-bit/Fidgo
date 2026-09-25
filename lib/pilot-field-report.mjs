// Calcul du gate terrain physique à partir des exports /s/stats des deux
// téléphones. Module JavaScript pur (types : pilot-field-report.d.mts) afin
// que `npm run pilot:field-report` tourne sur n'importe quel Node, sans
// compilation TypeScript ; /s/stats l'importe aussi pour rester cohérent.
//
// Le module ne lit aucune base : il ne prouve que la partie client/performance.
import {
  PILOT_GATE,
  PILOT_THRESHOLD_DECISION,
  evaluateP95Thresholds,
  p95GateStatus,
} from "./pilot-gate.mjs";

export const SCAN_METRICS_EXPORT_FORMAT = "retiko-scan-metrics";
export const SCAN_METRICS_EXPORT_VERSION = 1;
export const PILOT_FIELD_REPORT_VERSION = 1;
export const CLIENT_PROOF_DISCLAIMER =
  "Ce rapport prouve les mesures client/performance. Il ne prouve pas à lui seul l'intégrité du ledger serveur.";

const EXPORT_KEYS = ["format", "version", "exportedAt", "device", "storageLimit", "storedCount", "metrics"];
const METRIC_KEYS = new Set(["phase", "action", "source", "networkMs", "serverMs", "totalMs", "ok", "at", "errorCode"]);
const METRIC_SOURCES = ["qr", "manual", "unknown"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
// Codes techniques uniquement : un message d'exception brut peut contenir un
// extrait de réponse serveur et n'a rien à faire dans une preuve archivée.
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_REPORTED_ERRORS = 20;

const STATUS_LABELS = {
  GO: "GO",
  NO_GO: "NO-GO",
  INCOMPLETE: "NO-GO / INCOMPLET",
  NON_COMPLIANT: "NO-GO / NON CONFORME",
  DECISION_REQUIRED: "DÉCISION PRODUIT REQUISE",
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

function describeValue(value) {
  if (typeof value === "number") return String(value);
  if (value === undefined) return "absent";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function deviceLabel(device) {
  return PILOT_GATE.deviceLabels[device] ?? device;
}

// ---------------------------------------------------------------------------
// Nearest-rank : R = ceil(p × N), valeur de rang R dans l'échantillon trié.

function assertPercent(percent) {
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new RangeError(`Percentile invalide : ${percent} (entier de 1 à 100 attendu)`);
  }
}

export function nearestRankPosition(count, percent) {
  assertPercent(percent);
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Effectif invalide : ${count}`);
  // percent × count est un entier exact : aucune erreur d'arrondi flottant,
  // contrairement à 0.95 × N (0.07 × 100 vaut 7.000000000000001).
  return Math.ceil((percent * count) / 100);
}

export function nearestRank(values, percent) {
  assertPercent(percent);
  if (!Array.isArray(values)) throw new TypeError("Un tableau de durées est attendu");
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`Durée non finie : ${describeValue(value)}`);
    }
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[nearestRankPosition(sorted.length, percent) - 1];
}

export function summarizeDurations(values) {
  return {
    n: values.length,
    p50: nearestRank(values, 50),
    p90: nearestRank(values, 90),
    p95: nearestRank(values, 95),
    max: nearestRank(values, 100),
  };
}

// ---------------------------------------------------------------------------
// Export navigateur : liste blanche stricte des champs de performance.

export function normalizeScanErrorCode(code) {
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "ERROR";
}

/** Normalise une mesure lue dans localStorage, ou null si elle est inexploitable. */
export function sanitizeScanMetric(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.phase !== "lookup" && raw.phase !== "action") return null;
  if (raw.phase === "action" && raw.action !== "credit" && raw.action !== "redeem") return null;
  if (!isDuration(raw.networkMs) || !isDuration(raw.serverMs) || !isDuration(raw.totalMs)) return null;
  if (typeof raw.ok !== "boolean" || !isIsoDate(raw.at)) return null;

  const metric = { phase: raw.phase };
  if (raw.phase === "action") metric.action = raw.action;
  // Les mesures antérieures au champ source ne disent pas si la carte venait
  // d'un QR ou d'une saisie manuelle : elles restent visibles mais hors gate.
  metric.source = raw.source === "qr" || raw.source === "manual" ? raw.source : "unknown";
  metric.networkMs = raw.networkMs;
  metric.serverMs = raw.serverMs;
  metric.totalMs = raw.totalMs;
  metric.ok = raw.ok;
  metric.at = raw.at;
  if (!raw.ok && typeof raw.errorCode === "string") metric.errorCode = normalizeScanErrorCode(raw.errorCode);
  return metric;
}

export function buildScanMetricsExport(rawEntries, { device, exportedAt, storageLimit }) {
  if (!PILOT_GATE.devices.includes(device)) throw new Error(`Appareil inconnu : ${device}`);
  if (!isIsoDate(exportedAt)) throw new Error("exportedAt doit être une date ISO 8601");
  if (!Number.isInteger(storageLimit) || storageLimit < 1) throw new Error("storageLimit invalide");
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  return {
    format: SCAN_METRICS_EXPORT_FORMAT,
    version: SCAN_METRICS_EXPORT_VERSION,
    exportedAt,
    device,
    storageLimit,
    storedCount: entries.length,
    metrics: entries.map(sanitizeScanMetric).filter((metric) => metric !== null),
  };
}

// ---------------------------------------------------------------------------
// Validation stricte d'un export (CLI).

function validateMetric(metric, path, fail) {
  if (!isPlainObject(metric)) {
    fail(`${path} : objet attendu`);
    return;
  }
  for (const key of Object.keys(metric)) {
    if (!METRIC_KEYS.has(key)) fail(`${path}.${key} : champ inattendu`);
  }
  if (metric.phase !== "lookup" && metric.phase !== "action") {
    fail(`${path}.phase : "lookup" ou "action" attendu (reçu ${describeValue(metric.phase)})`);
  }
  if (metric.phase === "action") {
    if (metric.action !== "credit" && metric.action !== "redeem") {
      fail(`${path}.action : "credit" ou "redeem" attendu (reçu ${describeValue(metric.action)})`);
    }
  } else if ("action" in metric) {
    fail(`${path}.action : interdit hors phase "action"`);
  }
  if (!METRIC_SOURCES.includes(metric.source)) {
    fail(`${path}.source : "qr", "manual" ou "unknown" attendu (reçu ${describeValue(metric.source)})`);
  }
  for (const key of ["networkMs", "serverMs", "totalMs"]) {
    if (!isDuration(metric[key])) fail(`${path}.${key} : nombre fini ≥ 0 attendu (reçu ${describeValue(metric[key])})`);
  }
  if (typeof metric.ok !== "boolean") fail(`${path}.ok : booléen attendu (reçu ${describeValue(metric.ok)})`);
  if (!isIsoDate(metric.at)) fail(`${path}.at : date ISO 8601 attendue (reçu ${describeValue(metric.at)})`);
  if ("errorCode" in metric) {
    if (metric.ok !== false) fail(`${path}.errorCode : réservé aux mesures en échec`);
    else if (typeof metric.errorCode !== "string" || !ERROR_CODE.test(metric.errorCode)) {
      fail(`${path}.errorCode : code technique attendu (A-Z, 0-9, _)`);
    }
  }
}

function copyMetric(metric) {
  const copy = { phase: metric.phase };
  if (metric.phase === "action") copy.action = metric.action;
  copy.source = metric.source;
  copy.networkMs = metric.networkMs;
  copy.serverMs = metric.serverMs;
  copy.totalMs = metric.totalMs;
  copy.ok = metric.ok;
  copy.at = metric.at;
  if ("errorCode" in metric) copy.errorCode = metric.errorCode;
  return copy;
}

export function validateScanMetricsExport(value, options = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!isPlainObject(value)) return { ok: false, errors: ["la racine du fichier doit être un objet JSON"] };
  if (value.format !== SCAN_METRICS_EXPORT_FORMAT) {
    fail(`format : "${SCAN_METRICS_EXPORT_FORMAT}" attendu (reçu ${describeValue(value.format)}) — ce fichier ne provient pas de /s/stats`);
  }
  if (value.version !== SCAN_METRICS_EXPORT_VERSION) {
    // Une version inconnue peut avoir une autre sémantique : ne rien interpréter.
    fail(`version d'export inconnue : ${describeValue(value.version)} (version prise en charge : ${SCAN_METRICS_EXPORT_VERSION})`);
    return { ok: false, errors };
  }
  for (const key of Object.keys(value)) {
    if (!EXPORT_KEYS.includes(key)) fail(`${key} : champ inattendu`);
  }
  if (!isIsoDate(value.exportedAt)) fail(`exportedAt : date ISO 8601 attendue (reçu ${describeValue(value.exportedAt)})`);
  if (!PILOT_GATE.devices.includes(value.device)) {
    fail(`device : "iphone" ou "android" attendu (reçu ${describeValue(value.device)})`);
  } else if (options.expectedDevice && value.device !== options.expectedDevice) {
    fail(`device : export étiqueté "${value.device}" fourni comme export ${options.expectedDevice} (fichiers inversés ?)`);
  }
  if (!Number.isInteger(value.storageLimit) || value.storageLimit < 1) {
    fail(`storageLimit : entier ≥ 1 attendu (reçu ${describeValue(value.storageLimit)})`);
  }
  if (!Number.isInteger(value.storedCount) || value.storedCount < 0) {
    fail(`storedCount : entier ≥ 0 attendu (reçu ${describeValue(value.storedCount)})`);
  }
  if (!Array.isArray(value.metrics)) {
    fail("metrics : tableau attendu");
  } else {
    if (Number.isInteger(value.storedCount) && value.metrics.length > value.storedCount) {
      fail(`metrics : ${value.metrics.length} mesures pour storedCount = ${value.storedCount}`);
    }
    value.metrics.forEach((metric, index) => validateMetric(metric, `metrics[${index}]`, fail));
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS);
    if (errors.length > shown.length) shown.push(`… et ${errors.length - shown.length} autre(s) erreur(s)`);
    return { ok: false, errors: shown };
  }
  return {
    ok: true,
    value: {
      format: value.format,
      version: value.version,
      exportedAt: value.exportedAt,
      device: value.device,
      storageLimit: value.storageLimit,
      storedCount: value.storedCount,
      metrics: value.metrics.map(copyMetric),
    },
  };
}

export function parseScanMetricsExport(text, options = {}) {
  let value;
  try {
    value = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (error) {
    return { ok: false, errors: [`JSON invalide : ${error instanceof Error ? error.message : String(error)}`] };
  }
  return validateScanMetricsExport(value, options);
}

// ---------------------------------------------------------------------------
// Classement commun à /s/stats et au rapport.

export function classifyScanMetrics(metrics) {
  const groups = {
    qrActionsOk: [],
    qrActionsFailed: [],
    qrLookupsOk: [],
    qrLookupsFailed: [],
    manual: [],
    unknownSource: [],
  };
  for (const metric of metrics) {
    if (metric.source === "unknown") groups.unknownSource.push(metric);
    else if (metric.source === "manual") groups.manual.push(metric);
    else if (metric.phase === "action") (metric.ok ? groups.qrActionsOk : groups.qrActionsFailed).push(metric);
    else (metric.ok ? groups.qrLookupsOk : groups.qrLookupsFailed).push(metric);
  }
  return groups;
}

function countErrorCodes(metrics) {
  const counts = {};
  for (const metric of metrics) {
    const code = metric.errorCode ?? "NON_RENSEIGNÉ";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

function mergeCounts(target, source) {
  for (const [code, count] of Object.entries(source)) target[code] = (target[code] ?? 0) + count;
  return target;
}

function timeWindow(metrics) {
  if (metrics.length === 0) return { first: null, last: null };
  const sorted = metrics.map((metric) => metric.at).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { first: sorted[0], last: sorted[sorted.length - 1] };
}

function summarizeDevice(device, data, file) {
  const groups = classifyScanMetrics(data.metrics);
  const official = groups.qrActionsOk;
  const failures = [...groups.qrLookupsFailed, ...groups.qrActionsFailed];
  const summary = {
    device,
    label: deviceLabel(device),
    present: true,
    file: file ?? null,
    exportedAt: data.exportedAt,
    storageLimit: data.storageLimit,
    storedCount: data.storedCount,
    metricsCount: data.metrics.length,
    discardedCount: data.storedCount - data.metrics.length,
    possiblyTruncated: data.storedCount >= data.storageLimit,
    officialActions: official.length,
    credits: official.filter((metric) => metric.action === "credit").length,
    redeems: official.filter((metric) => metric.action === "redeem").length,
    failedActions: groups.qrActionsFailed.length,
    failedLookups: groups.qrLookupsFailed.length,
    failureCodes: countErrorCodes(failures),
    manualActions: groups.manual.filter((metric) => metric.phase === "action").length,
    manualLookups: groups.manual.filter((metric) => metric.phase === "lookup").length,
    unknownSource: groups.unknownSource.length,
    stats: summarizeDurations(official.map((metric) => metric.totalMs)),
    networkP95: nearestRank(official.map((metric) => metric.networkMs), 95),
    serverP95: nearestRank(official.map((metric) => metric.serverMs), 95),
    lookup: summarizeDurations(groups.qrLookupsOk.map((metric) => metric.totalMs)),
    actionWindow: timeWindow(official),
  };
  return { summary, official, qrLookupsOk: groups.qrLookupsOk };
}

function formatCodes(codes) {
  const entries = Object.entries(codes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([code, count]) => `${code} ×${count}`).join(", ") : "aucun";
}

export function formatDurationMs(value) {
  if (value === null || value === undefined) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ms`;
}

function thresholdPhrase(results, id) {
  const result = results.find((threshold) => threshold.id === id);
  return result ? `${result.label.toLowerCase()} (${result.rule})` : id;
}

/**
 * Agrège les exports iPhone/Android. Aucune mesure n'est complétée ni
 * inventée : un export absent, invalide ou incomplet ne peut jamais produire GO.
 */
export function buildPilotFieldReport({ exports = {}, files = {}, generatedAt = new Date().toISOString(), decision = PILOT_THRESHOLD_DECISION } = {}) {
  const { actionsPerDevice, totalActions } = PILOT_GATE;
  const devices = {};
  const details = [];
  const checks = [];

  for (const device of PILOT_GATE.devices) {
    const data = exports[device];
    if (data) {
      const detail = summarizeDevice(device, data, files[device]);
      details.push(detail);
      devices[device] = detail.summary;
    } else {
      devices[device] = { device, label: deviceLabel(device), present: false, file: null };
    }
    checks.push({
      id: `export-${device}`,
      blocking: true,
      ok: Boolean(data),
      message: data
        ? `Export ${deviceLabel(device)} fourni et valide${files[device] ? ` (${files[device]})` : ""}`
        : `Export ${deviceLabel(device)} manquant`,
    });
  }

  const present = details.map((detail) => detail.summary);
  const officialEntries = details.flatMap((detail) => detail.official.map((metric) => ({ device: detail.summary.device, metric })));
  const officialTotals = officialEntries.map((entry) => entry.metric.totalMs);
  const failureCodes = present.reduce((counts, summary) => mergeCounts(counts, summary.failureCodes), {});
  const sum = (key) => present.reduce((total, summary) => total + summary[key], 0);

  const combined = {
    officialActions: officialEntries.length,
    credits: sum("credits"),
    redeems: sum("redeems"),
    stats: summarizeDurations(officialTotals),
    networkP95: nearestRank(officialEntries.map((entry) => entry.metric.networkMs), 95),
    serverP95: nearestRank(officialEntries.map((entry) => entry.metric.serverMs), 95),
    lookup: summarizeDurations(details.flatMap((detail) => detail.qrLookupsOk.map((metric) => metric.totalMs))),
    failedActions: sum("failedActions"),
    failedLookups: sum("failedLookups"),
    failureCodes,
    manualActions: sum("manualActions"),
    manualLookups: sum("manualLookups"),
    unknownSource: sum("unknownSource"),
    sorted: officialEntries
      .map((entry) => ({ device: entry.device, action: entry.metric.action, totalMs: entry.metric.totalMs, at: entry.metric.at }))
      .sort((a, b) => a.totalMs - b.totalMs || a.device.localeCompare(b.device) || Date.parse(a.at) - Date.parse(b.at))
      .map((entry, index) => ({ rank: index + 1, ...entry })),
  };

  for (const summary of present) {
    checks.push({
      id: `count-${summary.device}`,
      blocking: true,
      ok: summary.officialActions === actionsPerDevice,
      message: `${summary.label} : ${summary.officialActions} action(s) QR réussie(s) (attendu : exactement ${actionsPerDevice})`,
    });
  }
  checks.push({
    id: "total",
    blocking: true,
    ok: combined.officialActions >= totalActions,
    message: `Total : ${combined.officialActions} action(s) QR réussie(s) sur ${totalActions} requises`,
  });
  const failures = combined.failedActions + combined.failedLookups;
  checks.push({
    id: "failures",
    blocking: true,
    ok: failures === 0,
    message: failures === 0
      ? "Aucun échec QR (lookup ou action) pendant la série"
      : `${failures} échec(s) QR pendant la série (${combined.failedActions} action(s), ${combined.failedLookups} lookup(s) ; codes : ${formatCodes(failureCodes)}) — le protocole exige 30/30 scans réussis`,
  });
  checks.push({
    id: "unknown-source",
    blocking: true,
    ok: combined.unknownSource === 0,
    message: combined.unknownSource === 0
      ? "Toutes les mesures indiquent leur origine (QR ou saisie manuelle)"
      : `${combined.unknownSource} mesure(s) d'origine inconnue (ancienne version du scanner) : effacer les mesures puis refaire la série`,
  });
  const truncated = present.filter((summary) => summary.possiblyTruncated).map((summary) => summary.label);
  const discarded = present.filter((summary) => summary.discardedCount > 0);
  checks.push({
    id: "storage",
    blocking: true,
    ok: truncated.length === 0 && discarded.length === 0,
    message: truncated.length === 0 && discarded.length === 0
      ? "Stockage local complet : aucune mesure perdue ni ignorée"
      : [
        truncated.length ? `limite de stockage atteinte sur ${truncated.join(", ")} (mesures anciennes possiblement perdues)` : "",
        discarded.length ? `${discarded.map((summary) => `${summary.discardedCount} entrée(s) locale(s) illisible(s) sur ${summary.label}`).join(", ")}` : "",
      ].filter(Boolean).join(" ; "),
  });
  checks.push({
    id: "manual",
    blocking: false,
    ok: combined.manualActions + combined.manualLookups === 0,
    message: combined.manualActions + combined.manualLookups === 0
      ? "Aucune saisie manuelle"
      : `${combined.manualActions} action(s) et ${combined.manualLookups} recherche(s) via saisie manuelle : exclues du critère (pas de QR détecté)`,
  });
  checks.push({
    id: "redeem",
    blocking: false,
    ok: combined.redeems === 0,
    message: combined.redeems === 0
      ? "Actions retenues : uniquement des crédits (scan standard)"
      : `${combined.redeems} utilisation(s) de récompense parmi les actions retenues : la série nominale prévoit des crédits (A7–A10 sont hors calcul), à vérifier`,
  });

  const thresholds = evaluateP95Thresholds(combined.stats.p95);
  const missing = checks.filter((check) => check.id.startsWith("export-") && !check.ok);
  const blockers = checks.filter((check) => check.blocking && !check.ok);
  let status;
  if (missing.length > 0 || combined.officialActions < totalActions) status = "INCOMPLETE";
  else if (blockers.length > 0) status = "NON_COMPLIANT";
  else status = p95GateStatus(combined.stats.p95, decision);

  const p95Text = `p95 = ${formatDurationMs(combined.stats.p95)} (N = ${combined.stats.n})`;
  let summary;
  if (status === "INCOMPLETE") {
    summary = "échantillon incomplet ou export manquant : aucune conclusion de performance n'est possible.";
  } else if (status === "NON_COMPLIANT") {
    summary = "les données ne respectent pas le protocole : aucune conclusion de performance n'est possible.";
  } else if (decision.status === "decided") {
    summary = `${p95Text} : ${status === "GO" ? "conforme au" : "au-delà du"} seuil officiel, ${thresholdPhrase(thresholds, decision.officialThresholdId)}.`;
  } else if (status === "GO") {
    summary = `${p95Text} : conforme au ${thresholdPhrase(thresholds, "strict")} et au ${thresholdPhrase(thresholds, "historical")}.`;
  } else if (status === "NO_GO") {
    summary = `${p95Text} : au-delà du ${thresholdPhrase(thresholds, "strict")} et du ${thresholdPhrase(thresholds, "historical")}.`;
  } else {
    summary = `${p95Text} : conforme au ${thresholdPhrase(thresholds, "historical")} mais pas au ${thresholdPhrase(thresholds, "strict")} ; le résultat dépend du seuil officiel final, non encore décidé.`;
  }

  return {
    reportVersion: PILOT_FIELD_REPORT_VERSION,
    generatedAt,
    criterion: `${PILOT_GATE.criterion} (phase=action, ok=true, source=qr, totalMs)`,
    method: "nearest-rank : R = ceil(p × N)",
    expected: { actionsPerDevice, totalActions },
    devices,
    combined,
    thresholds,
    decision: { status: decision.status, officialThresholdId: decision.officialThresholdId, summary: decision.summary },
    checks,
    verdict: {
      status,
      label: STATUS_LABELS[status],
      summary,
      reasons: blockers.map((check) => check.message),
    },
    disclaimer: CLIENT_PROOF_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Rendus terminal et Markdown.

function rankLabel(n, percent) {
  return n > 0 ? String(nearestRankPosition(n, percent)) : "—";
}

function yesNo(pass) {
  return pass ? "OUI" : "NON";
}

function windowText(window) {
  return window.first ? `${window.first} → ${window.last}` : "—";
}

export function renderPilotFieldReportText(report) {
  const { combined } = report;
  const n = combined.stats.n;
  const lines = [];
  lines.push("Retiko — rapport du gate terrain physique");
  lines.push(`Critère officiel : ${report.criterion}`);
  lines.push(`Méthode : ${report.method}`);
  lines.push(`Généré le : ${report.generatedAt}`);
  lines.push("");
  lines.push("Exports");
  for (const device of PILOT_GATE.devices) {
    const summary = report.devices[device];
    if (!summary.present) {
      lines.push(`  ${summary.label.padEnd(8)}: MANQUANT`);
      continue;
    }
    lines.push(`  ${summary.label.padEnd(8)}: ${summary.file ?? "export"} — exporté le ${summary.exportedAt}, ${summary.metricsCount} mesure(s)`);
    lines.push(`            actions QR réussies ${summary.officialActions}/${report.expected.actionsPerDevice} (crédits ${summary.credits}, récompenses ${summary.redeems}), échecs : ${summary.failedActions} action(s) + ${summary.failedLookups} lookup(s)`);
    lines.push(`            fenêtre des actions (horloge du téléphone) : ${windowText(summary.actionWindow)}`);
  }
  lines.push(`  Total   : ${combined.officialActions}/${report.expected.totalActions} actions QR réussies`);
  lines.push("");
  lines.push(`QR détecté → action validée (N = ${n})`);
  const perDevice = PILOT_GATE.devices.map((device) => report.devices[device]).filter((summary) => summary.present);
  for (const [key, percent, name] of [["p50", 50, "p50"], ["p90", 90, "p90"], ["p95", 95, "p95"], ["max", 100, "max"]]) {
    const details = perDevice.map((summary) => `${summary.label} ${formatDurationMs(summary.stats[key])}`).join(", ");
    lines.push(`  ${name.padEnd(4)}: ${formatDurationMs(combined.stats[key]).padStart(9)}  (rang ${rankLabel(n, percent)})${details ? `  — ${details}` : ""}`);
  }
  if (n > 0 && n < report.expected.totalActions) lines.push(`  (calcul indicatif : N = ${n} < ${report.expected.totalActions})`);
  lines.push("");
  lines.push("Seuils p95");
  for (const threshold of report.thresholds) {
    const verdict = n > 0 ? yesNo(threshold.pass) : "—";
    lines.push(`  ${`${threshold.label} (${threshold.rule})`.padEnd(38)}: ${verdict}   [${threshold.source}]`);
  }
  if (report.decision.status !== "decided") lines.push(`  ${report.decision.summary}`);
  lines.push("");
  lines.push("Diagnostic (informatif, hors critère officiel)");
  lines.push(`  p95 réseau action  : ${formatDurationMs(combined.networkP95)}`);
  lines.push(`  p95 serveur action : ${formatDurationMs(combined.serverP95)}`);
  lines.push(`  Lookup QR → fiche client : N = ${combined.lookup.n}, p50 ${formatDurationMs(combined.lookup.p50)}, p95 ${formatDurationMs(combined.lookup.p95)}, max ${formatDurationMs(combined.lookup.max)}`);
  lines.push("");
  lines.push("Contrôles");
  for (const check of report.checks) {
    lines.push(`  [${check.ok ? "OK" : check.blocking ? "KO" : "!!"}] ${check.message}`);
  }
  lines.push("");
  lines.push(`VERDICT : ${report.verdict.label} — ${report.verdict.summary}`);
  for (const reason of report.verdict.reasons) lines.push(`  - ${reason}`);
  lines.push("");
  lines.push(report.disclaimer);
  lines.push("La décision pilote exige aussi la preuve serveur/intégrité et les validations physiques du protocole (caméra, lumière, UX rush, Wallet).");
  return `${lines.join("\n")}\n`;
}

function mdCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

export function renderPilotFieldReportMarkdown(report) {
  const { combined } = report;
  const n = combined.stats.n;
  const present = PILOT_GATE.devices.map((device) => report.devices[device]).filter((summary) => summary.present);
  const out = [];
  out.push("# Rapport du gate terrain physique Retiko");
  out.push("");
  out.push(`> ${report.disclaimer}`);
  out.push("");
  out.push("| Élément | Valeur |");
  out.push("|---|---|");
  out.push(`| Généré le | ${report.generatedAt} |`);
  out.push(`| Critère officiel | ${mdCell(report.criterion)} |`);
  out.push(`| Méthode | ${mdCell(report.method)} |`);
  out.push(`| Mesures retenues | ${combined.officialActions} actions QR réussies (attendu : ${report.expected.actionsPerDevice} iPhone + ${report.expected.actionsPerDevice} Android) |`);
  out.push(`| **Verdict** | **${mdCell(report.verdict.label)}** — ${mdCell(report.verdict.summary)} |`);
  out.push("");
  if (report.verdict.reasons.length) {
    out.push("Motifs :");
    out.push("");
    for (const reason of report.verdict.reasons) out.push(`- ${reason}`);
    out.push("");
  }

  out.push("## Exports et répartition");
  out.push("");
  out.push("| Appareil scanner | Fichier | Exporté le (horloge du téléphone) | Mesures | Actions QR réussies | Actions QR échouées | Lookups QR échoués | Saisie manuelle (exclue) | Origine inconnue (exclue) |");
  out.push("|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const device of PILOT_GATE.devices) {
    const summary = report.devices[device];
    if (!summary.present) {
      out.push(`| ${summary.label} | **manquant** | — | — | — | — | — | — | — |`);
      continue;
    }
    out.push(`| ${summary.label} | ${mdCell(summary.file ?? "—")} | ${summary.exportedAt} | ${summary.metricsCount} | ${summary.officialActions} | ${summary.failedActions} | ${summary.failedLookups} | ${summary.manualActions + summary.manualLookups} | ${summary.unknownSource} |`);
  }
  out.push(`| **Total** | | | ${present.reduce((total, summary) => total + summary.metricsCount, 0)} | **${combined.officialActions}** | ${combined.failedActions} | ${combined.failedLookups} | ${combined.manualActions + combined.manualLookups} | ${combined.unknownSource} |`);
  out.push("");
  const distributionOk = PILOT_GATE.devices.every((device) => report.devices[device].present && report.devices[device].officialActions === report.expected.actionsPerDevice);
  out.push(`Répartition attendue ${report.expected.actionsPerDevice}/${report.expected.actionsPerDevice} : ${distributionOk ? "respectée" : "**non respectée**"} (${PILOT_GATE.devices.map((device) => `${report.devices[device].label} ${report.devices[device].present ? report.devices[device].officialActions : "—"}`).join(" / ")}).`);
  out.push(`Actions retenues : ${combined.credits} crédit(s), ${combined.redeems} utilisation(s) de récompense. Échecs : ${formatCodes(combined.failureCodes)}.`);
  out.push("");

  out.push("## A. Preuve client / performance");
  out.push("");
  out.push(`### QR détecté → action validée (critère officiel, N = ${n})`);
  out.push("");
  out.push(`| Mesure | Rang nearest-rank | Combiné | ${present.map((summary) => summary.label).join(" | ")}${present.length ? " |" : ""}`);
  out.push(`|---|---:|---:|${present.map(() => "---:").join("|")}${present.length ? "|" : ""}`);
  for (const [key, percent] of [["p50", 50], ["p90", 90], ["p95", 95], ["max", 100]]) {
    out.push(`| ${key} | ${rankLabel(n, percent)} | ${formatDurationMs(combined.stats[key])} | ${present.map((summary) => formatDurationMs(summary.stats[key])).join(" | ")}${present.length ? " |" : ""}`);
  }
  out.push("");
  if (n > 0 && n < report.expected.totalActions) {
    out.push(`Calcul indicatif : N = ${n} < ${report.expected.totalActions}.`);
    out.push("");
  }
  out.push("### Seuils p95");
  out.push("");
  out.push("| Seuil | Règle | Source | Résultat |");
  out.push("|---|---|---|---|");
  for (const threshold of report.thresholds) {
    out.push(`| ${threshold.label} | ${threshold.rule} | ${mdCell(threshold.source)} | ${n > 0 ? yesNo(threshold.pass) : "—"} |`);
  }
  out.push("");
  if (report.decision.status !== "decided") {
    out.push(`**${report.decision.summary}.**`);
    out.push("");
  }
  out.push("### Diagnostic (informatif, hors critère officiel)");
  out.push("");
  out.push("| Mesure | Valeur |");
  out.push("|---|---|");
  out.push(`| p95 réseau des actions QR réussies | ${formatDurationMs(combined.networkP95)} |`);
  out.push(`| p95 serveur des actions QR réussies | ${formatDurationMs(combined.serverP95)} |`);
  out.push(`| Lookup QR → fiche client | N = ${combined.lookup.n}, p50 ${formatDurationMs(combined.lookup.p50)}, p95 ${formatDurationMs(combined.lookup.p95)}, max ${formatDurationMs(combined.lookup.max)} |`);
  for (const summary of present) {
    out.push(`| ${summary.label} : réseau p95 / serveur p95 / lookup p95 | ${formatDurationMs(summary.networkP95)} / ${formatDurationMs(summary.serverP95)} / ${formatDurationMs(summary.lookup.p95)} |`);
  }
  out.push("");
  out.push("### Contrôles automatiques");
  out.push("");
  for (const check of report.checks) out.push(`- ${check.ok ? "✅" : check.blocking ? "❌" : "⚠️"} ${check.message}`);
  out.push("");
  out.push("### Valeurs retenues, triées (preuve du calcul)");
  out.push("");
  if (combined.sorted.length === 0) {
    out.push("Aucune action QR réussie.");
  } else {
    out.push("| Rang | Temps total | Appareil scanner | Action | Horodatage (téléphone) |");
    out.push("|---:|---:|---|---|---|");
    for (const entry of combined.sorted) {
      out.push(`| ${entry.rank} | ${formatDurationMs(entry.totalMs)} | ${deviceLabel(entry.device)} | ${entry.action} | ${entry.at} |`);
    }
  }
  out.push("");

  out.push("## B. Preuve serveur / intégrité — à établir séparément");
  out.push("");
  out.push("Ce rapport ne lit aucune base de données : il ne prouve ni l'absence de double crédit ni la cohérence du ledger.");
  out.push("À joindre au dossier du gate (voir `docs/protocole-validation-physique-retiko.md`, preuve B) :");
  out.push("");
  out.push("- [ ] `npm run db:verify` vert (lecture seule) sur la production ou sur la restauration de la sauvegarde du jour : 0 solde négatif, 0 écart ledger/cache, 0 annulation multiple.");
  out.push(`- [ ] Transactions du commerce de test sur la fenêtre des actions : exactement ${combined.credits} \`earn\` et ${combined.redeems} \`redeem\`, aucune autre écriture inattendue.`);
  out.push("- [ ] Aucun override de cooldown (« Nouvel achat », audit `CARD_ADJUSTED`, source `cooldown_override`) pendant la série nominale.");
  out.push("- [ ] CI verte sur le commit testé (dont `fraud-concurrency`, `pilot-rush`, `ledger-immutability`).");
  out.push("");
  for (const summary of present) {
    out.push(`Fenêtre des actions ${summary.label} (horloge du téléphone) : ${windowText(summary.actionWindow)}.`);
  }
  if (present.length) out.push("");
  out.push("Les validations physiques (caméra, lumière, UX rush, Apple/Google Wallet, Safari iOS, Chrome Android) restent à établir par le testeur ; ce rapport ne les couvre pas.");
  out.push("");
  return `${out.join("\n")}`;
}
