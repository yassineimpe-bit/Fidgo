// État courant Retiko publié dans UNE issue GitHub « RETIKO — ÉTAT COURANT »,
// dont le body est remplacé à chaque génération (jamais de fil de commentaires).
//
// Vue en lecture seule des sources de vérité existantes : #88 (fonctionnel),
// issues (backlog), PR et checks (développement). Aucune seconde base d'état,
// aucune API IA, aucun secret autre que GITHUB_TOKEN. Les seules écritures
// possibles sont la création de l'issue d'état au premier lancement et le
// remplacement de son body : le script ne coche, ne ferme et ne merge rien, et
// refuse d'écrire dans l'issue de référence.
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const STATUS_ISSUE_TITLE = "RETIKO — ÉTAT COURANT";
export const STATUS_MARKER = "<!-- retiko-status:managed -->";
export const DEFAULT_SPEC_ISSUE = 88;
export const DEFAULT_BRANCH = "main";
// Nom du job du workflow retiko-status : ses propres check runs sont exclus,
// sinon chaque exécution verrait `main` « en cours » à cause d'elle-même.
export const STATUS_CHECK_NAME = "retiko-status";
// Titre de l'issue ouverte par .github/workflows/production-monitor.yml.
export const MONITORING_INCIDENT_TITLE = "[monitoring] Retiko production incident";
export const PR_DETAIL_LIMIT = 40;
export const RECENT_MERGED_LIMIT = 10;
// GitHub limite un body d'issue à 65 536 caractères. Le budget est compté en
// octets UTF-8, plus strict, pour rester sous la limite quel que soit le décompte.
export const BODY_BYTE_BUDGET = 65_000;

export const ITEM_NATURES = Object.freeze({
  physical: Object.freeze({ label: "Test physique / terrain", human: true }),
  decision: Object.freeze({ label: "Décision humaine", human: true }),
  provider: Object.freeze({ label: "Activation fournisseur", human: true }),
  legal: Object.freeze({ label: "Validation juridique", human: true }),
  development: Object.freeze({ label: "Développement ou vérification", human: false }),
});

// Labels d'orchestration reconnus s'ils existent. Aucun n'est requis : sans
// eux, le rapport reste complet et le signale.
export const ORCHESTRATION_FAMILIES = Object.freeze({
  phase: Object.freeze(["avant-pilote", "apres-pilote", "traction", "500-1000"]),
  agent: Object.freeze(["claude", "codex", "deepseek", "gemini", "grok"]),
  auto: Object.freeze(["yes"]),
  risk: Object.freeze(["low", "medium", "high"]),
  state: Object.freeze(["ready", "running", "review", "blocked"]),
});
export const NEEDS_HUMAN_LABEL = "needs-human";

const DEPENDENCY_BOTS = /^(dependabot|renovate)(\[bot\])?$/i;

// ---------------------------------------------------------------------------
// Texte et Markdown
// ---------------------------------------------------------------------------

function fold(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Échappe une donnée externe (titre, label, case #88, nom de check) pour une
// ligne ou une cellule de tableau : pas de saut de ligne, pas de HTML, pas de
// lien ni de mise en forme injectés, pas de mention @ qui notifierait à chaque
// régénération.
export function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\\`*_[\]<>|~]/g, "\\$&")
    .replace(/@(?=[\w-])/g, "@​")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatUtc(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/, 1)[0];
}

function byNumberDesc(a, b) {
  return b.number - a.number;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ref(number) {
  return `#${number}`;
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

// Coupe à une frontière de ligne pour tenir dans la limite GitHub.
export function fitBody(body, budget = BODY_BYTE_BUDGET) {
  if (Buffer.byteLength(body, "utf8") <= budget) return body;
  const notice = "\n\n> [!WARNING]\n> Rapport tronqué pour respecter la limite de taille d'un body d'issue GitHub.\n";
  const available = budget - Buffer.byteLength(notice, "utf8");
  const kept = [];
  let used = 0;
  for (const line of body.split("\n")) {
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (used + size > available) break;
    kept.push(line);
    used += size;
  }
  return `${kept.join("\n")}${notice}`;
}

// ---------------------------------------------------------------------------
// #88 : sections et cases à cocher
// ---------------------------------------------------------------------------

// L'ordre compte : une décision explicite prime sur le reste (« Décision
// produit : seuil p95… » n'est pas un test physique), puis le juridique, les
// activations fournisseur et enfin les validations sur appareil/terrain.
const NATURE_RULES = [
  ["decision", /\bdecisions?\b|\bdecider\b|\bgo pilote\b|\barbitrage\b/],
  ["legal", /\bjuridiques?\b|\bcgu\b|\bcgv\b|mentions legales|politique de confidentialite|registre des traitements|\bdpa\b|\bsous-traitants?\b|\bdurees? de conservation\b|\bobligations? (legales?|francaises?)\b/],
  ["provider", /\bstripe\b|\bcertificats?\b|\bissuer\b|\bactivation\b|\bfacturation\b|\bneon\b|\bvercel\b|\bresend\b|\bdns\b|google play|app store/],
  ["physical", /\bphysiques?\b|\bterrain\b|\biphone\b|\bandroid\b|\bsafari\b|\bp95\b|\brush\b|\bcamera\b|\bappareils?\b|\btests? reels?\b/],
];
const SECTION_NATURE_FALLBACK = [["legal", /\brgpd\b|\bconformite\b|\bjuridique\b|\blegal/]];

// Nature d'une case #88. Une case ouverte n'est jamais qualifiée de bug : ce
// qui ne relève pas d'un humain reste « développement ou vérification ».
export function classifyChecklistItem(text, sectionTitle = "") {
  const itemText = fold(text);
  for (const [nature, pattern] of NATURE_RULES) {
    if (pattern.test(itemText)) return nature;
  }
  const section = fold(sectionTitle);
  for (const [nature, pattern] of SECTION_NATURE_FALLBACK) {
    if (pattern.test(section)) return nature;
  }
  return "development";
}

function sectionScope(title) {
  const folded = fold(title);
  if (/\blegende\b/.test(folded)) return "legend";
  if (/apres lancement|hors perimetre/.test(folded)) return "post-v1";
  return "v1";
}

// Découpe le body de #88 en sections `## …` et en cases `- [ ]` / `- [x]`.
// La légende (exemples de cases) et les blocs de code sont ignorés.
export function parseSpecChecklist(body) {
  const sections = [];
  let current = null;
  let fence = null;
  for (const line of String(body ?? "").split(/\r?\n/)) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^\s{0,3}##(?!#)\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      current = { title: heading[1], scope: sectionScope(heading[1]), items: [] };
      sections.push(current);
      continue;
    }
    const box = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/.exec(line);
    if (box && current) {
      current.items.push({ checked: box[1] !== " ", text: box[2], nature: classifyChecklistItem(box[2], current.title) });
    }
  }
  return sections
    .filter((section) => section.scope !== "legend" && section.items.length > 0)
    .map((section) => ({
      ...section,
      checked: section.items.filter((item) => item.checked).length,
      total: section.items.length,
    }));
}

