import { backupOidcClaimsAreTrusted, RETIKO_BACKUP_OIDC_AUDIENCE } from "@/lib/backup-oidc";
import { issueDatabaseCredential } from "@/lib/oidc-credential-broker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(req: Request) {
  return issueDatabaseCredential(req, {
    audience: RETIKO_BACKUP_OIDC_AUDIENCE,
    trusted: backupOidcClaimsAreTrusted,
    label: "RETIKO_BACKUP",
  });
}
