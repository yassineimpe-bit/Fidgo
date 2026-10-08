import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LABELS = Object.freeze({
  "agent:claude": "5319e7", "auto:yes": "0e8a16", "state:ready": "1d76db",
  "state:running": "fbca04", "state:review": "a2eeef", "state:blocked": "d93f0b",
  "risk:low": "0e8a16", "risk:medium": "fbca04", "risk:high": "b60205",
  "needs-human": "d93f0b",
});
export const PR_MARKER_PREFIX = "<!-- retiko-dispatch:issue=";
const REQUIRED = ["agent:claude", "auto:yes", "state:ready"];
const RISK_ORDER = new Map([["risk:low", 0], ["risk:medium", 1]]);

export function names(issue) {
  return (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name).filter(Boolean);
}

export function isEligible(issue) {
  const labels = new Set(names(issue));
  return issue.state === "open" && !issue.pull_request && REQUIRED.every((label) => labels.has(label)) &&
    !labels.has("needs-human") && !labels.has("risk:high") &&
    (labels.has("risk:low") || labels.has("risk:medium"));
}

export function selectIssue(issues) {
  return [...issues].filter(isEligible).sort((a, b) => {
    const riskA = names(a).includes("risk:low") ? "risk:low" : "risk:medium";
    const riskB = names(b).includes("risk:low") ? "risk:low" : "risk:medium";
    return RISK_ORDER.get(riskA) - RISK_ORDER.get(riskB) ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.number - b.number;
  })[0] ?? null;
}

export function labelsAfterTransition(issue, from, to) {
  const current = names(issue);
  return [...new Set([...current.filter((label) => label !== from), to])];
}

export function prMarker(number) { return `${PR_MARKER_PREFIX}${number} -->`; }
export function matchingPullRequest(pulls, number) {
  const marker = prMarker(number);
  return pulls.find((pull) => pull.state === "open" && String(pull.body ?? "").includes(marker)) ?? null;
}

export async function transition(api, issue, from, to) {
  const current = new Set(names(issue));
  if (!current.has(from)) return false;
  if (!current.has(to)) await api.addLabel(issue.number, to);
  await api.removeLabel(issue.number, from);
  return true;
}

export async function claimNext(api) {
  const all = await api.listIssues();
  if (all.some((issue) => !issue.pull_request && issue.state === "open" && names(issue).includes("state:running"))) {
    return { status: "busy" };
  }
  const candidate = selectIssue(all);
  if (!candidate) return { status: "idle" };
  const fresh = await api.getIssue(candidate.number);
  if (!isEligible(fresh)) return { status: "stale" };
  await transition(api, fresh, "state:ready", "state:running");
  return { status: "claimed", issue: fresh };
}

export function forbiddenDispatcherPath(path) {
  const value = String(path ?? "").replaceAll("\\", "/").toLowerCase();
  return !value || value.split("/").includes("..") ||
    /(^|\/)(?:\.github|secrets?|backups?)(?:\/|$)/.test(value) ||
    /(^|\/)\.env(?:[./]|$)/.test(value) ||
    /\.(?:pem|key|p12|pfx|dump|backup)(?:\.|$)/.test(value) ||
    /\.(?:sql|tar)(?:\.gz|\.zip)$/.test(value);
}

export async function verifyMainProtection(api) {
  const rulesets = await api.listRulesets();
  const active = await Promise.all(rulesets.filter(r => r.enforcement === "active").map(r => api.getRuleset(r.id)));
  const ci = active.find(r => r.name === "retiko-main-ci");
  const writers = active.find(r => r.name === "retiko-main-writers");
  const targetsMainOnly = r => r?.conditions?.ref_name?.include?.length === 1 &&
    r.conditions.ref_name.include[0] === "refs/heads/main" && !r.conditions.ref_name.exclude?.length;
  const rules = ci?.rules ?? [];
  const pr = rules.find(r => r.type === "pull_request")?.parameters;
  const checks = rules.find(r => r.type === "required_status_checks")?.parameters;
  const bypass = writers?.bypass_actors ?? [];
  if (!targetsMainOnly(ci) || !targetsMainOnly(writers) || ci.bypass_actors?.length ||
      !rules.some(r => r.type === "deletion") || !rules.some(r => r.type === "non_fast_forward") ||
      !pr?.required_review_thread_resolution || !checks?.strict_required_status_checks_policy ||
      !["quality", "e2e"].every(context => checks.required_status_checks?.some(c => c.context === context && c.integration_id === 15368)) ||
      !writers.rules?.some(r => r.type === "update") || bypass.length !== 1 ||
      bypass[0].actor_type !== "RepositoryRole" || bypass[0].actor_id !== 5 || bypass[0].bypass_mode !== "pull_request") {
    throw new Error("MAIN_PROTECTION_REQUIRED: agent execution refused");
  }
  return true;
}

