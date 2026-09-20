export const RETIKO_BACKUP_OIDC_AUDIENCE = "retiko-backup";
export const RETIKO_BACKUP_REPOSITORY = "yassineimpe-bit/Fidgo";
export const RETIKO_BACKUP_REPOSITORY_ID = "1371041516";
export const RETIKO_BACKUP_REPOSITORY_OWNER_ID = "324819048";
export const RETIKO_BACKUP_REF = "refs/heads/main";
export const RETIKO_BACKUP_WORKFLOW_REF =
  "yassineimpe-bit/Fidgo/.github/workflows/database-backup.yml@refs/heads/main";
export const RETIKO_BACKUP_LEGACY_SUBJECT =
  "repo:yassineimpe-bit/Fidgo:environment:production";
export const RETIKO_BACKUP_IMMUTABLE_SUBJECT =
  "repo:yassineimpe-bit@324819048/Fidgo@1371041516:environment:production";

const ALLOWED_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const ALLOWED_SUBJECTS = new Set([
  RETIKO_BACKUP_LEGACY_SUBJECT,
  RETIKO_BACKUP_IMMUTABLE_SUBJECT,
]);

export type BackupOidcClaims = Record<string, unknown>;

function stringClaim(claims: BackupOidcClaims, name: string): string {
  return typeof claims[name] === "string" ? String(claims[name]) : "";
}

export function backupOidcClaimsAreTrusted(claims: BackupOidcClaims): boolean {
  const sha = stringClaim(claims, "sha");

  return (
    stringClaim(claims, "repository") === RETIKO_BACKUP_REPOSITORY &&
    stringClaim(claims, "repository_id") === RETIKO_BACKUP_REPOSITORY_ID &&
    stringClaim(claims, "repository_owner_id") === RETIKO_BACKUP_REPOSITORY_OWNER_ID &&
    stringClaim(claims, "ref") === RETIKO_BACKUP_REF &&
    stringClaim(claims, "workflow_ref") === RETIKO_BACKUP_WORKFLOW_REF &&
    ALLOWED_SUBJECTS.has(stringClaim(claims, "sub")) &&
    stringClaim(claims, "runner_environment") === "github-hosted" &&
    ALLOWED_EVENTS.has(stringClaim(claims, "event_name")) &&
    /^[0-9a-f]{40}$/i.test(sha)
  );
}
