import { describe, expect, it } from "vitest";
import {
  BODY_BYTE_BUDGET,
  ITEM_NATURES,
  STATUS_ISSUE_TITLE,
  STATUS_MARKER,
  buildStatusModel,
  citesIssue,
  classifyChecklistItem,
  classifyLabels,
  classifyPullRequest,
  collectSnapshot,
  createGitHubClient,
  escapeMarkdown,
  filterCheckRunsByBranch,
  findGateSection,
  hasOrchestration,
  main,
  nextPageUrl,
  parseSpecChecklist,
  publishStatusReport,
  renderStatusReport,
  summarizeChecks,
  type CheckSummary,
  type GitHubCheckRun,
  type GitHubCheckSuite,
  type GitHubCommitStatus,
  type NormalizedIssue,
  type NormalizedPull,
  type StatusSnapshot,
} from "../scripts/retiko-status.mjs";

// Extrait fidèle de la structure de #88 : légende avec des cases d'exemple,
// sections numérotées, Gate pilote réel et section hors périmètre V1.
const SPEC_BODY = [
  "# Retiko V1 — Cahier des charges & avancement",
  "",
  "## Légende",
  "",
  "- [x] Terminé et vérifié",
  "- [ ] À faire / à vérifier",
  "",
  "## 2. Authentification",
  "",
  "- [x] Connexion",
  "- [ ] Mesurer et optimiser la latence réelle de connexion (séparer réseau / bcrypt / DB avant optimisation)",
  "",
  "## 3. Onboarding commerçant",
  "",
  "- [x] Création d'un établissement",
  "- [ ] Guide autonome d'installation / paramétrage commerçant, simple et visuel (#182)",
  "- [ ] Offre d'accompagnement / configuration assistée optionnelle, tarif à décider séparément (#182)",
  "",
  "```md",
  "- [ ] case dans un bloc de code, à ignorer",
  "## Faux titre dans un bloc de code",
  "```",
  "",
  "## 7. Scanner commerçant",
  "",
  "- [ ] Ouverture caméra rapide",
  "- [x] Détection QR",
  "- [ ] UX utilisable en rush",
  "",
  "## 10. Apple Wallet",
  "",
  "- [x] Génération du pass",
  "- [ ] Certificats Apple Wallet production",
  "- [ ] Test réel sur iPhone",
  "",
  "## 17. RGPD & conformité",
  "",
  "- [ ] CGU",
  "- [ ] Durées de conservation définies",
  "- [x] Export des données personnelles",
  "",
  "## 20. Billing",
  "",
  "- [ ] Activation Stripe en production (clés, prix et webhook configurés)",
  "",
  "## 23. Gate pilote réel",
  "",
  "📋 Protocole terrain : docs/protocole-validation-physique-retiko.md",
  "",
  "- [x] Signup → onboarding complet",
  "- [x] Aucun double crédit",
  "- [ ] 30 scans physiques réels",
  "- [ ] Tests iPhone",
  "- [ ] Tests Android",
  "- [ ] p95 conforme",
  "- [ ] Décision produit : seuil p95 officiel = 2 000 ou 2 500 ms (à inscrire dans `lib/pilot-gate.mjs`)",
  "- [ ] GO pilote 1 à 3 commerces",
  "",
  "## 24. Après lancement — Retiko POS & moteur comptable",
  "",
  "> **Hors périmètre V1.**",
  "",
  "- [ ] Concevoir Retiko POS / système de caisse",
  "- [ ] Connecteur ACD",
  "",
  "## Règle d'utilisation",
  "",
  "Cette issue est le tableau de bord principal.",
].join("\n");

const MAIN_SHA = "72d2ba5697228ea70cf5a32ecbf6d6234d98c596";
const NOW = new Date("2026-09-27T21:00:00Z");

function checks(overall: CheckSummary["overall"], failing: string[] = []): CheckSummary {
  const counts = { success: 0, failure: failing.length, pending: overall === "pending" ? 1 : 0, cancelled: 0, neutral: 0, skipped: 0 };
  if (overall === "success") counts.success = 3;
  const entries = [
    ...failing.map((name) => ({ name, outcome: "failure" as const, source: "check_run" as const, url: null })),
    ...(overall === "success" ? ["e2e", "probe", "quality"].map((name) => ({ name, outcome: "success" as const, source: "check_run" as const, url: null })) : []),
  ];
  return { overall, total: overall === "none" ? 0 : Math.max(entries.length, 1), counts, failing, pending: overall === "pending" ? ["e2e"] : [], entries };
}

function issue(number: number, title: string, labels: string[] = []): NormalizedIssue {
  return { number, title, url: null, state: "open", labels, author: "yassineimpe-bit", updatedAt: "2026-09-27T10:00:00Z", isPullRequest: false };
}

function pull(number: number, overrides: Partial<NormalizedPull> = {}): NormalizedPull {
  return {
    number,
    title: `PR ${number}`,
    url: null,
    draft: false,
    author: "yassineimpe-bit",
    labels: [],
    headSha: `sha${number}`,
    headRef: `branch-${number}`,
    baseRef: "main",
    updatedAt: "2026-09-27T10:00:00Z",
    mergeable: true,
    mergeableState: "clean",
    checks: checks("success"),
    detailsCollected: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    repository: "retiko/fidgo",
    serverUrl: "https://github.com",
    generatedAt: NOW,
    runUrl: null,
    branch: { name: "main", sha: MAIN_SHA, message: "docs: gate pilote (#219)", committedAt: "2026-09-27T19:51:00Z", checks: checks("success") },
    spec: { number: 88, title: "Retiko V1 — Cahier des charges & avancement", state: "open", body: SPEC_BODY, url: null },
    openIssues: [
      issue(88, "Retiko V1 — Cahier des charges & avancement"),
      issue(182, "Commercial readiness — guide de paramétrage autonome"),
      issue(207, "security(history): appliquer BACKOFFICE_VIEW"),
      issue(2, "Gate pilote : PostgreSQL réel, HTTPS et 30 scans terrain"),
    ],
    openPulls: [
      pull(221, { title: "docs: audit data lifecycle" }),
      pull(114, { title: "feat: suspend loyalty operations", mergeable: false, mergeableState: "dirty", labels: ["codex"] }),
      pull(51, { title: "chore(deps): bump next", author: "dependabot[bot]", mergeableState: "unstable", checks: checks("failure", ["e2e"]) }),
      pull(46, { title: "chore(deps): bump actions/checkout", author: "dependabot[bot]" }),
      pull(176, { title: "feat(android): TWA", draft: true, mergeable: null, mergeableState: "unknown" }),
    ],
    recentlyMerged: [
      { number: 219, title: "docs: compléter l’exécution du gate pilote physique", url: null, mergedAt: "2026-09-27T19:51:00Z", mergeCommitSha: MAIN_SHA, author: "yassineimpe-bit" },
      { number: 217, title: "fix(wallet): Google LoyaltyClass", url: null, mergedAt: "2026-09-27T18:46:00Z", mergeCommitSha: "0dac842aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", author: "yassineimpe-bit" },
    ],
    prDetailLimit: 40,
    statusIssue: null,
    duplicateStatusIssues: [],
    ...overrides,
  };
}