export async function reconcileIssue(api, issue, { failed = false, reason = "Claude n’a produit aucune PR correspondante." } = {}) {
  if (!names(issue).includes("state:running")) return { status: "unchanged" };
  const pull = matchingPullRequest(await api.listPulls(), issue.number);
  if (pull) {
    const files = await api.listPullFiles(pull.number);
    const safeSource = pull.base?.ref === "main" && pull.head?.ref === `retiko/issue-${issue.number}-claude` &&
      pull.head?.repo?.full_name === pull.base?.repo?.full_name && !pull.draft;
    if (!safeSource || !files.length || files.some(file => forbiddenDispatcherPath(file.filename) ||
        (file.previous_filename && forbiddenDispatcherPath(file.previous_filename)))) {
      await transition(api, issue, "state:running", "state:blocked");
      await api.comment(issue.number, "<!-- retiko-dispatch:blocked -->\nDispatcher Retiko : provenance PR invalide ou chemin sensible/interdit ; revue humaine requise.");
      return { status: "blocked" };
    }
    await transition(api, issue, "state:running", "state:review");
    return { status: "review", pull };
  }
  if (failed) {
    await transition(api, issue, "state:running", "state:blocked");
    await api.comment(issue.number, `<!-- retiko-dispatch:blocked -->\nDispatcher Retiko : ${reason}`);
    return { status: "blocked" };
  }
  return { status: "running" };
}

export function createApi({ token, repository, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: {
      accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
      "content-type": "application/json", "x-github-api-version": "2022-11-28", ...options.headers,
    }});
    if (!response.ok) throw new Error(`GitHub API ${response.status} (${options.method ?? "GET"} ${path})`);
    return response.status === 204 ? null : response.json();
  }
  return {
    async listRulesets() { return request("/rulesets?per_page=100"); },
    async getRuleset(id) { return request(`/rulesets/${id}`); },
    async listPullFiles(number) {
      const files = [];
      for (let page = 1; page <= 30; page++) {
        const batch = await request(`/pulls/${number}/files?per_page=100&page=${page}`);
        files.push(...batch);
        if (batch.length < 100) return files;
      }
      throw new Error("PR_FILE_LIMIT: review refused");
    },
    async listIssues() { return request("/issues?state=open&per_page=100&sort=created&direction=asc"); },
    async getIssue(number) { return request(`/issues/${number}`); },
    async listPulls() { return request("/pulls?state=open&per_page=100"); },
    async addLabel(number, label) { return request(`/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels: [label] }) }); },
    async removeLabel(number, label) { return request(`/issues/${number}/labels/${encodeURIComponent(label)}`, { method: "DELETE" }); },
    async comment(number, body) { return request(`/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) }); },
    async ensureLabel(name, color) {
      const response = await fetchImpl(`${base}/labels`, { method: "POST", headers: {
        accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
        "content-type": "application/json", "x-github-api-version": "2022-11-28",
      }, body: JSON.stringify({ name, color }) });
      if (!response.ok && response.status !== 422) throw new Error(`GitHub API ${response.status} (create label)`);
    },
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
  const api = createApi({ token, repository });
  const mode = process.argv[2] ?? "claim";
  if (mode === "verify-protection") {
    await verifyMainProtection(api);
    console.log("Main protections verified: no direct agent push or App bypass.");
    return;
  }
  if (mode === "bootstrap") {
    for (const [label, color] of Object.entries(LABELS)) await api.ensureLabel(label, color);
    return;
  }
  if (mode === "claim") {
    const result = await claimNext(api);
    const output = process.env.GITHUB_OUTPUT;
    if (output) {
      appendFileSync(output, `status=${result.status}\n`);
      if (result.issue) appendFileSync(output, `issue=${result.issue.number}\n`);
    }
    return;
  }
  const number = Number(process.env.RETIKO_ISSUE);
  const issue = await api.getIssue(number);
  const failed = process.env.RETIKO_FAILED === "true";
  const reason = process.env.RETIKO_REASON || undefined;
  await reconcileIssue(api, issue, { failed, reason });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
