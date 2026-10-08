import { createRemoteJWKSet, jwtVerify } from "jose";
import type { BackupOidcClaims } from "@/lib/backup-oidc";

const githubActionsJwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

const PRIVATE = { "cache-control": "no-store" };

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Échange un jeton OIDC GitHub Actions contre l'accès base de l'application,
 * pour un seul workflow de `main` (audience + claims stricts). Aucun
 * credential durable n'est stocké dans GitHub. `label` préfixe les journaux
 * (RETIKO_BACKUP_*, RETIKO_LIFECYCLE_*), qui ne contiennent jamais l'URL.
 */
export async function issueDatabaseCredential(
  req: Request,
  policy: { audience: string; trusted: (claims: BackupOidcClaims) => boolean; label: string },
): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE });

  try {
    const { payload } = await jwtVerify(token, githubActionsJwks, {
      issuer: "https://token.actions.githubusercontent.com",
      audience: policy.audience,
    });

    if (!policy.trusted(payload)) {
      // Claims refusés : ne jamais recopier leurs valeurs dans les journaux.
      console.warn(`${policy.label}_OIDC_REJECTED`);
      return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE });
    }

    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      console.error(`${policy.label}_CREDENTIAL_UNAVAILABLE`);
      return Response.json({ error: "BACKUP_CREDENTIAL_UNAVAILABLE" }, { status: 503, headers: PRIVATE });
    }

    console.info(`${policy.label}_CREDENTIAL_ISSUED`, {
      runId: typeof payload.run_id === "string" && /^\d+$/.test(payload.run_id) ? payload.run_id : "unknown",
      sha: typeof payload.sha === "string" ? payload.sha.slice(0, 7) : "unknown",
    });
    return Response.json({ databaseUrl }, { headers: PRIVATE });
  } catch {
    console.warn(`${policy.label}_OIDC_INVALID`);
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE });
  }
}