describe("#88 : sections et cases", () => {
  it("ignore la légende et les blocs de code, sépare le périmètre V1 de l'après-lancement", () => {
    const sections = parseSpecChecklist(SPEC_BODY);
    expect(sections.map((section) => [section.title, section.scope, section.checked, section.total])).toEqual([
      ["2. Authentification", "v1", 1, 2],
      ["3. Onboarding commerçant", "v1", 1, 3],
      ["7. Scanner commerçant", "v1", 1, 3],
      ["10. Apple Wallet", "v1", 1, 3],
      ["17. RGPD & conformité", "v1", 1, 3],
      ["20. Billing", "v1", 0, 1],
      ["23. Gate pilote réel", "v1", 2, 8],
      ["24. Après lancement — Retiko POS & moteur comptable", "post-v1", 0, 2],
    ]);
    expect(sections.flatMap((section) => section.items).some((item) => item.text.includes("bloc de code"))).toBe(false);
    expect(findGateSection(sections)?.title).toBe("23. Gate pilote réel");
    expect(parseSpecChecklist("")).toEqual([]);
    expect(findGateSection(parseSpecChecklist("## 1. Socle\n- [x] CI"))).toBeNull();
  });

  it("qualifie chaque case ouverte sans jamais en faire un bug", () => {
    const cases: [string, string, string][] = [
      ["30 scans physiques réels", "23. Gate pilote réel", "physical"],
      ["Tests iPhone", "23. Gate pilote réel", "physical"],
      ["Tests Android", "23. Gate pilote réel", "physical"],
      ["p95 conforme", "23. Gate pilote réel", "physical"],
      ["Décision produit : seuil p95 officiel = 2 000 ou 2 500 ms (à inscrire dans `lib/pilot-gate.mjs`)", "23. Gate pilote réel", "decision"],
      ["GO pilote 1 à 3 commerces", "23. Gate pilote réel", "decision"],
      ["Offre d'accompagnement / configuration assistée optionnelle, tarif à décider séparément (#182)", "3. Onboarding", "decision"],
      ["Compatibilité Safari iOS", "6. Carte client & PWA", "physical"],
      ["Ouverture caméra rapide", "7. Scanner commerçant", "physical"],
      ["UX utilisable en rush", "7. Scanner commerçant", "physical"],
      ["Test réel sur iPhone", "10. Apple Wallet", "physical"],
      ["Certificats Apple Wallet production", "10. Apple Wallet", "provider"],
      ["Publication générale de l’Issuer Google Wallet et test avec un compte Google client ordinaire", "11. Google Wallet", "provider"],
      ["Activation Stripe en production (clés, prix et webhook configurés)", "20. Billing", "provider"],
      ["Facturation", "20. Billing", "provider"],
      ["CGU", "17. RGPD & conformité", "legal"],
      ["Politique de confidentialité", "17. RGPD & conformité", "legal"],
      ["Sous-traitants / DPA documentés", "17. RGPD & conformité", "legal"],
      ["Durées de conservation définies", "17. RGPD & conformité", "legal"],
      ["Registre des traitements", "17. RGPD & conformité", "legal"],
      ["Organisation propriétaire", "15. Multi-établissements", "development"],
      ["Désactivation d'un employé", "4. Gestion des rôles", "development"],
      ["Mesurer et optimiser la latence réelle de connexion (séparer réseau / bcrypt / DB avant optimisation)", "2. Authentification", "development"],
    ];
    for (const [text, section, nature] of cases) expect([text, classifyChecklistItem(text, section)]).toEqual([text, nature]);
    for (const nature of Object.values(ITEM_NATURES)) expect(nature.label.toLowerCase()).not.toContain("bug");
  });

  it("repère les issues citées par #88 sans faux positif", () => {
    expect(citesIssue(SPEC_BODY, 182)).toBe(true);
    expect(citesIssue(SPEC_BODY, 18)).toBe(false);
    expect(citesIssue("voir &#182; et issues/182", 182)).toBe(false);
    expect(citesIssue("PR #1880", 188)).toBe(false);
    expect(citesIssue(null, 1)).toBe(false);
  });
});

describe("labels d'orchestration", () => {
  it("fonctionne sans aucun label d'orchestration", () => {
    const none = classifyLabels([{ name: "dependencies" }, "codex", {}]);
    expect(none).toEqual({ phase: [], agent: [], auto: [], risk: [], state: [], needsHuman: false });
    expect(hasOrchestration(none)).toBe(false);
    expect(hasOrchestration(classifyLabels(null))).toBe(false);
  });

  it("reconnaît phase / agent / auto / risk / state / needs-human, casse et espaces tolérés", () => {
    const labels = classifyLabels([
      { name: "State: Ready" },
      "agent:codex",
      "agent:mistral",
      "agent:claude",
      "Needs-Human",
      "risk:high",
      "phase:avant-pilote",
      "phase:500-1000",
      "auto:yes",
      "codex",
    ]);
    expect(labels).toEqual({
      phase: ["avant-pilote", "500-1000"],
      agent: ["claude", "codex", "mistral"],
      auto: ["yes"],
      risk: ["high"],
      state: ["ready"],
      needsHuman: true,
    });
    expect(hasOrchestration(labels)).toBe(true);
    expect(hasOrchestration(classifyLabels(["needs-human"]))).toBe(true);
  });
});

