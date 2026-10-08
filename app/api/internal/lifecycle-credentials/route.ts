import { lifecycleOidcClaimsAreTrusted, RETIKO_LIFECYCLE_OIDC_AUDIENCE } from "@/lib/backup-oidc";
import { issueDatabaseCredential } from "@/lib/oidc-credential-broker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rétention des données (#251) : réservé à data-lifecycle.yml sur main, au
// lieu d'un DATABASE_URL durable dans les secrets GitHub.
export function POST(req: Request) {
  return issueDatabaseCredential(req, {
    audience: RETIKO_LIFECYCLE_OIDC_AUDIENCE,
    trusted: lifecycleOidcClaimsAreTrusted,
    label: "RETIKO_LIFECYCLE",
  });
}
