// Preuve serveur du gate terrain : rapproche les actions réussies des exports
// /s/stats et les transactions du commerce de test sur la même fenêtre. Pur
// calcul : la lecture de la base (en transaction READ ONLY) vit dans
// scripts/pilot-ledger-audit.mjs. Types : pilot-ledger-audit.d.mts.
import { PILOT_GATE } from "./pilot-gate.mjs";

export const LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES = 1;
export const LEDGER_AUDIT_MAX_MARGIN_MINUTES = 60;

const STATUS_LABELS = { CONSISTENT: "COHÉRENT", TO_REVIEW: "À ANALYSER" };

/**
 * Fenêtres horaires (horloge des téléphones ± marge) et écritures attendues.
 * Chaque action réussie, QR ou saisie manuelle, doit laisser exactement une
 * transaction ; une action échouée n'en laisse aucune, mais elle élargit la
 * fenêtre pour qu'un crédit validé côté serveur malgré l'erreur soit visible.
 */
export function planLedgerAudit(exports, { marginMinutes = LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES } = {}) {
  if (!Number.isInteger(marginMinutes) || marginMinutes < 0 || marginMinutes > LEDGER_AUDIT_MAX_MARGIN_MINUTES) {
    throw new RangeError(`Marge invalide : ${marginMinutes} (entier de 0 à ${LEDGER_AUDIT_MAX_MARGIN_MINUTES} minutes)`);
  }
  const marginMs = marginMinutes * 60_000;
  const spans = [];
  for (const device of PILOT_GATE.devices) {
    const actions = (exports[device]?.metrics ?? []).filter((metric) => metric.phase === "action");
    if (actions.length === 0) continue;
    const times = actions.map((metric) => Date.parse(metric.at));
    const successes = actions.filter((metric) => metric.ok);
    spans.push({
      devices: [device],
      from: Math.min(...times) - marginMs,
      to: Math.max(...times) + marginMs,
      expected: {
        earn: successes.filter((metric) => metric.action === "credit").length,
        redeem: successes.filter((metric) => metric.action === "redeem").length,
      },
      failedActions: actions.length - successes.length,
    });
  }

  spans.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) {
      last.devices.push(...span.devices);
      last.to = Math.max(last.to, span.to);
      last.expected.earn += span.expected.earn;
      last.expected.redeem += span.expected.redeem;
      last.failedActions += span.failedActions;
    } else {
      merged.push({ ...span, devices: [...span.devices], expected: { ...span.expected } });
    }
  }
  return merged.map((window) => ({
    devices: window.devices,
    from: new Date(window.from).toISOString(),
    to: new Date(window.to).toISOString(),
    expected: window.expected,
    failedActions: window.failedActions,
  }));
}

function deviceNames(devices) {
  return devices.map((device) => PILOT_GATE.deviceLabels[device] ?? device).join(" + ");
}

/**
 * observations.windows[i] : comptes de transactions sur plan[i] ;
 * observations.cards : cohérence ledger/solde de toutes les cartes du commerce.
 */
export function evaluateLedgerAudit({ establishment, plan, observations, generatedAt = new Date().toISOString(), marginMinutes = LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES }) {
  if (plan.length === 0) throw new Error("Aucune action à rapprocher dans les exports fournis");
  if (observations.windows.length !== plan.length) throw new Error("Une observation par fenêtre est attendue");

  const checks = [];
  plan.forEach((window, index) => {
    const seen = observations.windows[index];
    const scope = `${deviceNames(window.devices)} (${window.from} → ${window.to})`;
    checks.push({
      id: `earn-${index}`,
      ok: seen.earn === window.expected.earn,
      message: seen.earn === window.expected.earn
        ? `${scope} : ${seen.earn} crédit(s) en base pour ${window.expected.earn} action(s) de crédit réussie(s)`
        : `${scope} : ${seen.earn} crédit(s) en base pour ${window.expected.earn} action(s) de crédit réussie(s) — ${seen.earn > window.expected.earn ? "écriture en trop (double crédit, crédit validé malgré une erreur ou activité hors série)" : "action réussie sans transaction (retry dédupliqué ou horloge décalée)"}`,
    });
    checks.push({
      id: `redeem-${index}`,
      ok: seen.redeem === window.expected.redeem,
      message: `${scope} : ${seen.redeem} utilisation(s) de récompense en base pour ${window.expected.redeem} attendue(s)`,
    });
    const unexpected = seen.adjust + seen.reversal + seen.overrides;
    checks.push({
      id: `unexpected-${index}`,
      ok: unexpected === 0,
      message: unexpected === 0
        ? `${scope} : aucun ajustement, annulation ni override de cooldown`
        : `${scope} : ${seen.adjust} ajustement(s), ${seen.reversal} annulation(s), ${seen.overrides} override(s) de cooldown pendant la série nominale`,
    });
  });
  const { cards } = observations;
  checks.push({
    id: "ledger",
    ok: cards.ledgerMismatches === 0 && cards.negativeBalances === 0,
    message: `${cards.total} carte(s) du commerce : ${cards.ledgerMismatches} écart(s) ledger/solde, ${cards.negativeBalances} solde(s) négatif(s)`,
  });

  const status = checks.every((check) => check.ok) ? "CONSISTENT" : "TO_REVIEW";
  return {
    auditVersion: 1,
    generatedAt,
    establishment,
    marginMinutes,
    readOnly: true,
    plan,
    observations,
    checks,
    verdict: { status, label: STATUS_LABELS[status], reasons: checks.filter((check) => !check.ok).map((check) => check.message) },
  };
}