export function findGateSection(sections) {
  return sections.find((section) => /\bgate pilote reel\b/.test(fold(section.title))) ?? null;
}

// Vrai si le body cite #number (pas #1880 pour #188, pas une entité HTML).
export function citesIssue(body, number) {
  return new RegExp(`(?<![\\w&])#${number}(?!\\d)`).test(String(body ?? ""));
}

// ---------------------------------------------------------------------------
// Labels, checks et PR
// ---------------------------------------------------------------------------

export function classifyLabels(labels) {
  const result = { phase: [], agent: [], auto: [], risk: [], state: [], needsHuman: false };
  for (const label of labels ?? []) {
    const name = fold(typeof label === "string" ? label : label?.name).trim();
    if (!name) continue;
    if (name === NEEDS_HUMAN_LABEL) {
      result.needsHuman = true;
      continue;
    }
    const match = /^(phase|agent|auto|risk|state)\s*:\s*(\S.*)$/.exec(name);
    if (match && !result[match[1]].includes(match[2])) result[match[1]].push(match[2]);
  }
  for (const family of Object.keys(ORCHESTRATION_FAMILIES)) {
    result[family].sort((a, b) => orchestrationRank(family, a) - orchestrationRank(family, b) || compareText(a, b));
  }
  return result;
}

function orchestrationRank(family, value) {
  const index = ORCHESTRATION_FAMILIES[family].indexOf(value);
  return index === -1 ? ORCHESTRATION_FAMILIES[family].length : index;
}

export function hasOrchestration(classification) {
  return classification.needsHuman || Object.keys(ORCHESTRATION_FAMILIES).some((family) => classification[family].length > 0);
}

function orchestrationTags(classification) {
  const tags = [];
  for (const family of ["state", "agent", "phase", "risk", "auto"]) {
    for (const value of classification[family]) tags.push(`${family}:${value}`);
  }
  if (classification.needsHuman) tags.push(NEEDS_HUMAN_LABEL);
  return tags;
}

const CHECK_RUN_OUTCOMES = {
  success: "success",
  neutral: "neutral",
  skipped: "skipped",
  cancelled: "cancelled",
  failure: "failure",
  timed_out: "failure",
  action_required: "failure",
  startup_failure: "failure",
  stale: "failure",
};

// Résume les check runs (GitHub Actions et apps) et les statuts de commit
// (Vercel…) d'un commit : dernier résultat par nom, job retiko-status exclu.
export function summarizeChecks({ checkRuns = [], statuses = [] } = {}, { exclude = [STATUS_CHECK_NAME] } = {}) {
  const latestRuns = new Map();
  for (const run of checkRuns) {
    if (!run?.name || exclude.includes(run.name)) continue;
    const previous = latestRuns.get(run.name);
    if (!previous || (run.id ?? 0) > (previous.id ?? 0)) latestRuns.set(run.name, run);
  }
  const entries = [];
  for (const run of latestRuns.values()) {
    const outcome = run.status !== "completed" ? "pending" : CHECK_RUN_OUTCOMES[run.conclusion] ?? "pending";
    entries.push({ name: run.name, outcome, source: "check_run", url: run.html_url ?? null });
  }
  const latestStatuses = new Map();
  for (const status of statuses) {
    if (!status?.context || exclude.includes(status.context)) continue;
    const previous = latestStatuses.get(status.context);
    if (!previous || String(status.updated_at ?? "") > String(previous.updated_at ?? "")) latestStatuses.set(status.context, status);
  }
  for (const status of latestStatuses.values()) {
    const outcome = status.state === "success" ? "success" : status.state === "pending" ? "pending" : "failure";
    entries.push({ name: status.context, outcome, source: "status", url: status.target_url ?? null });
  }
  entries.sort((a, b) => compareText(a.name, b.name) || compareText(a.source, b.source));

  const counts = { success: 0, failure: 0, pending: 0, cancelled: 0, neutral: 0, skipped: 0 };
  for (const entry of entries) counts[entry.outcome] += 1;
  const overall = entries.length === 0 ? "none"
    : counts.failure > 0 ? "failure"
      : counts.pending > 0 ? "pending"
        : counts.cancelled > 0 ? "cancelled"
          : "success";
  return {
    overall,
    total: entries.length,
    counts,
    failing: entries.filter((entry) => entry.outcome === "failure").map((entry) => entry.name),
    pending: entries.filter((entry) => entry.outcome === "pending").map((entry) => entry.name),
    entries,
  };
}

export const PULL_STATUSES = Object.freeze({
  draft: "📝 Brouillon",
  "not-analyzed": "… Non analysée (au-delà de la limite)",
  conflict: "⚠️ Conflit avec la base",
  "ci-failure": "❌ Checks en échec",
  "mergeability-unknown": "❔ Mergeabilité non calculée par GitHub",
  "ci-pending": "⏳ Checks en cours",
  "ci-incomplete": "⏹️ Checks annulés",
  behind: "↩️ En retard sur la base",
  blocked: "🔒 Bloquée par une règle de protection",
  "mergeable-no-checks": "✅ Mergeable, aucun check connu",
  mergeable: "✅ Mergeable, checks verts",
});

// Statut d'une PR ouverte à partir de ce que GitHub expose. `mergeable` vaut
// null tant que GitHub n'a pas fini son calcul : ce n'est ni oui ni non.
export function classifyPullRequest(pull) {
  if (pull.draft) return "draft";
  if (!pull.detailsCollected) return "not-analyzed";
  if (pull.mergeable === false || pull.mergeableState === "dirty") return "conflict";
  if (pull.checks?.overall === "failure") return "ci-failure";
  if (pull.mergeable !== true || pull.mergeableState === "unknown") return "mergeability-unknown";
  if (pull.checks?.overall === "pending") return "ci-pending";
  if (pull.checks?.overall === "cancelled") return "ci-incomplete";
  if (pull.mergeableState === "behind") return "behind";
  if (pull.mergeableState === "blocked") return "blocked";
  if (!pull.checks || pull.checks.overall === "none") return "mergeable-no-checks";
  return "mergeable";
}

