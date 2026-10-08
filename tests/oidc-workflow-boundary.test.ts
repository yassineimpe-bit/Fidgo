import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");

describe("OIDC workflow credential and destruction boundaries", () => {
  it("keeps lifecycle manual and scheduled runs dry by default", () => {
    const workflow = load(readFileSync(".github/workflows/data-lifecycle.yml", "utf8"));
    expect(workflow.on.workflow_dispatch.inputs.execute.default).toBe(false);
    const apply = workflow.jobs.purge.steps.find((step: { name?: string }) => step.name === "Apply retention");
    expect(apply.if.trim()).toBe("(github.event_name == 'schedule' && vars.DATA_LIFECYCLE_EXECUTE == 'true') || (github.event_name == 'workflow_dispatch' && inputs.execute == true)");
    expect(apply.run).toBe("npm run data:purge -- --execute");
    expect(workflow.jobs.purge.steps.find((step: { name?: string }) => step.name === "Dry-run retention report").run).toBe("npm run data:purge");
  });
  it.each([
    ["data-lifecycle", "purge", "retiko-lifecycle"],
    ["database-backup", "backup-restore", "retiko-backup"],
  ])("limits %s OIDC permissions and masks exchanged credentials", (file, job, audience) => {
    const text = readFileSync(`.github/workflows/${file}.yml`, "utf8");
    const workflow = load(text);
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const [name, value] of Object.entries(workflow.jobs)) {
      const candidate = value as { permissions?: Record<string, string> };
      expect(candidate.permissions?.["id-token"]).toBe(name === job ? "write" : undefined);
    }
    const steps = workflow.jobs[job].steps;
    const identity = steps.find((step: { id?: string }) => step.id === "oidc").with.script;
    expect(identity).toContain(`core.getIDToken("${audience}")`);
    expect(identity.indexOf("core.setSecret(token)")).toBeLessThan(identity.indexOf('core.setOutput("token", token)'));
    const exchange = steps.find((step: { name?: string }) => step.name?.startsWith("Exchange OIDC identity")).run;
    expect(exchange).toContain('echo "::add-mask::$database_url"');
    expect(exchange.indexOf("::add-mask::")).toBeLessThan(exchange.indexOf("$GITHUB_ENV"));
    expect(exchange).not.toContain("GITHUB_OUTPUT");
    expect(exchange).toContain("trap 'rm -f");
    for (const step of steps.filter((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact"))) {
      expect(step.with.path).not.toMatch(/response_file|GITHUB_ENV|\.env|\.dump(?:\s|$)/);
    }
  });
});