describe("checks et PR", () => {
  it("garde le dernier résultat par check, exclut le job retiko-status et intègre les statuts de commit", () => {
    const summary = summarizeChecks({
      checkRuns: [
        { id: 1, name: "quality", status: "completed", conclusion: "failure" },
        { id: 5, name: "quality", status: "completed", conclusion: "success" },
        { id: 3, name: "e2e", status: "in_progress", conclusion: null },
        { id: 4, name: "retiko-status", status: "in_progress", conclusion: null },
        { id: 6, name: "lint", status: "completed", conclusion: "skipped" },
      ],
      statuses: [
        { context: "Vercel", state: "pending", updated_at: "2026-09-27T10:00:00Z" },
        { context: "Vercel", state: "success", updated_at: "2026-09-27T11:00:00Z" },
      ],
    });
    expect(summary.entries.map((entry) => [entry.name, entry.outcome, entry.source])).toEqual([
      ["Vercel", "success", "status"],
      ["e2e", "pending", "check_run"],
      ["lint", "skipped", "check_run"],
      ["quality", "success", "check_run"],
    ]);
    expect(summary.overall).toBe("pending");
    expect(summary.pending).toEqual(["e2e"]);

    const outcome = (runs: GitHubCheckRun[], statuses: GitHubCommitStatus[] = []) => summarizeChecks({ checkRuns: runs, statuses }).overall;
    expect(outcome([])).toBe("none");
    expect(outcome([{ id: 1, name: "a", status: "completed", conclusion: "success" }])).toBe("success");
    expect(outcome([{ id: 1, name: "a", status: "completed", conclusion: "cancelled" }])).toBe("cancelled");
    expect(outcome([{ id: 1, name: "a", status: "completed", conclusion: "timed_out" }])).toBe("failure");
    expect(outcome([], [{ context: "ci/x", state: "error" }])).toBe("failure");
  });

  it("ne mélange pas les runs d'une autre branche poussée sur le même SHA", () => {
    const runs: GitHubCheckRun[] = [
      { id: 10, name: "quality", status: "completed", conclusion: "success", check_suite: { id: 1 } },
      { id: 20, name: "quality", status: "completed", conclusion: "cancelled", check_suite: { id: 2 } },
      { id: 30, name: "health", status: "completed", conclusion: "success", check_suite: { id: 3 } },
      { id: 40, name: "external", status: "completed", conclusion: "success" },
    ];
    const suites: GitHubCheckSuite[] = [
      { id: 1, head_branch: "main" },
      { id: 2, head_branch: "docs/autre-branche" },
      { id: 3, head_branch: null },
    ];
    expect(filterCheckRunsByBranch(runs, suites, "main").map((run) => run.id)).toEqual([10, 30, 40]);
    expect(summarizeChecks({ checkRuns: filterCheckRunsByBranch(runs, suites, "main") }).overall).toBe("success");
  });

  it("classe les PR selon ce que GitHub permet de déterminer", () => {
    const base = pull(1);
    const status = (overrides: Partial<NormalizedPull>) => classifyPullRequest({ ...base, ...overrides });
    expect(status({})).toBe("mergeable");
    expect(status({ draft: true, mergeable: false })).toBe("draft");
    expect(status({ detailsCollected: false })).toBe("not-analyzed");
    expect(status({ mergeable: false, mergeableState: "dirty" })).toBe("conflict");
    expect(status({ mergeableState: "unstable", checks: checks("failure", ["quality"]) })).toBe("ci-failure");
    expect(status({ mergeable: null, mergeableState: "unknown" })).toBe("mergeability-unknown");
    expect(status({ checks: checks("pending") })).toBe("ci-pending");
    expect(status({ checks: { ...checks("success"), overall: "cancelled" } })).toBe("ci-incomplete");
    expect(status({ mergeableState: "behind" })).toBe("behind");
    expect(status({ mergeableState: "blocked" })).toBe("blocked");
    expect(status({ checks: checks("none") })).toBe("mergeable-no-checks");
  });
});

describe("échappement Markdown", () => {
  it("neutralise tableaux, HTML, liens, mise en forme et mentions", () => {
    expect(escapeMarkdown("a | b")).toBe("a \\| b");
    expect(escapeMarkdown("<img src=x onerror=alert(1)>")).toBe("\\<img src=x onerror=alert(1)\\>");
    expect(escapeMarkdown("[clic](javascript:alert(1))")).toBe("\\[clic\\](javascript:alert(1))");
    expect(escapeMarkdown("*gras* _it_ ~barré~ `code` \\")).toBe("\\*gras\\* \\_it\\_ \\~barré\\~ \\`code\\` \\\\");
    expect(escapeMarkdown("ping @everyone")).toBe("ping @​everyone");
    expect(escapeMarkdown("ligne 1\nligne 2\r\n\tfin")).toBe("ligne 1 ligne 2 fin");
    expect(escapeMarkdown(null)).toBe("");
  });
});