export function isDependencyPull(pull) {
  return DEPENDENCY_BOTS.test(pull.author ?? "");
}

export function isStatusIssueCandidate(issue, specIssue = DEFAULT_SPEC_ISSUE) {
  return !issue.isPullRequest
    && issue.number !== specIssue
    && String(issue.title ?? "").normalize("NFC").trim() === STATUS_ISSUE_TITLE;
}

// ---------------------------------------------------------------------------
// Normalisation des réponses REST
// ---------------------------------------------------------------------------

function labelNames(labels) {
  return (labels ?? [])
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter(Boolean)
    .sort(compareText);
}

export function normalizeIssue(raw) {
  return {
    number: raw.number,
    title: raw.title ?? "",
    url: raw.html_url ?? null,
    state: raw.state ?? "open",
    labels: labelNames(raw.labels),
    author: raw.user?.login ?? null,
    updatedAt: raw.updated_at ?? null,
    isPullRequest: Boolean(raw.pull_request),
  };
}

export function normalizePull(raw) {
  return {
    number: raw.number,
    title: raw.title ?? "",
    url: raw.html_url ?? null,
    draft: Boolean(raw.draft),
    author: raw.user?.login ?? null,
    labels: labelNames(raw.labels),
    headSha: raw.head?.sha ?? null,
    headRef: raw.head?.ref ?? null,
    baseRef: raw.base?.ref ?? null,
    updatedAt: raw.updated_at ?? null,
    mergeable: null,
    mergeableState: null,
    checks: null,
    detailsCollected: false,
  };
}

// Les `limit` PR mergées les plus récentes (merged_at décroissant).
export function selectRecentlyMerged(closedPulls, limit = RECENT_MERGED_LIMIT) {
  return closedPulls
    .filter((pull) => pull.merged_at)
    .map((pull) => ({
      number: pull.number,
      title: pull.title ?? "",
      url: pull.html_url ?? null,
      mergedAt: pull.merged_at,
      mergeCommitSha: pull.merge_commit_sha ?? null,
      author: pull.user?.login ?? null,
    }))
    .sort((a, b) => compareText(b.mergedAt, a.mergedAt) || b.number - a.number)
    .slice(0, limit);
}

// Liste triée par updated_at décroissant : comme merged_at ≤ updated_at, dès
// que la page la plus ancienne est antérieure à la k-ième fusion la plus
// récente, aucune page suivante ne peut contenir une fusion plus récente.
function enoughMerged(limit) {
  return (items, page) => {
    const merged = items.filter((pull) => pull.merged_at).map((pull) => pull.merged_at).sort().reverse();
    if (merged.length < limit) return false;
    const oldestOnPage = page.at(-1)?.updated_at;
    return !oldestOnPage || oldestOnPage <= merged[limit - 1];
  };
}

// ---------------------------------------------------------------------------
// Client REST GitHub minimal (fetch natif, aucune dépendance)
// ---------------------------------------------------------------------------

export class GitHubApiError extends Error {
  constructor(message, { status = 0, request = "" } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.request = request;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

export function nextPageUrl(linkHeader) {
  return /<([^>]+)>\s*;\s*rel="next"/.exec(linkHeader ?? "")?.[1] ?? null;
}

export function createGitHubClient({
  repository,
  token = null,
  apiUrl = "https://api.github.com",
  fetchImpl = globalThis.fetch,
  retries = 2,
  retryDelayMs = 1_000,
  timeoutMs = 30_000,
  sleep = defaultSleep,
} = {}) {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repository ?? "");
  if (!match) throw new TypeError(`Dépôt invalide « ${repository ?? ""} » : format attendu owner/nom.`);
  const apiBase = String(apiUrl).replace(/\/+$/, "");
  const apiOrigin = new URL(apiBase).origin;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "retiko-status",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  async function request(method, pathOrUrl, payload) {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${apiBase}${pathOrUrl}`;
    const parsed = new URL(url);
    const label = `${method} ${parsed.pathname}${parsed.search}`;
    // Le jeton ne part jamais vers un autre hôte, même via un en-tête Link.
    if (parsed.origin !== apiOrigin) throw new GitHubApiError(`URL hors de l'API GitHub refusée : ${label}`, { request: label });

    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: payload === undefined ? headers : { ...headers, "Content-Type": "application/json" },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt <= retries) {
          await sleep(retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw new GitHubApiError(`GitHub injoignable (${label}) après ${attempt} tentative(s) : ${errorText(error)}`, { request: label });
      }

      if (response.ok) {
        const text = await response.text();
        try {
          return { data: text ? JSON.parse(text) : null, headers: response.headers };
        } catch {
          throw new GitHubApiError(`Réponse GitHub illisible (${label}) : JSON invalide.`, { status: response.status, request: label });
        }
      }

      const retryable = response.status >= 500 || response.status === 429;
      if (retryable && attempt <= retries) {
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        continue;
      }
      let detail = "";
      try {
        const text = await response.text();
        try {
          detail = JSON.parse(text)?.message ?? text;
        } catch {
          detail = text;
        }
      } catch {
        detail = "";
      }
      let message = `GitHub a répondu HTTP ${response.status} à ${label}`;
      if (retryable) message += ` après ${attempt} tentative(s)`;
      if (detail) message += ` : ${String(detail).slice(0, 300)}`;
      if (response.status === 401) message += " (GITHUB_TOKEN absent, expiré ou invalide)";
      if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        message += reset > 0 ? ` (quota API épuisé jusqu'à ${new Date(reset * 1000).toISOString()})` : " (quota API épuisé)";
      }
      throw new GitHubApiError(message, { status: response.status, request: label });
    }
  }

  async function paginate(path, { itemsKey = null, maxPages = 30, stopAtLimit = false, until = null } = {}) {
    const items = [];
    let next = path;
    for (let page = 1; next; page += 1) {
      if (page > maxPages) {
        if (stopAtLimit) break;
        throw new GitHubApiError(`Pagination interrompue après ${maxPages} pages (${path}) : volume inattendu, rapport non publié.`, { request: `GET ${path}` });
      }
      const { data, headers: responseHeaders } = await request("GET", next);
      const pageItems = itemsKey ? data?.[itemsKey] : data;
      if (!Array.isArray(pageItems)) throw new GitHubApiError(`Réponse GitHub inattendue (GET ${path}) : liste absente.`, { request: `GET ${path}` });
      items.push(...pageItems);
      if (until?.(items, pageItems)) break;
      next = nextPageUrl(responseHeaders.get("link"));
    }
    return items;
  }

  return {
    repository: `${match[1]}/${match[2]}`,
    repoPath: `/repos/${match[1]}/${match[2]}`,
    get: async (path) => (await request("GET", path)).data,
    post: async (path, payload) => (await request("POST", path, payload)).data,
    patch: async (path, payload) => (await request("PATCH", path, payload)).data,
    paginate,
  };
}