export function renderLedgerAuditText(audit) {
  const lines = [];
  lines.push("Retiko — rapprochement ledger du gate terrain (lecture seule)");
  lines.push(`Commerce : ${audit.establishment}`);
  lines.push(`Généré le : ${audit.generatedAt}`);
  lines.push(`Marge autour des actions : ${audit.marginMinutes} min (horloges des téléphones)`);
  lines.push("");
  audit.plan.forEach((window, index) => {
    const seen = audit.observations.windows[index];
    lines.push(`Fenêtre ${index + 1} — ${deviceNames(window.devices)} : ${window.from} → ${window.to}`);
    lines.push(`  attendu : ${window.expected.earn} crédit(s), ${window.expected.redeem} récompense(s) ; ${window.failedActions} action(s) échouée(s) côté téléphone`);
    lines.push(`  en base : ${seen.earn} crédit(s), ${seen.redeem} récompense(s), ${seen.adjust} ajustement(s), ${seen.reversal} annulation(s), ${seen.overrides} override(s), ${seen.cards} carte(s)`);
  });
  lines.push("");
  lines.push("Contrôles");
  for (const check of audit.checks) lines.push(`  [${check.ok ? "OK" : "KO"}] ${check.message}`);
  lines.push("");
  lines.push(`RAPPROCHEMENT : ${audit.verdict.label}`);
  lines.push("Compléter avec `npm run db:verify` (intégrité globale) ; ce rapprochement ne mesure aucune performance.");
  return `${lines.join("\n")}\n`;
}

export function renderLedgerAuditMarkdown(audit) {
  const out = [];
  out.push("# Rapprochement ledger du gate terrain Retiko");
  out.push("");
  out.push("> Preuve serveur / intégrité, obtenue en lecture seule (`BEGIN READ ONLY`). Elle ne mesure aucune performance ; la preuve client / performance est le rapport `pilot:field-report`.");
  out.push("");
  out.push("| Élément | Valeur |");
  out.push("|---|---|");
  out.push(`| Généré le | ${audit.generatedAt} |`);
  out.push(`| Commerce (slug) | ${audit.establishment} |`);
  out.push(`| Marge autour des actions | ${audit.marginMinutes} min |`);
  out.push(`| **Rapprochement** | **${audit.verdict.label}** |`);
  out.push("");
  out.push("| Fenêtre | Appareils | Début | Fin | Crédits attendus / en base | Récompenses attendues / en base | Ajustements | Annulations | Overrides |");
  out.push("|---:|---|---|---|---:|---:|---:|---:|---:|");
  audit.plan.forEach((window, index) => {
    const seen = audit.observations.windows[index];
    out.push(`| ${index + 1} | ${deviceNames(window.devices)} | ${window.from} | ${window.to} | ${window.expected.earn} / ${seen.earn} | ${window.expected.redeem} / ${seen.redeem} | ${seen.adjust} | ${seen.reversal} | ${seen.overrides} |`);
  });
  out.push("");
  for (const check of audit.checks) out.push(`- ${check.ok ? "✅" : "❌"} ${check.message}`);
  out.push("");
  out.push("À compléter par `npm run db:verify` sur la même base (intégrité globale : tenants, annulations multiples, gardes hard-delete).");
  out.push("");
  return out.join("\n");
}