describe("rapport Markdown", () => {
  it("contient tous les blocs attendus, marqueur en tête", () => {
    const body = renderStatusReport(snapshot({ runUrl: "https://github.com/retiko/fidgo/actions/runs/42" }));
    expect(body.startsWith(`${STATUS_MARKER}\n# ${STATUS_ISSUE_TITLE}\n`)).toBe(true);
    expect(body).toContain("| Généré le | 2026-09-27 21:00 UTC |");
    expect(body).toContain(`| SHA \`main\` | [\`${MAIN_SHA}\`](https://github.com/retiko/fidgo/commit/${MAIN_SHA}) |`);
    expect(body).toContain("| Checks `main` | ✅ 3 |");
    expect(body).toContain("[workflow retiko-status](https://github.com/retiko/fidgo/actions/runs/42)");
    expect(body).toContain("**Périmètre V1 : 7 / 23 cases cochées dans #88.**");
    expect(body).toContain("« 24. Après lancement — Retiko POS & moteur comptable » est hors périmètre V1 (0 / 2)");
    expect(body).toContain("### 23. Gate pilote réel — 2 / 8");
    expect(body).toContain("| ⬜ | Tests iPhone | Test physique / terrain |");
    expect(body).toContain("| ⬜ | GO pilote 1 à 3 commerces | Décision humaine |");
    expect(body).toContain("| ✅ | Aucun double crédit |  |");
    // Section 2 : cases hors code, groupées par nature.
    expect(body).toContain("- **Activation fournisseur**\n  - 10. Apple Wallet — Certificats Apple Wallet production\n  - 20. Billing — Activation Stripe en production");
    expect(body).toContain("- **Validation juridique**\n  - 17. RGPD & conformité — CGU\n  - 17. RGPD & conformité — Durées de conservation définies");
    expect(body).toContain("- 🔀 Décision de merge : #221 — docs: audit data lifecycle (mergeable, checks verts ; le reporter ne merge jamais)");
    expect(body).toContain("- 🔀 Décision de merge, mises à jour de dépendances mergeables : #46");
    // Section 3 : actions mécaniques, sans priorité inventée.
    expect(body).toContain("L'ordre n'est **pas** une priorité produit");
    expect(body).toContain("- Résoudre le conflit de #114 avec `main`.");
    expect(body).toContain("- Corriger les checks de #51 : e2e.");
    expect(body).toContain("- Relire puis décider du merge de #221.");
    expect(body).toContain("- 2. Authentification — Mesurer et optimiser la latence réelle de connexion");
    // Section 4 : PR, mergeabilité et checks.
    expect(body).toContain("## 4. Pull requests ouvertes (5)");
    expect(body).toContain("- Mergeables selon GitHub (hors brouillons) : #221, #46");
    expect(body).toContain("- En conflit : #114");
    expect(body).toContain("| #114 | feat: suspend loyalty operations | yassineimpe-bit | ⚠️ Conflit avec la base | non (`dirty`) | ✅ 3 | codex |");
    expect(body).toContain("| #176 | feat(android): TWA | yassineimpe-bit | 📝 Brouillon | inconnu (`unknown`) | ✅ 3 | — |");
    expect(body).toContain("### Mises à jour de dépendances (2)");
    expect(body).toContain("| #51 | chore(deps): bump next | dependabot\\[bot\\] | ❌ Checks en échec | oui (`unstable`) | ❌ 1 — échec : e2e | — |");
    // Section 5 : #88 et l'issue d'état ne sont pas listées comme backlog.
    expect(body).toContain("## 5. Issues ouvertes (3)");
    expect(body).toContain("| #182 | Commercial readiness — guide de paramétrage autonome | — | cité |");
    expect(body).toContain("| #207 | security(history): appliquer BACKOFFICE\\_VIEW | — |  |");
    expect(body).not.toMatch(/^\| #88 \|/m);
    expect(body).toContain("_Aucun label d'orchestration (`phase:`, `agent:`, `auto:`, `risk:`, `state:`, `needs-human`) n'est posé");
    expect(body).toContain("| #219 | docs: compléter l’exécution du gate pilote physique | 2026-09-27 19:51 UTC | `72d2ba5` |");
    expect(body).toContain("## 8. Checks connus sur `main`");
    expect(body).toContain("| quality | check run | ✅ succès |");
  });

  it("ne déclare jamais un test physique fait parce que la CI est verte", () => {
    const allGreen = snapshot({
      openPulls: [pull(300, { title: "test(e2e): parcours pilote complet vert" })],
      recentlyMerged: [{ number: 299, title: "test: 30 scans physiques simulés", url: null, mergedAt: "2026-09-27T20:00:00Z", mergeCommitSha: MAIN_SHA, author: "a" }],
    });
    const model = buildStatusModel(allGreen);
    expect(model.gateOpen.map((item) => [item.text, item.nature])).toEqual([
      ["30 scans physiques réels", "physical"],
      ["Tests iPhone", "physical"],
      ["Tests Android", "physical"],
      ["p95 conforme", "physical"],
      ["Décision produit : seuil p95 officiel = 2 000 ou 2 500 ms (à inscrire dans `lib/pilot-gate.mjs`)", "decision"],
      ["GO pilote 1 à 3 commerces", "decision"],
    ]);
    const body = renderStatusReport(allGreen);
    expect(body).toContain("| ⬜ | 30 scans physiques réels | Test physique / terrain |");
    expect(body).toContain("un test automatisé vert ne la valide jamais");
    expect(body).toContain("Une case ouverte n'est pas un bug.");
    expect(body).not.toMatch(/✅ \| 30 scans physiques/);
  });

  it("est déterministe : même données dans un autre ordre, même rapport", () => {
    const base = snapshot();
    const shuffled = snapshot({
      openIssues: [...base.openIssues].reverse(),
      openPulls: [...base.openPulls].reverse(),
      generatedAt: NOW.toISOString(),
    });
    expect(renderStatusReport(shuffled)).toBe(renderStatusReport(base));
  });

  it("échappe les titres hostiles", () => {
    const body = renderStatusReport(snapshot({ openIssues: [issue(300, "<script>x</script> | @everyone [lien](https://evil) **gras**")] }));
    expect(body).toContain("| #300 | \\<script\\>x\\</script\\> \\| @​everyone \\[lien\\](https://evil) \\*\\*gras\\*\\* | — |  |");
    expect(body).not.toContain("<script>");
  });

  it("remonte incident, needs-human, blocage, doublons et section Gate absente", () => {
    const body = renderStatusReport(snapshot({
      spec: { number: 88, title: "Spec", state: "open", body: "## 1. Socle\n- [ ] CI", url: null },
      openIssues: [
        issue(500, "[monitoring] Retiko production incident"),
        issue(501, "Valider le DPA Neon", ["needs-human"]),
        issue(502, "Brancher Stripe", ["state:blocked", "agent:codex"]),
        issue(503, "Durcir le ledger", ["state:ready", "agent:claude", "risk:low"]),
        issue(504, "Relire l'audit", ["state:review", "state:ready"]),
        issue(900, STATUS_ISSUE_TITLE),
        issue(950, STATUS_ISSUE_TITLE),
      ],
      openPulls: [],
      branch: { name: "main", sha: MAIN_SHA, message: "x", committedAt: null, checks: checks("failure", ["health"]) },
      statusIssue: { number: 900, state: "open", url: null },
      duplicateStatusIssues: [950],
    }));
    expect(body).toContain("- 🚨 Incident de production ouvert par la surveillance : #500");
    expect(body).toContain("- ❌ Checks en échec sur `main` : health");
    expect(body).toContain("- ⚠️ Section « Gate pilote réel » introuvable dans #88");
    expect(body).toContain("- 🙋 `needs-human` : #501 — Valider le DPA Neon");
    expect(body).toContain("- ⛔ `state:blocked` : #502 — Brancher Stripe");
    expect(body).toContain("- ⚠️ Doublon de l'issue d'état : #950 (non mis à jour, à fermer manuellement)");
    expect(body).toContain("- Rétablir les checks de `main` : health.");
    expect(body).toContain("- Prendre en charge #503 (`state:ready`, `agent:claude`).");
    expect(body).toContain("- Relire #504 (`state:review`).");
    expect(body).toContain("| `state:ready` | 2 | #504, #503 |");
    expect(body).toContain("| `state:blocked` | 1 | #502 |");
    expect(body).toContain("| _sans `state:`_ | 1 | #501 |");
    expect(body).toContain("Répartition : `agent:claude` 1 · `agent:codex` 1 · `needs-human` 1 · `risk:low` 1");
    expect(body).toContain("⚠️ Plusieurs `state:` sur : #504");
    expect(body).toContain("| #502 | Brancher Stripe | agent:codex, state:blocked |  | state:blocked, agent:codex |");
    expect(body).not.toMatch(/\| #9[05]0 \|/);
  });

  it("reste sous la limite de taille GitHub, marqueur conservé", () => {
    const many = Array.from({ length: 2_000 }, (_, index) => issue(10_000 + index, `hardening(zone-${index}): ${"très long titre ".repeat(8)}`));
    const body = renderStatusReport(snapshot({ openIssues: many }));
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(BODY_BYTE_BUDGET);
    expect(body.startsWith(STATUS_MARKER)).toBe(true);
    expect(body).toContain("Rapport tronqué pour respecter la limite");
  });
});

// ---------------------------------------------------------------------------
// Faux GitHub en mémoire : pagination par en-tête Link, comme l'API REST.
// ---------------------------------------------------------------------------

type RawIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  body?: string;
  labels?: { name: string }[];
  user?: { login: string };
  pull_request?: Record<string, never>;
};
type RawPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft?: boolean;
  user?: { login: string };
  labels?: { name: string }[];
  head: { sha: string; ref: string };
  base: { ref: string };
  updated_at: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  mergeable?: (boolean | null)[];
  mergeable_state?: string;
};
type FakeState = {
  issues: RawIssue[];
  pulls: RawPull[];
  checkRuns: Record<string, GitHubCheckRun[]>;
  checkSuites: Record<string, GitHubCheckSuite[]>;
  statuses: Record<string, GitHubCommitStatus[]>;
};
type Call = { method: string; path: string; body?: Record<string, unknown>; authorization: string | null };
type Fault = (call: Call) => Response | "network" | undefined;