// ---------------------------------------------------------------------------
// Collecte (lecture seule)
// ---------------------------------------------------------------------------

// Un même SHA peut être poussé sur plusieurs branches (création d'une branche
// depuis main, par exemple) : seuls les check runs dont la suite appartient à
// la branche observée comptent. Une suite absente de la liste reste comptée.
export function filterCheckRunsByBranch(checkRuns, checkSuites, branch) {
  const branchBySuite = new Map(checkSuites.map((suite) => [suite.id, suite.head_branch ?? null]));
  return checkRuns.filter((run) => {
    const suiteId = run.check_suite?.id;
    if (suiteId === undefined || !branchBySuite.has(suiteId)) return true;
    const headBranch = branchBySuite.get(suiteId);
    return headBranch === null || headBranch === branch;
  });
}

async function collectChecks(client, sha, branch) {
  const repo = client.repoPath;
  // Les check runs arrivent du plus récent au plus ancien : la limite de pages
  // garde les derniers résultats (surveillance planifiée comprise).
  const checkRuns = await client.paginate(`${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`, { itemsKey: "check_runs", maxPages: 3, stopAtLimit: true });
  // Les suites arrivent de la plus ancienne à la plus récente : la première
  // page contient celles créées par le push du commit (CI), même quand des
  // centaines de runs planifiés se sont accumulés depuis sur le même SHA.
  const checkSuites = await client.paginate(`${repo}/commits/${sha}/check-suites?per_page=100`, { itemsKey: "check_suites", maxPages: 3, stopAtLimit: true });
  const seenSuites = new Set(checkRuns.map((run) => run.check_suite?.id));
  const missing = checkSuites
    .filter((suite) => (suite.head_branch ?? branch) === branch && suite.latest_check_runs_count > 0 && !seenSuites.has(suite.id))
    .slice(0, 10);
  for (const suite of missing) {
    checkRuns.push(...await client.paginate(`${repo}/check-suites/${suite.id}/check-runs?filter=latest&per_page=100`, { itemsKey: "check_runs", maxPages: 1, stopAtLimit: true }));
  }
  const combined = await client.get(`${repo}/commits/${sha}/status?per_page=100`);
  return summarizeChecks({ checkRuns: filterCheckRunsByBranch(checkRuns, checkSuites, branch), statuses: combined?.statuses ?? [] });
}

async function collectPullDetails(client, pull) {
  const detail = await client.get(`${client.repoPath}/pulls/${pull.number}`);
  pull.mergeable = typeof detail?.mergeable === "boolean" ? detail.mergeable : null;
  pull.mergeableState = detail?.mergeable_state ?? null;
}

export async function collectSnapshot(client, {
  specIssue = DEFAULT_SPEC_ISSUE,
  branch = DEFAULT_BRANCH,
  prDetailLimit = PR_DETAIL_LIMIT,
  recentMergedLimit = RECENT_MERGED_LIMIT,
  mergeabilityRetryMs = 3_000,
  sleep = defaultSleep,
} = {}) {
  const repo = client.repoPath;

  const branchData = await client.get(`${repo}/branches/${encodeURIComponent(branch)}`);
  const sha = branchData?.commit?.sha;
  if (!sha) throw new GitHubApiError(`Branche ${branch} : SHA introuvable dans la réponse GitHub.`);

  const specRaw = await client.get(`${repo}/issues/${specIssue}`);
  if (!specRaw || specRaw.pull_request) throw new GitHubApiError(`#${specIssue} n'est pas une issue : impossible de lire la référence fonctionnelle.`);

  const openIssues = (await client.paginate(`${repo}/issues?state=open&per_page=100`))
    .filter((issue) => !issue.pull_request)
    .map(normalizeIssue);

  const openPulls = (await client.paginate(`${repo}/pulls?state=open&per_page=100`)).map(normalizePull).sort(byNumberDesc);
  for (const pull of openPulls.slice(0, prDetailLimit)) {
    await collectPullDetails(client, pull);
    pull.checks = pull.headSha ? await collectChecks(client, pull.headSha, pull.headRef) : null;
    pull.detailsCollected = true;
  }
  // GitHub calcule la mergeabilité en tâche de fond au premier appel : un
  // second passage unique récupère la plupart des valeurs encore inconnues.
  const unknown = openPulls.filter((pull) => pull.detailsCollected && !pull.draft && pull.mergeable === null);
  if (unknown.length > 0) {
    await sleep(mergeabilityRetryMs);
    for (const pull of unknown) await collectPullDetails(client, pull);
  }

  const branchChecks = await collectChecks(client, sha, branch);
  const closedPulls = await client.paginate(`${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`, {
    maxPages: 5,
    stopAtLimit: true,
    until: enoughMerged(recentMergedLimit),
  });

  return {
    repository: client.repository,
    branch: {
      name: branch,
      sha,
      message: firstLine(branchData.commit.commit?.message),
      committedAt: branchData.commit.commit?.committer?.date ?? branchData.commit.commit?.author?.date ?? null,
      checks: branchChecks,
    },
    spec: {
      number: specRaw.number,
      title: specRaw.title ?? "",
      state: specRaw.state ?? "open",
      body: specRaw.body ?? "",
      url: specRaw.html_url ?? null,
    },
    openIssues,
    openPulls,
    recentlyMerged: selectRecentlyMerged(closedPulls, recentMergedLimit),
    prDetailLimit,
  };
}

// Retrouve l'issue d'état existante (ouverte, sinon fermée par le bot). La
// plus ancienne fait foi ; les autres sont signalées, jamais fermées.
export async function findStatusIssue(client, openIssues, { specIssue = DEFAULT_SPEC_ISSUE } = {}) {
  let candidates = openIssues.filter((issue) => isStatusIssueCandidate(issue, specIssue));
  if (candidates.length === 0) {
    const creator = encodeURIComponent("github-actions[bot]");
    const closed = await client.paginate(`${client.repoPath}/issues?state=closed&creator=${creator}&per_page=100`, { maxPages: 10, stopAtLimit: true });
    candidates = closed.map(normalizeIssue).filter((issue) => isStatusIssueCandidate(issue, specIssue));
  }
  candidates = [...candidates].sort((a, b) => a.number - b.number);
  return {
    statusIssue: candidates[0] ? { number: candidates[0].number, state: candidates[0].state, url: candidates[0].url } : null,
    duplicateStatusIssues: candidates.slice(1).map((issue) => issue.number),
  };
}

