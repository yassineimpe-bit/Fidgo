/* eslint-disable @typescript-eslint/no-explicit-any -- compact mocked GitHub REST payloads */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { claimNext, createApi, forbiddenDispatcherPath, verifyMainProtection, isEligible, labelsAfterTransition, matchingPullRequest, reconcileIssue, selectIssue } from "../scripts/retiko-dispatcher.mjs";

const issue = (number: number, labels: string[], extra = {}) => ({ number, state: "open", created_at: `2026-01-${String(number).padStart(2, "0")}T00:00:00Z`, labels: labels.map(name => ({ name })), ...extra });
const ready = (number = 1, risk = "risk:low") => issue(number, ["agent:claude", "auto:yes", "state:ready", risk, "business"]);
function api(issues: any[], pulls: any[] = []) {
  return { listIssues: vi.fn(async () => issues), getIssue: vi.fn(async (n) => issues.find(i => i.number === n)), listPulls: vi.fn(async () => pulls), listPullFiles: vi.fn(async () => [{ filename: "lib/loyalty.ts" }]), addLabel: vi.fn(), removeLabel: vi.fn(), comment: vi.fn() };
}

describe("dispatcher Retiko", () => {
  it("sélectionne une issue ready", () => expect(selectIssue([ready()])?.number).toBe(1));
  it.each([
    ["needs-human", ready(1), "needs-human"], ["risk high", ready(1), "risk:high"],
    ["sans auto", issue(1, ["agent:claude", "state:ready", "risk:low"]), null],
    ["autre agent", issue(1, ["agent:codex", "auto:yes", "state:ready", "risk:low"]), null],
  ])("exclut %s", (_name, candidate, replacement) => {
    if (replacement) candidate.labels = candidate.labels.filter((x: any) => !x.name.startsWith("risk:")).concat({ name: replacement });
    expect(isEligible(candidate)).toBe(false);
  });
  it("exclut les PR retournées par l'API issues", () => expect(selectIssue([{ ...ready(1), pull_request: {} }, ready(2)])?.number).toBe(2));
  it("ordonne low avant medium puis ancienneté et numéro", () => expect(selectIssue([ready(1, "risk:medium"), ready(3), ready(2)])?.number).toBe(2));
  it("conserve les labels métier pendant une transition", () => expect(labelsAfterTransition(ready(), "state:ready", "state:running")).toContain("business"));
  it("claim ready vers running après relecture", async () => { const a = api([ready()]); expect((await claimNext(a)).status).toBe("claimed"); expect(a.addLabel).toHaveBeenCalledWith(1, "state:running"); expect(a.removeLabel).toHaveBeenCalledWith(1, "state:ready"); });
  it("passe running vers review avec le marker PR exact", async () => { const running = issue(7, ["agent:claude", "auto:yes", "state:running"]); const a = api([running], [{ number: 1, state: "open", body: "<!-- retiko-dispatch:issue=7 -->", base: { ref: "main", repo: { full_name: "owner/repo" } }, head: { ref: "retiko/issue-7-claude", repo: { full_name: "owner/repo" } } }]); expect((await reconcileIssue(a, running)).status).toBe("review"); expect(a.addLabel).toHaveBeenCalledWith(7, "state:review"); });
  it("passe un échec vers blocked avec un message sans secret", async () => { const running = issue(7, ["state:running"]); const a = api([running]); await reconcileIssue(a, running, { failed: true, reason: "credential Claude absent" }); expect(a.comment.mock.calls[0][1]).toBe("<!-- retiko-dispatch:blocked -->\nDispatcher Retiko : credential Claude absent"); });
  it("ne claim pas une seconde issue lorsque le worker est occupé", async () => { const a = api([issue(9, ["state:running"]), ready()]); expect((await claimNext(a)).status).toBe("busy"); expect(a.getIssue).not.toHaveBeenCalled(); });
  it("évite un double claim si la relecture est devenue inéligible", async () => { const a = api([ready()]); a.getIssue.mockResolvedValue(issue(1, ["state:running"])); expect((await claimNext(a)).status).toBe("stale"); expect(a.addLabel).not.toHaveBeenCalled(); });
  it("est idempotent hors de state:running", async () => { const review = issue(1, ["state:review"]); const a = api([review]); expect((await reconcileIssue(a, review)).status).toBe("unchanged"); expect(a.addLabel).not.toHaveBeenCalled(); });
  it("ne confond pas les markers de deux issues", () => expect(matchingPullRequest([{ state: "open", body: "<!-- retiko-dispatch:issue=70 -->" }], 7)).toBeNull());
  it("ne dépend ni du reporter ni d'un credential Claude", async () => { const a = api([]); expect((await claimNext(a)).status).toBe("idle"); expect(JSON.stringify(a)).not.toContain("CLAUDE_CODE_OAUTH_TOKEN"); });
  it("n'accepte aucun événement PR et checkout uniquement main", () => {
    const workflow = readFileSync(".github/workflows/retiko-dispatcher.yml", "utf8");
    expect(workflow).not.toMatch(/^\s*pull_request(?:_target)?:/m);
    expect(workflow).toMatch(/^\s{10}ref: main$/m);
    expect(workflow).toMatch(/^\s{2}issues:\n\s{4}types: \[labeled\]$/m);
  });
});