const REPO = "/repos/retiko/fidgo";

function fakeGitHub(state: FakeState, fault?: Fault) {
  const calls: Call[] = [];
  let nextNumber = 1_000;
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

  async function fetchImpl(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const call: Call = {
      method,
      path: `${url.pathname}${url.search}`,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      authorization: headers.get("authorization"),
    };
    calls.push(call);
    const injected = fault?.(call);
    if (injected === "network") throw new TypeError("fetch failed");
    if (injected) return injected;

    const path = url.pathname.startsWith(REPO) ? url.pathname.slice(REPO.length) : url.pathname;
    const query = url.searchParams;
    const paged = <T,>(items: T[], key?: string) => {
      const perPage = Number(query.get("per_page") ?? 30);
      const page = Number(query.get("page") ?? 1);
      const slice = items.slice((page - 1) * perPage, page * perPage);
      const extra: Record<string, string> = {};
      if (page * perPage < items.length) {
        const next = new URL(url);
        next.searchParams.set("page", String(page + 1));
        extra.link = `<${next.href}>; rel="next"`;
      }
      return json(key ? { total_count: items.length, [key]: slice } : slice, 200, extra);
    };
    const asIssue = (pullRequest: RawPull): RawIssue => ({ number: pullRequest.number, title: pullRequest.title, state: pullRequest.state, pull_request: {} });
    let match: RegExpExecArray | null;

    if (method === "GET" && path === "/branches/main") {
      return json({ name: "main", commit: { sha: MAIN_SHA, commit: { message: "docs: gate pilote (#219)\n\ndétail", committer: { date: "2026-09-27T19:51:00Z" } } } });
    }
    if (method === "GET" && path === "/issues") {
      const creator = query.get("creator");
      const all = [...state.issues, ...state.pulls.map(asIssue)]
        .filter((entry) => entry.state === query.get("state"))
        .filter((entry) => !creator || entry.user?.login === creator)
        .sort((a, b) => b.number - a.number);
      return paged(all);
    }
    if ((match = /^\/issues\/(\d+)$/.exec(path))) {
      const found = state.issues.find((entry) => entry.number === Number(match![1]));
      if (!found) return json({ message: "Not Found" }, 404);
      if (method === "GET") return json({ ...found, html_url: `https://github.com/retiko/fidgo/issues/${found.number}` });
      if (method === "PATCH") {
        Object.assign(found, call.body);
        return json({ ...found, html_url: `https://github.com/retiko/fidgo/issues/${found.number}` });
      }
    }
    if (method === "POST" && path === "/issues") {
      const created: RawIssue = { number: nextNumber++, title: String(call.body?.title), body: String(call.body?.body), state: "open", user: { login: "github-actions[bot]" } };
      state.issues.push(created);
      return json({ ...created, html_url: `https://github.com/retiko/fidgo/issues/${created.number}` }, 201);
    }
    if (method === "GET" && path === "/pulls") {
      const list = state.pulls.filter((entry) => entry.state === query.get("state"));
      if (query.get("sort") === "updated") list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      else list.sort((a, b) => b.number - a.number);
      // normalizePull ignore `mergeable` : la liste REST ne le fournit pas.
      return paged(list);
    }
    if (method === "GET" && (match = /^\/pulls\/(\d+)$/.exec(path))) {
      const found = state.pulls.find((entry) => entry.number === Number(match![1]));
      if (!found) return json({ message: "Not Found" }, 404);
      const sequence = found.mergeable ?? [true];
      const mergeable = sequence.length > 1 ? sequence.shift() : sequence[0];
      return json({ ...found, mergeable, mergeable_state: found.mergeable_state ?? "clean" });
    }
    if (method === "GET" && (match = /^\/commits\/(\w+)\/check-runs$/.exec(path))) {
      return paged([...(state.checkRuns[match[1]] ?? [])].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)), "check_runs");
    }
    if (method === "GET" && (match = /^\/commits\/(\w+)\/check-suites$/.exec(path))) {
      return paged([...(state.checkSuites[match[1]] ?? [])].sort((a, b) => a.id - b.id), "check_suites");
    }
    if (method === "GET" && (match = /^\/check-suites\/(\d+)\/check-runs$/.exec(path))) {
      const suiteId = Number(match[1]);
      return paged(Object.values(state.checkRuns).flat().filter((run) => run.check_suite?.id === suiteId), "check_runs");
    }
    if (method === "GET" && (match = /^\/commits\/(\w+)\/status$/.exec(path))) {
      return json({ state: "success", statuses: state.statuses[match[1]] ?? [] });
    }
    return json({ message: `route inconnue : ${method} ${path}` }, 404);
  }

  const writes = () => calls.filter((call) => call.method !== "GET");
  return { fetchImpl, calls, writes, state };
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    issues: [
      { number: 88, title: "Retiko V1 — Cahier des charges & avancement", state: "open", body: SPEC_BODY, user: { login: "yassineimpe-bit" } },
      { number: 182, title: "Commercial readiness — guide", state: "open", user: { login: "yassineimpe-bit" } },
      { number: 207, title: "security(history): BACKOFFICE_VIEW", state: "open", labels: [{ name: "state:ready" }], user: { login: "yassineimpe-bit" } },
    ],
    pulls: [
      { number: 221, title: "docs: audit", state: "open", head: { sha: "pr221", ref: "docs/audit" }, base: { ref: "main" }, updated_at: "2026-09-27T20:00:00Z" },
      { number: 114, title: "feat: trial", state: "open", head: { sha: "pr114", ref: "codex/trial" }, base: { ref: "main" }, updated_at: "2026-09-27T11:00:00Z", mergeable: [false], mergeable_state: "dirty" },
      { number: 219, title: "docs: gate", state: "closed", head: { sha: MAIN_SHA, ref: "docs/gate" }, base: { ref: "main" }, updated_at: "2026-09-27T19:52:00Z", merged_at: "2026-09-27T19:51:00Z", merge_commit_sha: MAIN_SHA },
      { number: 200, title: "feat: abandonnée", state: "closed", head: { sha: "x", ref: "x" }, base: { ref: "main" }, updated_at: "2026-09-27T19:00:00Z", merged_at: null },
    ],
    checkRuns: {
      [MAIN_SHA]: [
        { id: 10, name: "quality", status: "completed", conclusion: "success", check_suite: { id: 1 } },
        { id: 11, name: "e2e", status: "completed", conclusion: "success", check_suite: { id: 1 } },
        { id: 20, name: "quality", status: "completed", conclusion: "cancelled", check_suite: { id: 2 } },
        { id: 30, name: "retiko-status", status: "in_progress", conclusion: null, check_suite: { id: 3 } },
      ],
      pr221: [{ id: 40, name: "quality", status: "completed", conclusion: "success", check_suite: { id: 4 } }],
      pr114: [{ id: 50, name: "quality", status: "completed", conclusion: "failure", check_suite: { id: 5 } }],
    },
    checkSuites: {
      [MAIN_SHA]: [
        { id: 1, head_branch: "main", latest_check_runs_count: 2 },
        { id: 2, head_branch: "docs/autre-branche", latest_check_runs_count: 1 },
        { id: 3, head_branch: "main", latest_check_runs_count: 1 },
      ],
      pr221: [{ id: 4, head_branch: "docs/audit", latest_check_runs_count: 1 }],
      pr114: [{ id: 5, head_branch: "codex/trial", latest_check_runs_count: 1 }],
    },
    statuses: { pr221: [{ context: "Vercel", state: "success", updated_at: "2026-09-27T20:01:00Z" }] },
    ...overrides,
  };
}