// Seules écritures du script : créer l'issue d'état au premier lancement, ou
// remplacer son body (et la rouvrir si quelqu'un l'a fermée). Jamais de titre,
// de fermeture, de label ni d'écriture dans l'issue de référence.
export async function publishStatusReport(client, { body, statusIssue, specIssue = DEFAULT_SPEC_ISSUE }) {
  if (!body.startsWith(STATUS_MARKER)) throw new Error("Refus de publier : body sans marqueur retiko-status.");
  if (Buffer.byteLength(body, "utf8") > BODY_BYTE_BUDGET) throw new Error("Refus de publier : body au-delà de la limite GitHub.");
  if (statusIssue) {
    if (statusIssue.number === specIssue) throw new Error(`Refus d'écrire dans #${specIssue}, l'issue de référence fonctionnelle.`);
    const patch = statusIssue.state === "open" ? { body } : { body, state: "open" };
    const updated = await client.patch(`${client.repoPath}/issues/${statusIssue.number}`, patch);
    return { action: patch.state ? "reopened" : "updated", number: statusIssue.number, url: updated?.html_url ?? statusIssue.url };
  }
  const created = await client.post(`${client.repoPath}/issues`, { title: STATUS_ISSUE_TITLE, body });
  return { action: "created", number: created.number, url: created.html_url ?? null };
}

// ---------------------------------------------------------------------------
// Modèle et rendu
// ---------------------------------------------------------------------------

export function buildStatusModel(snapshot) {
  const specNumber = snapshot.spec.number;
  const sections = parseSpecChecklist(snapshot.spec.body);
  const v1Sections = sections.filter((section) => section.scope === "v1");
  const postV1Sections = sections.filter((section) => section.scope === "post-v1");
  const gate = findGateSection(sections);
  const statusNumbers = new Set([snapshot.statusIssue?.number, ...(snapshot.duplicateStatusIssues ?? [])].filter(Boolean));

  const issues = snapshot.openIssues
    .filter((issue) => issue.number !== specNumber && !statusNumbers.has(issue.number) && !isStatusIssueCandidate(issue, specNumber))
    .map((issue) => ({
      ...issue,
      orchestration: classifyLabels(issue.labels),
      citedBySpec: citesIssue(snapshot.spec.body, issue.number),
      incident: issue.title === MONITORING_INCIDENT_TITLE,
    }))
    .sort(byNumberDesc);

  const pulls = snapshot.openPulls
    .map((pull) => ({
      ...pull,
      orchestration: classifyLabels(pull.labels),
      status: classifyPullRequest(pull),
      dependency: isDependencyPull(pull),
    }))
    .sort(byNumberDesc);

  const orchestrated = [...issues.map((item) => ({ ...item, kind: "issue" })), ...pulls.map((item) => ({ ...item, kind: "pull" }))]
    .filter((item) => hasOrchestration(item.orchestration))
    .sort(byNumberDesc);

  const openItems = (list) => list.flatMap((section) => section.items.filter((item) => !item.checked).map((item) => ({ ...item, section: section.title })));
  const gateOpen = gate ? openItems([gate]) : [];
  const otherOpen = openItems(v1Sections.filter((section) => section !== gate));

  const failingBranch = snapshot.branch.checks?.failing ?? [];
  const human = [];
  for (const issue of issues.filter((item) => item.incident)) {
    human.push(`🚨 Incident de production ouvert par la surveillance : ${ref(issue.number)}`);
  }
  if (failingBranch.length > 0) {
    human.push(`❌ Checks en échec sur \`${escapeMarkdown(snapshot.branch.name)}\` : ${failingBranch.map(escapeMarkdown).join(", ")}`);
  }
  if (snapshot.spec.state !== "open") {
    human.push(`⚠️ ${ref(specNumber)} est à l'état « ${escapeMarkdown(snapshot.spec.state)} » : la référence fonctionnelle devrait rester ouverte.`);
  }
  if (!gate) {
    human.push(`⚠️ Section « Gate pilote réel » introuvable dans ${ref(specNumber)} : le suivi des validations pilote est à vérifier.`);
  }
  for (const item of orchestrated.filter((entry) => entry.orchestration.needsHuman)) {
    human.push(`🙋 \`${NEEDS_HUMAN_LABEL}\` : ${ref(item.number)} — ${escapeMarkdown(item.title)}`);
  }
  for (const item of orchestrated.filter((entry) => entry.orchestration.state.includes("blocked"))) {
    human.push(`⛔ \`state:blocked\` : ${ref(item.number)} — ${escapeMarkdown(item.title)}`);
  }
  const mergeable = pulls.filter((entry) => entry.status === "mergeable" || entry.status === "mergeable-no-checks");
  for (const pull of mergeable.filter((entry) => !entry.dependency)) {
    human.push(`🔀 Décision de merge : ${ref(pull.number)} — ${escapeMarkdown(pull.title)} (${PULL_STATUSES[pull.status].replace(/^✅ /, "").toLowerCase()} ; le reporter ne merge jamais)`);
  }
  const mergeableDependencies = mergeable.filter((entry) => entry.dependency);
  if (mergeableDependencies.length > 0) {
    human.push(`🔀 Décision de merge, mises à jour de dépendances mergeables : ${mergeableDependencies.map((pull) => ref(pull.number)).join(", ")}`);
  }
  for (const number of snapshot.duplicateStatusIssues ?? []) {
    human.push(`⚠️ Doublon de l'issue d'état : ${ref(number)} (non mis à jour, à fermer manuellement)`);
  }

  const next = [];
  const addNext = (group, text) => {
    const existing = next.find((entry) => entry.group === group);
    if (existing) existing.items.push(text);
    else next.push({ group, items: [text] });
  };
  if (failingBranch.length > 0) addNext("CI et intégration", `Rétablir les checks de \`${escapeMarkdown(snapshot.branch.name)}\` : ${failingBranch.map(escapeMarkdown).join(", ")}.`);
  const base = (pull) => `\`${escapeMarkdown(pull.baseRef ?? snapshot.branch.name)}\``;
  for (const pull of pulls.filter((entry) => entry.status === "conflict")) addNext("CI et intégration", `Résoudre le conflit de ${ref(pull.number)} avec ${base(pull)}.`);
  for (const pull of pulls.filter((entry) => entry.status === "ci-failure")) addNext("CI et intégration", `Corriger les checks de ${ref(pull.number)} : ${pull.checks.failing.map(escapeMarkdown).join(", ")}.`);
  for (const pull of pulls.filter((entry) => entry.status === "behind")) addNext("CI et intégration", `Mettre ${ref(pull.number)} à jour avec ${base(pull)}.`);
  for (const pull of mergeable.filter((entry) => !entry.dependency)) addNext("Revue", `Relire puis décider du merge de ${ref(pull.number)}.`);
  if (mergeableDependencies.length > 0) addNext("Revue", `Relire puis décider du merge des mises à jour de dépendances ${mergeableDependencies.map((pull) => ref(pull.number)).join(", ")}.`);
  for (const item of orchestrated.filter((entry) => entry.orchestration.state.includes("review"))) addNext("Revue", `Relire ${ref(item.number)} (\`state:review\`).`);
  for (const item of orchestrated.filter((entry) => entry.orchestration.state.includes("ready"))) {
    const agents = item.orchestration.agent.map((agent) => `agent:${agent}`);
    addNext("Backlog orchestré", `Prendre en charge ${ref(item.number)} (\`state:ready\`${agents.length ? `, ${agents.map((agent) => `\`${escapeMarkdown(agent)}\``).join(", ")}` : ""}).`);
  }
  for (const item of gateOpen) addNext(`Gate pilote réel (${ref(specNumber)})`, `${ITEM_NATURES[item.nature].label} — ${escapeMarkdown(item.text)}`);
  for (const item of otherOpen.filter((entry) => entry.nature === "development")) {
    addNext(`Cases V1 ouvertes de ${ref(specNumber)} (développement ou vérification)`, `${escapeMarkdown(item.section)} — ${escapeMarkdown(item.text)}`);
  }

  return {
    sections,
    v1Sections,
    postV1Sections,
    gate,
    gateOpen,
    otherOpenHuman: otherOpen.filter((item) => ITEM_NATURES[item.nature].human),
    issues,
    pulls,
    orchestrated,
    human,
    next,
  };
}