describe("dispatcher trust boundary", () => {
  it.each([".github/workflows/ci.yml", ".env", "lib/.env.local", "secrets/token.json", "backups/database.sql", "db.dump", "cert.p12", "key.pem", "backup.sql.gz", "x/../.env", ".GITHUB/workflows/ci.yml"])("refuse %s", path => expect(forbiddenDispatcherPath(path)).toBe(true));
  it.each(["lib/billing.ts", "tests/auth.test.ts", "docs/BACKUPS.md", "db/migrations/034_schema.sql"])("autorise %s", path => expect(forbiddenDispatcherPath(path)).toBe(false));
  const pull = { number: 1, state: "open", body: "<!-- retiko-dispatch:issue=7 -->", base: { ref: "main", repo: { full_name: "owner/repo" } }, head: { ref: "retiko/issue-7-claude", repo: { full_name: "owner/repo" } } };
  it.each([{filename: ".github/workflows/ci.yml"}, {filename: "lib/ok.ts", previous_filename: ".env.local"}])("bloque la PR avec un chemin sensible, y compris renommé", async file => {
    const a = api([issue(7, ["state:running"])], [pull]); a.listPullFiles.mockResolvedValue([file]);
    expect((await reconcileIssue(a, issue(7, ["state:running"]))).status).toBe("blocked");
    expect(a.addLabel).not.toHaveBeenCalledWith(7,"state:review");
  });
  it("refuse un marker copié dans une branche étrangère", async () => {
    const a=api([], [{...pull,head:{...pull.head,ref:"untrusted"}}]);
    expect((await reconcileIssue(a,issue(7,["state:running"]))).status).toBe("blocked");
  });
  it("lit toutes les pages de fichiers avant validation", async () => {
    const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({length:100},()=>({filename:"lib/ok.ts"}))))).mockResolvedValueOnce(new Response(JSON.stringify([{filename:".env"}])));
    const a=createApi({token:"synthetic",repository:"owner/repo",fetchImpl});
    expect(await a.listPullFiles(1)).toHaveLength(101); expect(fetchImpl.mock.calls[1][0]).toContain("page=2");
  });
  const ci={id:1,name:"retiko-main-ci",enforcement:"active",conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},bypass_actors:[],rules:[{type:"deletion"},{type:"non_fast_forward"},{type:"pull_request",parameters:{required_review_thread_resolution:true}},{type:"required_status_checks",parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:"quality",integration_id:15368},{context:"e2e",integration_id:15368}]}}]};
  const writers={id:2,name:"retiko-main-writers",enforcement:"active",conditions:ci.conditions,bypass_actors:[{actor_type:"RepositoryRole",actor_id:5,bypass_mode:"pull_request"}],rules:[{type:"update"}]};
  function protectionApi(c:any=ci,w:any=writers){return{listRulesets:async()=>[c,w],getRuleset:async(id:number)=>id===1?c:w}}
  it("valide main protégée sans bypass pour le token GitHub Actions",async()=>expect(await verifyMainProtection(protectionApi())).toBe(true));
  it("refuse un bypass GitHub App",async()=>{await expect(verifyMainProtection(protectionApi(ci,{...writers,bypass_actors:[...writers.bypass_actors,{actor_type:"Integration",actor_id:15368,bypass_mode:"always"}]}))).rejects.toThrow("MAIN_PROTECTION_REQUIRED")});
  it("refuse un contournement CI même par admin",async()=>{await expect(verifyMainProtection(protectionApi({...ci,bypass_actors: writers.bypass_actors}))).rejects.toThrow("MAIN_PROTECTION_REQUIRED")});
  it("refuse des checks absents ou une branche non à jour",async()=>{await expect(verifyMainProtection(protectionApi({...ci,rules:ci.rules.filter(r=>r.type!=="required_status_checks")}))).rejects.toThrow("MAIN_PROTECTION_REQUIRED")});
  it("isole les permissions et le secret dans les trois jobs",()=>{
    const w=readFileSync(".github/workflows/retiko-dispatcher.yml","utf8");
    const claim=w.split("  claim:\n")[1].split("  claude:\n")[0],claude=w.split("  claude:\n")[1].split("  reconcile:\n")[0],reconcile=w.split("  reconcile:\n")[1];
    expect(w).toContain("permissions: {}"); expect((w.match(/contents: write/g)||[])).toHaveLength(1);
    for(const job of [claim,reconcile]){expect(job).toContain("contents: read"); expect(job).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");}
    expect(claude).toContain("issues: read"); expect(claude).toContain("verify-protection"); expect(claude).toMatch(/anthropics\/claude-code-action@[a-f0-9]{40} # v/);
    expect(reconcile).toContain("pull-requests: read"); expect(reconcile).toContain("ref: main"); expect(reconcile).toContain("always()");
  });
});