const noSleep = async () => {};
const ENV = { GITHUB_REPOSITORY: "retiko/fidgo", GITHUB_TOKEN: "ghs_test", GITHUB_ACTIONS: "true" };

async function runMain(fake: ReturnType<typeof fakeGitHub>, argv: string[] = [], env: Record<string, string | undefined> = ENV) {
  let stdout = "";
  let stderr = "";
  const status = await main(argv, {
    env,
    fetchImpl: fake.fetchImpl,
    now: () => NOW,
    sleep: noSleep,
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });
  return { status, stdout, stderr };
}

describe("client GitHub", () => {
  it("suit la pagination Link au-delà de 20 issues et PR", async () => {
    const issues: RawIssue[] = [
      { number: 88, title: "Spec", state: "open", body: SPEC_BODY },
      ...Array.from({ length: 150 }, (_, index): RawIssue => ({ number: 300 + index, title: `issue ${index}`, state: "open" })),
    ];
    const pulls: RawPull[] = Array.from({ length: 45 }, (_, index): RawPull => ({
      number: 600 + index,
      title: `pr ${index}`,
      state: "open",
      head: { sha: `s${index}`, ref: `b${index}` },
      base: { ref: "main" },
      updated_at: "2026-09-27T10:00:00Z",
    }));
    const fake = fakeGitHub(fakeState({ issues, pulls, checkRuns: {}, checkSuites: {}, statuses: {} }));
    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: fake.fetchImpl, sleep: noSleep });
    const collected = await collectSnapshot(client, { sleep: noSleep });
    // /issues renvoie aussi les PR : elles sont écartées de la liste d'issues.
    expect(collected.openIssues).toHaveLength(151);
    expect(collected.openIssues.every((entry) => !entry.isPullRequest)).toBe(true);
    expect(collected.openPulls).toHaveLength(45);
    expect(collected.openPulls.filter((entry) => entry.detailsCollected)).toHaveLength(40);
    expect(collected.openPulls.at(-1)).toMatchObject({ number: 600, detailsCollected: false });
    expect(fake.calls.filter((call) => call.path.startsWith(`${REPO}/issues?state=open`)).length).toBeGreaterThan(1);
    expect(fake.calls.every((call) => call.authorization === "Bearer t")).toBe(true);
  });

  it("filtre les checks par branche et retrouve la CI enfouie sous la surveillance planifiée", async () => {
    // 450 runs « health » planifiés, plus récents que la CI du push : au-delà
    // des trois pages de check runs lues, la CI n'est retrouvée que par sa suite.
    const health = Array.from({ length: 450 }, (_, index): GitHubCheckRun => ({ id: 1_000 + index, name: "health", status: "completed", conclusion: "success", check_suite: { id: 100 + index } }));
    const state = fakeState({
      pulls: [],
      checkRuns: {
        [MAIN_SHA]: [
          { id: 10, name: "quality", status: "completed", conclusion: "failure", check_suite: { id: 1 } },
          { id: 20, name: "quality", status: "completed", conclusion: "cancelled", check_suite: { id: 2 } },
          ...health,
        ],
      },
      checkSuites: {
        [MAIN_SHA]: [
          { id: 1, head_branch: "main", latest_check_runs_count: 1 },
          { id: 2, head_branch: "docs/autre-branche", latest_check_runs_count: 1 },
          ...health.map((run) => ({ id: run.check_suite!.id, head_branch: "main", latest_check_runs_count: 1 })),
        ],
      },
    });
    const fake = fakeGitHub(state);
    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: fake.fetchImpl, sleep: noSleep });
    const collected = await collectSnapshot(client, { sleep: noSleep });
    expect(collected.branch.checks.entries.map((entry) => [entry.name, entry.outcome])).toEqual([
      ["health", "success"],
      ["quality", "failure"],
    ]);
    expect(fake.calls.some((call) => call.path.startsWith(`${REPO}/check-suites/1/check-runs`))).toBe(true);
    expect(fake.calls.some((call) => call.path.startsWith(`${REPO}/check-suites/2/check-runs`))).toBe(false);
  });

  it("s'arrête dès que les 10 PR mergées les plus récentes sont connues", async () => {
    const closed = Array.from({ length: 250 }, (_, index): RawPull => {
      const at = new Date(Date.UTC(2026, 8, 27, 23, 59) - index * 60_000).toISOString();
      return {
        number: 1_000 - index,
        title: `pr ${index}`,
        state: "closed",
        head: { sha: `c${index}`, ref: `c${index}` },
        base: { ref: "main" },
        updated_at: at,
        merged_at: index % 2 === 0 ? at : null,
        merge_commit_sha: `m${index}`,
      };
    });
    const fake = fakeGitHub(fakeState({ pulls: closed }));
    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: fake.fetchImpl, sleep: noSleep });
    const collected = await collectSnapshot(client, { sleep: noSleep });
    expect(collected.recentlyMerged.map((entry) => entry.number)).toEqual([1000, 998, 996, 994, 992, 990, 988, 986, 984, 982]);
    expect(fake.calls.filter((call) => call.path.startsWith(`${REPO}/pulls?state=closed`))).toHaveLength(1);
  });

  it("redemande une fois la mergeabilité que GitHub n'a pas encore calculée", async () => {
    const state = fakeState();
    state.pulls[0].mergeable = [null, true];
    const fake = fakeGitHub(state);
    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: fake.fetchImpl, sleep: noSleep });
    const collected = await collectSnapshot(client, { sleep: noSleep });
    expect(collected.openPulls.find((entry) => entry.number === 221)).toMatchObject({ mergeable: true, mergeableState: "clean" });
    expect(fake.calls.filter((call) => call.path === `${REPO}/pulls/221`)).toHaveLength(2);
    expect(fake.calls.filter((call) => call.path === `${REPO}/pulls/114`)).toHaveLength(1);
  });

  it("réessaie les erreurs transitoires puis échoue clairement", async () => {
    let failures = 2;
    const flaky = fakeGitHub(fakeState(), () => (failures-- > 0 ? new Response("{}", { status: 503 }) : undefined));
    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: flaky.fetchImpl, sleep: noSleep });
    await expect(client.get(`${REPO}/branches/main`)).resolves.toMatchObject({ commit: { sha: MAIN_SHA } });

    const down = fakeGitHub(fakeState(), () => "network");
    const downClient = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: down.fetchImpl, sleep: noSleep });
    await expect(downClient.get(`${REPO}/branches/main`)).rejects.toThrow("GitHub injoignable (GET /repos/retiko/fidgo/branches/main) après 3 tentative(s) : fetch failed");

    const outage = fakeGitHub(fakeState(), () => new Response(JSON.stringify({ message: "Service Unavailable" }), { status: 503 }));
    const outageClient = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: outage.fetchImpl, sleep: noSleep });
    await expect(outageClient.get(`${REPO}/issues/88`)).rejects.toThrow("GitHub a répondu HTTP 503 à GET /repos/retiko/fidgo/issues/88 après 3 tentative(s) : Service Unavailable");

    const limited = fakeGitHub(fakeState(), () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790550000" },
    }));
    const limitedClient = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: limited.fetchImpl, sleep: noSleep });
    await expect(limitedClient.get(`${REPO}/issues/88`)).rejects.toThrow("API rate limit exceeded (quota API épuisé jusqu'à 2026-09-27T23:00:00.000Z)");
    expect(limited.calls).toHaveLength(1);

    const unauthorized = fakeGitHub(fakeState(), () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));
    const unauthorizedClient = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: unauthorized.fetchImpl, sleep: noSleep });
    await expect(unauthorizedClient.get(`${REPO}/issues/88`)).rejects.toThrow("Bad credentials (GITHUB_TOKEN absent, expiré ou invalide)");
  });

  it("n'envoie jamais le jeton hors de l'API GitHub", async () => {
    const fake = fakeGitHub(fakeState(), (call) => (call.path.includes("issues?state=open") && !call.path.includes("&page=")
      ? new Response("[]", { status: 200, headers: { link: '<https://evil.example/steal?page=2>; rel="next"' } })
      : undefined));
    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: fake.fetchImpl, sleep: noSleep });
    await expect(client.paginate(`${REPO}/issues?state=open&per_page=100`)).rejects.toThrow("URL hors de l'API GitHub refusée");
    expect(fake.calls.every((call) => call.path.startsWith(REPO))).toBe(true);
    expect(nextPageUrl('<https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"')).toBe("https://api.github.com/x?page=3");
    expect(nextPageUrl(null)).toBeNull();
    expect(() => createGitHubClient({ repository: "pas-un-depot" })).toThrow("format attendu owner/nom");
  });
});