function checksCell(summary) {
  if (!summary) return "non collectés";
  if (summary.total === 0) return "aucun";
  const parts = [];
  if (summary.counts.success) parts.push(`✅ ${summary.counts.success}`);
  if (summary.counts.failure) parts.push(`❌ ${summary.counts.failure}`);
  if (summary.counts.pending) parts.push(`⏳ ${summary.counts.pending}`);
  if (summary.counts.cancelled) parts.push(`⏹️ ${summary.counts.cancelled}`);
  const ignored = summary.counts.neutral + summary.counts.skipped;
  if (ignored) parts.push(`➖ ${ignored}`);
  let cell = parts.join(" ");
  if (summary.failing.length > 0) cell += ` — échec : ${summary.failing.map(escapeMarkdown).join(", ")}`;
  return cell;
}

function mergeableCell(pull) {
  if (!pull.detailsCollected) return "—";
  const value = pull.mergeable === true ? "oui" : pull.mergeable === false ? "non" : "inconnu";
  return pull.mergeableState ? `${value} (\`${escapeMarkdown(pull.mergeableState)}\`)` : value;
}

function labelsCell(labels) {
  return labels.length > 0 ? [...labels].sort(compareText).map(escapeMarkdown).join(", ") : "—";
}

function pullTable(pulls, withOrchestration) {
  const headers = ["PR", "Titre", "Auteur", "Statut", "Mergeable", "Checks", "Labels"];
  if (withOrchestration) headers.push("Orchestration");
  return table(headers, pulls.map((pull) => {
    const row = [
      ref(pull.number),
      escapeMarkdown(pull.title),
      escapeMarkdown(pull.author ?? "—"),
      PULL_STATUSES[pull.status],
      mergeableCell(pull),
      pull.detailsCollected ? checksCell(pull.checks) : "—",
      labelsCell(pull.labels),
    ];
    if (withOrchestration) row.push(orchestrationTags(pull.orchestration).map(escapeMarkdown).join(", ") || "—");
    return row;
  }));
}

const OUTCOME_LABELS = {
  success: "✅ succès",
  failure: "❌ échec",
  pending: "⏳ en cours",
  cancelled: "⏹️ annulé",
  neutral: "➖ neutre",
  skipped: "➖ ignoré",
};

