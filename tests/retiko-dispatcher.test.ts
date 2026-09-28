/* eslint-disable @typescript-eslint/no-explicit-any -- compact mocked GitHub REST payloads */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { claimNext, isEligible, labelsAfterTransition, matchingPullRequest, reconcileIssue, selectIssue } from "../scripts/retiko-dispatcher.mjs";

const issue = (number: number, labels: string[], extra = {}) => ({ number, state: "open", created_at: `2026-01-${String(number).padStart(2, "0")}T00:00:00Z`, labels: labels.map(name => ({ name })), ...extra });
const ready = (number = 1, risk = "risk:low") => issue(number, ["agent:claude", "auto:yes", "state:ready", risk, "business"]);
function api(issues: any[], pulls: any[] = []) {
  return { listIssues: vi.fn(async () => issues), getIssue: vi.fn(async (n) => issues.find(i => i.number === n)), listPulls: vi.fn(async () => pulls), addLabel: vi.fn(), removeLabel: vi.fn(), comment: vi.fn() };
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
  it("passe running vers review avec le marker PR exact", async () => { const running = issue(7, ["agent:claude", "auto:yes", "state:running"]); const a = api([running], [{ state: "open", body: "<!-- retiko-dispatch:issue=7 -->" }]); expect((await reconcileIssue(a, running)).status).toBe("review"); expect(a.addLabel).toHaveBeenCalledWith(7, "state:review"); });
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
