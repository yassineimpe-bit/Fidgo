import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  backupOidcClaimsAreTrusted,
  RETIKO_BACKUP_OIDC_AUDIENCE,
} from "@/lib/backup-oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const githubActionsJwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const { payload } = await jwtVerify(token, githubActionsJwks, {
      issuer: "https://token.actions.githubusercontent.com",
      audience: RETIKO_BACKUP_OIDC_AUDIENCE,
    });

    if (!backupOidcClaimsAreTrusted(payload)) {
      console.warn("RETIKO_BACKUP_OIDC_REJECTED", {
        repository: typeof payload.repository === "string" ? payload.repository : "unknown",
        event: typeof payload.event_name === "string" ? payload.event_name : "unknown",
      });
      return Response.json(
        { error: "FORBIDDEN" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      console.error("RETIKO_BACKUP_CREDENTIAL_UNAVAILABLE");
      return Response.json(
        { error: "BACKUP_CREDENTIAL_UNAVAILABLE" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    console.info("RETIKO_BACKUP_CREDENTIAL_ISSUED", {
      runId: typeof payload.run_id === "string" ? payload.run_id : "unknown",
      sha: typeof payload.sha === "string" ? payload.sha.slice(0, 7) : "unknown",
    });

    return Response.json(
      { databaseUrl },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    console.warn("RETIKO_BACKUP_OIDC_INVALID");
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}
