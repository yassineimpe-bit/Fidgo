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
    expect(exchange).not.toContain("GITHUB_OUTPUT");
    expect(exchange).toContain("trap 'rm -f");
    if (file === "data-lifecycle") {
      expect(exchange.indexOf("::add-mask::")).toBeLessThan(exchange.indexOf("$GITHUB_ENV"));
    }
    for (const step of steps.filter((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact"))) {
      expect(step.with.path).not.toMatch(/response_file|GITHUB_ENV|\.env|\.dump(?:\s|$)/);
    }
  });

  describe("database-backup", () => {
    type Step = { id?: string; name?: string; run?: string; uses?: string; env?: Record<string, string> };
    const text = readFileSync(".github/workflows/database-backup.yml", "utf8");
    const workflow = load(text);
    const steps: Step[] = workflow.jobs["backup-restore"].steps;
    const exchangeIndex = steps.findIndex((step) => step.name?.startsWith("Exchange OIDC identity"));
    const exchange = steps[exchangeIndex].run!;

    it("confines the production credential to the single pg_dump step (#206)", () => {
      expect(text).not.toMatch(/>>\s*"?\$GITHUB_ENV/);
      expect(exchange).not.toContain("GITHUB_ENV");
      expect(exchange.indexOf("::add-mask::$database_url")).toBeLessThan(exchange.indexOf('DATABASE_URL="$database_url"'));
      expect(exchange.indexOf("pg_dump")).toBeLessThan(exchange.indexOf("unset database_url"));
      for (const step of steps.slice(exchangeIndex + 1)) {
        expect(JSON.stringify(step)).not.toMatch(/database_url|steps\.oidc/);
      }
      for (const name of ["Restore backup into isolated PostgreSQL 17", "Rehearse repository migrations on the restored copy"]) {
        expect(steps.find((step) => step.name === name)!.run).toContain('test -z "${SOURCE_DATABASE_URL:-}"');
      }
      expect(workflow.jobs["backup-restore"].env).not.toHaveProperty("SOURCE_DATABASE_URL");
    });

    it("runs pg_dump and pg_restore only from the digest-pinned image", () => {
      expect(workflow.env.PG_IMAGE).toMatch(/^postgres:17\.\d+@sha256:[0-9a-f]{64}$/);
      const dockerRuns = text.split("\n").filter((line) => /^\s*(SOURCE_DATABASE_URL="\$database_url"\s+)?docker run /.test(line));
      expect(dockerRuns.length).toBeGreaterThan(0);
      // Hors commentaires, seuls les services jetables (sans credential) gardent le tag mutable.
      for (const line of text.split("\n").filter((line) => !line.trim().startsWith("#") && /\bpostgres:17\b/.test(line))) {
        expect(line).toMatch(/image: postgres:17$|PG_IMAGE: postgres:17\.\d+@sha256:/);
      }
      const restoreScript = readFileSync("scripts/restore-backup.sh", "utf8");
      expect(restoreScript).toContain(workflow.env.PG_IMAGE);
    });

    it("keeps the migration rehearsal on the disposable runner database", () => {
      const migrate = steps.find((step) => step.id === "migrate")!;
      expect(migrate.env!.DATABASE_URL).toBe("${{ env.RESTORE_DATABASE_URL }}");
      expect(workflow.jobs["backup-restore"].env.RESTORE_DATABASE_URL).toMatch(/@127\.0\.0\.1:5432\//);
      expect(migrate.run).toContain("postgres://*@127.0.0.1:5432/*) ;;");
      expect(migrate.run!.indexOf("--compare-upgrade")).toBeGreaterThan(migrate.run!.indexOf("npm run db:setup"));
    });

    it("reports the production schema state read-only on the restored copy, before any migration", () => {
      const ids = steps.map((step) => step.id);
      const report = steps.find((step) => step.id === "schema_report")!;
      expect(ids.indexOf("schema_report")).toBeGreaterThan(ids.indexOf("restore"));
      expect(ids.indexOf("schema_report")).toBeLessThan(ids.indexOf("migrate"));
      expect(report.run).toContain('test -z "${SOURCE_DATABASE_URL:-}"');
      expect(report.run).toContain('psql "$RESTORE_DATABASE_URL"');
      expect(report.run).toContain("/sql/check-024-033.sql");
      const sql = readFileSync("ops/migrations/check-024-033.sql", "utf8");
      expect(sql).toMatch(/begin transaction read only;/);
      expect(sql.trim().endsWith("rollback;")).toBe(true);
      expect(sql).not.toMatch(/^\s*(insert|update|delete|alter|create|drop|truncate|grant)\b/im);
    });

    it("fails backup-restore on restore, fingerprint, migration or integrity, and reports production drift separately", () => {
      const fail = steps.find((step) => step.name === "Fail when the restore drill did not pass") as Step & { if: string };
      for (const id of ["restore", "fingerprint", "migrate", "verify_migrated"]) {
        expect(fail.if).toContain(`steps.${id}.outcome != 'success'`);
      }
      expect(workflow.jobs["backup-restore"].outputs.source_db_verify).toBe("${{ steps.verify.outcome }}");
      const report = workflow.jobs["production-schema"];
      expect(report.needs).toBe("backup-restore");
      expect(report.if).toBe("always() && github.event_name != 'pull_request'");
      expect(report.steps[0].run).toMatch(/success\)[\s\S]*failure\)[\s\S]*exit 1[\s\S]*\*\)[\s\S]*exit 1/);
      for (const field of ["restore_test", "db_verify", "fingerprint", "migration_rehearsal", "db_verify_after_migrations"]) {
        expect(steps.find((step) => step.id === "encrypt")!.run).toContain(`${field}=`);
      }
    });

    it("self-tests the very same drill commands on pull requests without production access", () => {
      const selftest = workflow.jobs["restore-drill-selftest"];
      expect(selftest.if).toBe("github.event_name == 'pull_request'");
      expect(selftest.permissions).toEqual({ contents: "read" });
      expect(selftest.environment).toBeUndefined();
      const selftestText = JSON.stringify(selftest);
      expect(selftestText).not.toMatch(/getIDToken|backup-credentials|BACKUP_CREDENTIAL_URL/);
      for (const name of [
        "Restore backup into isolated PostgreSQL 17",
        "Verify production schema and integrity on the restored copy",
        "Compare restored fingerprint with source",
        "Report production schema state on the restored copy",
        "Rehearse repository migrations on the restored copy",
        "Verify migrated copy integrity",
      ]) {
        const production = steps.find((step) => step.name === name);
        const rehearsal = (selftest.steps as Step[]).find((step) => step.name === name);
        expect(rehearsal?.run, name).toBe(production?.run);
        expect(rehearsal?.env, name).toEqual(production?.env);
      }
    });
  });
});
