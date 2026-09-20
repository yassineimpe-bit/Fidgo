import { describe, expect, it } from "vitest";
import {
  backupOidcClaimsAreTrusted,
  RETIKO_BACKUP_IMMUTABLE_SUBJECT,
  RETIKO_BACKUP_LEGACY_SUBJECT,
  RETIKO_BACKUP_REPOSITORY,
  RETIKO_BACKUP_REPOSITORY_ID,
  RETIKO_BACKUP_REPOSITORY_OWNER_ID,
  RETIKO_BACKUP_REF,
  RETIKO_BACKUP_WORKFLOW_REF,
} from "../lib/backup-oidc";

function validClaims() {
  return {
    repository: RETIKO_BACKUP_REPOSITORY,
    repository_id: RETIKO_BACKUP_REPOSITORY_ID,
    repository_owner_id: RETIKO_BACKUP_REPOSITORY_OWNER_ID,
    ref: RETIKO_BACKUP_REF,
    workflow_ref: RETIKO_BACKUP_WORKFLOW_REF,
    sub: RETIKO_BACKUP_IMMUTABLE_SUBJECT,
    runner_environment: "github-hosted",
    event_name: "schedule",
    sha: "a".repeat(40),
  };
}

describe("backup GitHub OIDC trust policy", () => {
  it("accepts the immutable production subject used by recent GitHub repositories", () => {
    expect(backupOidcClaimsAreTrusted(validClaims())).toBe(true);
  });

  it("keeps compatibility with the legacy environment subject while IDs are checked separately", () => {
    expect(
      backupOidcClaimsAreTrusted({ ...validClaims(), sub: RETIKO_BACKUP_LEGACY_SUBJECT }),
    ).toBe(true);
  });

  it.each([
    ["repository", "attacker/Fidgo"],
    ["repository_id", "1"],
    ["repository_owner_id", "1"],
    ["ref", "refs/heads/feature"],
    ["workflow_ref", "yassineimpe-bit/Fidgo/.github/workflows/ci.yml@refs/heads/main"],
    ["sub", "repo:yassineimpe-bit/Fidgo:pull_request"],
    ["runner_environment", "self-hosted"],
    ["event_name", "pull_request"],
    ["sha", "not-a-sha"],
  ])("rejects an unexpected %s claim", (claim, value) => {
    expect(backupOidcClaimsAreTrusted({ ...validClaims(), [claim]: value })).toBe(false);
  });

  it("accepts only non-PR backup events", () => {
    for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
      expect(
        backupOidcClaimsAreTrusted({ ...validClaims(), event_name: eventName }),
      ).toBe(true);
    }
  });
});