describe("publication de l'issue d'état", () => {
  it("crée l'issue au premier lancement puis remplace son body, sans jamais écrire ailleurs", async () => {
    const fake = fakeGitHub(fakeState());
    const first = await runMain(fake);
    expect(first).toMatchObject({ status: 0, stderr: "" });
    expect(first.stdout).toBe("Issue d'état #1000 créée : https://github.com/retiko/fidgo/issues/1000\n");
    expect(fake.writes()).toEqual([
      expect.objectContaining({ method: "POST", path: `${REPO}/issues`, body: { title: STATUS_ISSUE_TITLE, body: expect.stringContaining(STATUS_MARKER) } }),
    ]);
    const created = fake.state.issues.find((entry) => entry.number === 1_000)!;
    expect(created.body).toContain("### 23. Gate pilote réel — 2 / 8");
    // Les checks d'une autre branche au même SHA et le job retiko-status sont ignorés.
    expect(created.body).toContain("| Checks `main` | ✅ 2 |");
    expect(created.body).toContain("| #114 | feat: trial | — | ⚠️ Conflit avec la base | non (`dirty`) | ❌ 1 — échec : quality | — |");
    expect(created.body).toContain("| #221 | docs: audit | — | ✅ Mergeable, checks verts | oui (`clean`) | ✅ 2 | — |");
    expect(created.body).toContain("| #219 | docs: gate | 2026-09-27 19:51 UTC | `72d2ba5` |");

    fake.state.issues.find((entry) => entry.number === 207)!.title = "security(history): titre modifié";
    const second = await runMain(fake);
    expect(second.stdout).toBe("Issue d'état #1000 mise à jour : https://github.com/retiko/fidgo/issues/1000\n");
    const writes = fake.writes();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ method: "PATCH", path: `${REPO}/issues/1000` });
    expect(Object.keys(writes[1].body ?? {})).toEqual(["body"]);
    expect(created.body).toContain("titre modifié");
    expect(fake.state.issues.filter((entry) => entry.title === STATUS_ISSUE_TITLE)).toHaveLength(1);
    const spec = fake.state.issues.find((entry) => entry.number === 88)!;
    expect(spec).toMatchObject({ state: "open", body: SPEC_BODY });
  });

  it("rouvre l'issue d'état fermée plutôt que d'en créer une seconde", async () => {
    const state = fakeState();
    state.issues.push({ number: 950, title: STATUS_ISSUE_TITLE, state: "closed", body: STATUS_MARKER, user: { login: "github-actions[bot]" } });
    const fake = fakeGitHub(state);
    const result = await runMain(fake);
    expect(result.stdout).toContain("Issue d'état #950 rouverte et mise à jour");
    expect(fake.writes()).toEqual([expect.objectContaining({ method: "PATCH", path: `${REPO}/issues/950`, body: expect.objectContaining({ state: "open" }) })]);
  });

  it("met à jour la plus ancienne en cas de doublon et signale les autres sans les fermer", async () => {
    const state = fakeState();
    state.issues.push(
      { number: 960, title: STATUS_ISSUE_TITLE, state: "open", body: "", user: { login: "github-actions[bot]" } },
      { number: 955, title: STATUS_ISSUE_TITLE, state: "open", body: "", user: { login: "github-actions[bot]" } },
    );
    const fake = fakeGitHub(state);
    await runMain(fake);
    expect(fake.writes()).toEqual([expect.objectContaining({ method: "PATCH", path: `${REPO}/issues/955` })]);
    expect(fake.state.issues.find((entry) => entry.number === 955)!.body).toContain("Doublon de l'issue d'état : #960");
    expect(fake.state.issues.find((entry) => entry.number === 960)).toMatchObject({ state: "open", body: "" });
  });

  it("ne prend jamais #88 pour l'issue d'état et refuse d'y écrire", async () => {
    const state = fakeState();
    state.issues[0].title = STATUS_ISSUE_TITLE;
    const fake = fakeGitHub(state);
    await runMain(fake);
    expect(fake.writes()).toEqual([expect.objectContaining({ method: "POST", path: `${REPO}/issues` })]);
    expect(fake.state.issues[0]).toMatchObject({ number: 88, body: SPEC_BODY, state: "open" });

    const client = createGitHubClient({ repository: "retiko/fidgo", token: "t", fetchImpl: fake.fetchImpl, sleep: noSleep });
    const body = renderStatusReport(snapshot());
    await expect(publishStatusReport(client, { body, statusIssue: { number: 88, state: "open", url: null } })).rejects.toThrow("Refus d'écrire dans #88");
    await expect(publishStatusReport(client, { body: "sans marqueur", statusIssue: null })).rejects.toThrow("body sans marqueur");
  });

  it("n'écrit rien si GitHub tombe pendant la collecte", async () => {
    const fake = fakeGitHub(fakeState(), (call) => (call.path.startsWith(`${REPO}/pulls?state=open`) ? "network" : undefined));
    const result = await runMain(fake);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::retiko-status : GitHub injoignable \(GET \/repos\/retiko\/fidgo\/pulls\?state=open&per_page=100\) après 3 tentative\(s\) : fetch failed — aucun rapport publié\.\n$/);
    expect(fake.writes()).toEqual([]);

    const missingSpec = fakeGitHub(fakeState({ issues: [] }));
    const missing = await runMain(missingSpec);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("HTTP 404 à GET /repos/retiko/fidgo/issues/88");
    expect(missingSpec.writes()).toEqual([]);
  });

  it("--dry-run affiche le rapport sans jeton ni écriture ; arguments invalides refusés", async () => {
    const fake = fakeGitHub(fakeState());
    const dry = await runMain(fake, ["--dry-run"], { GITHUB_REPOSITORY: "retiko/fidgo" });
    expect(dry.status).toBe(0);
    expect(dry.stdout.startsWith(STATUS_MARKER)).toBe(true);
    expect(fake.writes()).toEqual([]);
    expect(fake.calls.every((call) => call.authorization === null)).toBe(true);

    const noToken = await runMain(fake, [], { GITHUB_REPOSITORY: "retiko/fidgo" });
    expect(noToken.status).toBe(2);
    expect(noToken.stderr).toContain("GITHUB_TOKEN requis pour publier");
    expect((await runMain(fake, ["--inconnu"])).status).toBe(2);
    expect((await runMain(fake, ["--spec-issue", "abc"])).status).toBe(2);
    expect((await runMain(fake, [], { GITHUB_TOKEN: "t" })).status).toBe(2);
    expect(fake.writes()).toEqual([]);
  });
});
