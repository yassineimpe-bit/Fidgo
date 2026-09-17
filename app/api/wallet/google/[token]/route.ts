import { googleWalletEnabled, googleWalletSaveLink } from "@/lib/google-wallet";
import { enforceRateLimit } from "@/lib/rate-limit";
import { walletCardByToken } from "@/lib/wallet-data";
import { safeErrorCode } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // Emission de pass = signature cryptographique + ecriture en base.
  // Route publique, donc plafonnee pour eviter un DoS CPU bon marche.
  const limited = await enforceRateLimit(request, "wallet-google-issue", 10, 60);
  if (limited) return limited;

  const { token } = await params;
  const card = await walletCardByToken(token);
  if (!card) return Response.json({ error: "CARD_NOT_FOUND" }, { status: 404 });
  if (!googleWalletEnabled()) return Response.json({ error: "GOOGLE_WALLET_DISABLED" }, { status: 503 });
  try {
    const url = await googleWalletSaveLink(card);
    return Response.redirect(url, 302);
  } catch (error) {
    console.error("Google Wallet issue failed", { code: safeErrorCode(error, "GOOGLE_WALLET_ERROR") });
    return Response.json({ error: "GOOGLE_WALLET_UNAVAILABLE" }, { status: 503 });
  }
}