export function renderStatusReport(snapshot) {
  const model = buildStatusModel(snapshot);
  const specRef = ref(snapshot.spec.number);
  const serverUrl = (snapshot.serverUrl ?? "https://github.com").replace(/\/+$/, "");
  const commitUrl = `${serverUrl}/${snapshot.repository}/commit/${snapshot.branch.sha}`;
  const branchName = escapeMarkdown(snapshot.branch.name);
  const lines = [];
  const push = (...values) => lines.push(...values);

  push(
    STATUS_MARKER,
    `# ${STATUS_ISSUE_TITLE}`,
    "",
    "> [!NOTE]",
    "> Rapport régénéré automatiquement par `scripts/retiko-status.mjs` (workflow `retiko-status`). Ce body est **remplacé** à chaque génération : toute modification manuelle sera perdue.",
    `> Vue en lecture seule. Sources de vérité : ${specRef} (fonctionnel), issues (backlog), PR et checks (développement). Le reporter ne coche, ne ferme et ne merge rien.`,
    "",
    ...table(["Repère", "Valeur"], [
      ["Généré le", formatUtc(snapshot.generatedAt)],
      ["Dépôt", escapeMarkdown(snapshot.repository)],
      [`SHA \`${branchName}\``, `[\`${snapshot.branch.sha}\`](${commitUrl})`],
      ["Dernier commit", `${escapeMarkdown(snapshot.branch.message)} (${formatUtc(snapshot.branch.committedAt)})`],
      [`Checks \`${branchName}\``, checksCell(snapshot.branch.checks)],
      ["Référence fonctionnelle", `${specRef} — ${escapeMarkdown(snapshot.spec.title)}`],
      ...(snapshot.runUrl ? [["Exécution", `[workflow retiko-status](${snapshot.runUrl})`]] : []),
    ]),
    "",
  );

  // 1. Validations pilote
  const v1Checked = model.v1Sections.reduce((sum, section) => sum + section.checked, 0);
  const v1Total = model.v1Sections.reduce((sum, section) => sum + section.total, 0);
  push(`## 1. Validations pilote — ${specRef}`, "", `**Périmètre V1 : ${v1Checked} / ${v1Total} cases cochées dans ${specRef}.**`);
  for (const section of model.postV1Sections) {
    push(`« ${escapeMarkdown(section.title)} » est hors périmètre V1 (${section.checked} / ${section.total}) et n'est pas comptée.`);
  }
  push("");
  if (model.gate) {
    push(
      `### ${escapeMarkdown(model.gate.title)} — ${model.gate.checked} / ${model.gate.total}`,
      "",
      `> Une case physique n'est cochée qu'à la main dans ${specRef}, après exécution du protocole terrain : un test automatisé vert ne la valide jamais. Une case ouverte n'est pas un bug.`,
      "",
      ...table(["", "Case", "Nature"], model.gate.items.map((item) => [
        item.checked ? "✅" : "⬜",
        escapeMarkdown(item.text),
        item.checked ? "" : ITEM_NATURES[item.nature].label,
      ])),
      "",
    );
  } else {
    push(`> [!WARNING]`, `> Section « Gate pilote réel » introuvable dans ${specRef}.`, "");
  }
  push(
    "<details>",
    `<summary>Avancement par section de ${specRef}</summary>`,
    "",
    ...table(["Section", "Cochées", "Ouvertes"], model.sections.map((section) => [
      section.scope === "post-v1" ? `${escapeMarkdown(section.title)} _(hors V1)_` : escapeMarkdown(section.title),
      `${section.checked} / ${section.total}`,
      String(section.total - section.checked),
    ])),
    "",
    "</details>",
    "",
  );

  // 2. Intervention humaine
  push("## 2. Intervention humaine requise", "", "### Signaux GitHub", "");
  if (model.human.length > 0) push(...model.human.map((entry) => `- ${entry}`));
  else push("_Aucun signal GitHub ne demande d'intervention humaine._");
  push("");
  const humanGate = model.gateOpen.filter((item) => ITEM_NATURES[item.nature].human);
  const renderByNature = (items, withSection) => {
    for (const nature of Object.keys(ITEM_NATURES)) {
      const group = items.filter((item) => item.nature === nature);
      if (group.length === 0) continue;
      push(`- **${ITEM_NATURES[nature].label}**`);
      for (const item of group) push(`  - ${withSection ? `${escapeMarkdown(item.section)} — ` : ""}${escapeMarkdown(item.text)}`);
    }
  };
  if (model.gate) {
    push(`### Cases ouvertes hors code — ${escapeMarkdown(model.gate.title)}`, "");
    if (humanGate.length > 0) renderByNature(humanGate, false);
    else push("_Aucune._");
    push("");
  }
  push(`### Cases ouvertes hors code — autres sections V1 de ${specRef}`, "");
  if (model.otherOpenHuman.length > 0) renderByNature(model.otherOpenHuman, true);
  else push("_Aucune._");
  push("");

  // 3. Prochaines actions
  push(
    "## 3. Prochaines actions identifiables",
    "",
    `> Dérivées mécaniquement de l'état GitHub et groupées par catégorie. L'ordre n'est **pas** une priorité produit : elle reste fixée dans ${specRef} et par décision humaine.`,
    "",
  );
  if (model.next.length === 0) push("_Aucune action dérivable de l'état GitHub._", "");
  for (const group of model.next) push(`**${group.group}**`, "", ...group.items.map((item) => `- ${item}`), "");

  // 4. PR ouvertes
  const withOrchestration = model.orchestrated.length > 0;
  const productPulls = model.pulls.filter((pull) => !pull.dependency);
  const dependencyPulls = model.pulls.filter((pull) => pull.dependency);
  push(`## 4. Pull requests ouvertes (${model.pulls.length})`, "");
  const refsWith = (predicate) => model.pulls.filter(predicate).map((pull) => ref(pull.number)).join(", ") || "aucune";
  push(
    `- Mergeables selon GitHub (hors brouillons) : ${refsWith((pull) => pull.status === "mergeable" || pull.status === "mergeable-no-checks")}`,
    `- En conflit : ${refsWith((pull) => pull.status === "conflict")}`,
    `- Mergeabilité non encore calculée par GitHub : ${refsWith((pull) => pull.status === "mergeability-unknown")}`,
  );
  const notAnalyzed = model.pulls.filter((pull) => !pull.detailsCollected);
  if (notAnalyzed.length > 0) push(`- Non analysées (au-delà des ${snapshot.prDetailLimit} PR les plus récentes) : ${notAnalyzed.map((pull) => ref(pull.number)).join(", ")}`);
  push("");
  if (productPulls.length > 0) push(...pullTable(productPulls, withOrchestration), "");
  else push("_Aucune PR ouverte hors dépendances._", "");
  if (dependencyPulls.length > 0) {
    push(`### Mises à jour de dépendances (${dependencyPulls.length})`, "", ...pullTable(dependencyPulls, withOrchestration), "");
  }

  // 5. Issues ouvertes
  push(`## 5. Issues ouvertes (${model.issues.length})`, "", `Hors ${specRef} et hors issue d'état. « ${specRef} » = numéro cité dans le body de ${specRef}.`, "");
  if (model.issues.length > 0) {
    const headers = ["Issue", "Titre", "Labels", specRef];
    if (withOrchestration) headers.push("Orchestration");
    push(...table(headers, model.issues.map((issue) => {
      const row = [
        issue.incident ? `🚨 ${ref(issue.number)}` : ref(issue.number),
        escapeMarkdown(issue.title),
        labelsCell(issue.labels),
        issue.citedBySpec ? "cité" : "",
      ];
      if (withOrchestration) row.push(orchestrationTags(issue.orchestration).map(escapeMarkdown).join(", ") || "—");
      return row;
    })), "");
  } else {
    push("_Aucune issue ouverte._", "");
  }

  // 6. Classification
  push("## 6. Classification par labels d'orchestration", "");
  if (!withOrchestration) {
    push("_Aucun label d'orchestration (`phase:`, `agent:`, `auto:`, `risk:`, `state:`, `needs-human`) n'est posé sur une issue ou PR ouverte. Le rapport fonctionne sans eux ; cette section se remplira dès qu'ils seront utilisés._", "");
  } else {
    const states = [...new Set([...ORCHESTRATION_FAMILIES.state, ...model.orchestrated.flatMap((item) => item.orchestration.state)])];
    const rows = states.map((state) => {
      const items = model.orchestrated.filter((item) => item.orchestration.state.includes(state));
      return [`\`state:${escapeMarkdown(state)}\``, String(items.length), items.map((item) => ref(item.number)).join(", ") || "—"];
    });
    const stateless = model.orchestrated.filter((item) => item.orchestration.state.length === 0);
    rows.push(["_sans `state:`_", String(stateless.length), stateless.map((item) => ref(item.number)).join(", ") || "—"]);
    push(...table(["État", "Nombre", "Éléments"], rows), "");
    const tally = new Map();
    for (const item of model.orchestrated) {
      for (const tag of orchestrationTags(item.orchestration).filter((value) => !value.startsWith("state:"))) tally.set(tag, (tally.get(tag) ?? 0) + 1);
    }
    const tags = [...tally.entries()].sort((a, b) => compareText(a[0], b[0]));
    if (tags.length > 0) push(`Répartition : ${tags.map(([tag, count]) => `\`${escapeMarkdown(tag)}\` ${count}`).join(" · ")}`, "");
    const multiState = model.orchestrated.filter((item) => item.orchestration.state.length > 1);
    if (multiState.length > 0) push(`⚠️ Plusieurs \`state:\` sur : ${multiState.map((item) => ref(item.number)).join(", ")}`, "");
  }

  // 7. PR récemment mergées
  push(`## 7. PR récemment mergées (${snapshot.recentlyMerged.length})`, "");
  if (snapshot.recentlyMerged.length > 0) {
    push(...table(["PR", "Titre", "Mergée le", "Commit"], snapshot.recentlyMerged.map((pull) => [
      ref(pull.number),
      escapeMarkdown(pull.title),
      formatUtc(pull.mergedAt),
      pull.mergeCommitSha ? `\`${pull.mergeCommitSha.slice(0, 7)}\`` : "—",
    ])), "");
  } else {
    push("_Aucune PR mergée trouvée._", "");
  }

  // 8. Checks connus
  push(`## 8. Checks connus sur \`${branchName}\``, "", `Dernier résultat par check sur [\`${snapshot.branch.sha.slice(0, 7)}\`](${commitUrl}) pour la branche \`${branchName}\` (surveillance planifiée comprise), job \`${STATUS_CHECK_NAME}\` exclu. Les checks des PR sont résumés dans la section 4.`, "");
  const entries = snapshot.branch.checks?.entries ?? [];
  if (entries.length > 0) {
    push(...table(["Check", "Source", "Résultat"], entries.map((entry) => [
      escapeMarkdown(entry.name),
      entry.source === "status" ? "statut de commit" : "check run",
      OUTCOME_LABELS[entry.outcome],
    ])), "");
  } else {
    push("_Aucun check connu sur ce commit._", "");
  }

  push(
    "---",
    "",
    "<sub>Limites : nature des cases déduite par mots-clés (indicative) ; mergeabilité calculée par GitHub de façon asynchrone ; "
      + `détails limités aux ${snapshot.prDetailLimit} PR ouvertes les plus récentes ; seules les cases cochées à la main dans ${specRef} font foi.</sub>`,
  );

  return fitBody(`${lines.join("\n")}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage :
  node scripts/retiko-status.mjs [--dry-run] [--output <rapport.md>]
    [--repo <owner/nom>] [--spec-issue <n>] [--branch <nom>]

Génère l'état courant Retiko depuis GitHub (#88, issues, PR, checks) et remplace
le body de l'issue « ${STATUS_ISSUE_TITLE} » (créée au premier lancement).

Environnement :
  GITHUB_TOKEN        requis hors --dry-run
  GITHUB_REPOSITORY   owner/nom, si --repo est absent
  GITHUB_API_URL      défaut https://api.github.com

Codes de sortie :
  0  rapport généré (et publié hors --dry-run)
  1  GitHub indisponible ou réponse inattendue : rien n'est publié
  2  arguments ou configuration invalides`;

export async function main(argv, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sleep = defaultSleep,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const fail = (message) => {
    stderr.write(`${env.GITHUB_ACTIONS === "true" ? "::error::" : ""}retiko-status : ${message}\n`);
  };

  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        "dry-run": { type: "boolean" },
        output: { type: "string" },
        repo: { type: "string" },
        "spec-issue": { type: "string" },
        branch: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    fail(`${errorText(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const dryRun = Boolean(options["dry-run"]);
  const repository = options.repo ?? env.GITHUB_REPOSITORY;
  const specIssue = Number(options["spec-issue"] ?? DEFAULT_SPEC_ISSUE);
  const branch = options.branch ?? DEFAULT_BRANCH;
  const token = env.GITHUB_TOKEN || null;
  if (!Number.isSafeInteger(specIssue) || specIssue < 1) {
    fail(`--spec-issue invalide : ${options["spec-issue"]}`);
    return 2;
  }
  if (!token && !dryRun) {
    fail("GITHUB_TOKEN requis pour publier (utiliser --dry-run pour un aperçu).");
    return 2;
  }

  let client;
  try {
    client = createGitHubClient({ repository, token, apiUrl: env.GITHUB_API_URL || undefined, fetchImpl, sleep });
  } catch (error) {
    fail(errorText(error));
    return 2;
  }

  let body;
  let published = null;
  try {
    const snapshot = await collectSnapshot(client, { specIssue, branch, sleep });
    const lookup = await findStatusIssue(client, snapshot.openIssues, { specIssue });
    const serverUrl = env.GITHUB_SERVER_URL || "https://github.com";
    body = renderStatusReport({
      ...snapshot,
      ...lookup,
      serverUrl,
      generatedAt: now(),
      runUrl: env.GITHUB_RUN_ID ? `${serverUrl.replace(/\/+$/, "")}/${client.repository}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    });
    if (!dryRun) published = await publishStatusReport(client, { body, statusIssue: lookup.statusIssue, specIssue });
  } catch (error) {
    fail(`${errorText(error)} — aucun rapport publié.`);
    return 1;
  }

  if (options.output) {
    try {
      writeFileSync(options.output, body, "utf8");
    } catch (error) {
      fail(`écriture impossible de ${options.output} (${errorText(error)}).`);
      return 2;
    }
  }
  if (dryRun) {
    stdout.write(body);
    return 0;
  }

  const verb = { created: "créée", updated: "mise à jour", reopened: "rouverte et mise à jour" }[published.action];
  stdout.write(`Issue d'état #${published.number} ${verb}${published.url ? ` : ${published.url}` : ""}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### ${STATUS_ISSUE_TITLE}\n\nIssue #${published.number} ${verb}${published.url ? ` : ${published.url}` : ""}\n`);
    } catch {
      // Le résumé du job est un confort : son échec ne doit pas masquer la publication réussie.
    }
  }
  return 0;
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

// exitCode plutôt que process.exit() : sur macOS, stdout redirigé est
// asynchrone et une sortie brutale tronquerait le rapport.
if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
