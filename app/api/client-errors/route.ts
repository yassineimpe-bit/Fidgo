import { createHash } from "node:crypto";
import { boundedText } from "@/lib/input";
import { redactSensitivePath, withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin, requestIp } from "@/lib/security";

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const rate = await consumeRateLimit(`client-error:${requestIp(req)}`, 20, 60 * 60);
  if (!rate.allowed) return Response.json({ ok: true }, { status: 202 });

  const body = await req.json().catch(() => ({}));
  const name = boundedText(body.name, 80, "Error") || "Error";
  const message = boundedText(body.message, 500, "Unknown client error") || "Unknown client error";
  const path = redactSensitivePath(boundedText(body.path, 240, "/") || "/");
  const digest = boundedText(body.digest, 120) || null;
  const fingerprint = createHash("sha256").update(`${name}:${message}`).digest("hex").slice(0, 20);

  // Le message brut peut contenir une valeur saisie par l'utilisateur. Seule
  // son empreinte est envoyée aux logs d'observabilité. Le chemin est lui aussi
  // normalisé pour ne jamais journaliser token de carte, lien magique ou UUID.
  console.error("RETIKO_CLIENT_ERROR", {
    name,
    fingerprint,
    digest,
    path,
    userAgent: boundedText(req.headers.get("user-agent"), 300) || "unknown",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
  });
  return Response.json({ ok: true }, { status: 202 });
}

/**
 * Ce endpoint reçoit les erreurs client (voir app/error.tsx) : une base
 * injoignable ici ne doit pas générer une seconde erreur non gérée.
 */
export const POST = withApiErrorHandling("CLIENT_ERRORS", handlePost);
