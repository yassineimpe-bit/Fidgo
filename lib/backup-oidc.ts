export const RETIKO_BACKUP_OIDC_AUDIENCE = "retiko-backup";
export const RETIKO_BACKUP_REPOSITORY = "yassineimpe-bit/Fidgo";
export const RETIKO_BACKUP_REPOSITORY_ID = "1371041516";
export const RETIKO_BACKUP_REF = "refs/heads/main";
export const RETIKO_BACKUP_WORKFLOW_REF =
  "yassineimpe-bit/Fidgo/.github/workflows/database-backup.yml@refs/heads/main";
export const RETIKO_BACKUP_SUBJECT =
  "repo:yassineimpe-bit/Fidgo:environment:production";

const ALLOWED_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);

export type BackupOidcClaims = Record<string, unknown>;

function stringClaim(claims: BackupOidcClaims, name: string): string {
  return typeof claims[name] === "string" ? String(claims[name]) : "";
}

export function backupOidcClaimsAreTrusted(claims: BackupOidcClaims): boolean {
  const sha = stringClaim(claims, "sha");

  return (
    stringClaim(claims, "repository") === RETIKO_BACKUP_REPOSITORY &&
    stringClaim(claims, "repository_id") === RETIKO_BACKUP_REPOSITORY_ID &&
    stringClaim(claims, "ref") === RETIKO_BACKUP_REF &&
    stringClaim(claims, "workflow_ref") === RETIKO_BACKUP_WORKFLOW_REF &&
    stringClaim(claims, "sub") === RETIKO_BACKUP_SUBJECT &&
    stringClaim(claims, "runner_environment") === "github-hosted" &&
    ALLOWED_EVENTS.has(stringClaim(claims, "event_name")) &&
    /^[0-9a-f]{40}$/i.test(sha)
  );
}
