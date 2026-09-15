import { appleWalletEnabled, buildApplePass } from "@/lib/apple-wallet";
import { enforceRateLimit } from "@/lib/rate-limit";
import { walletCardByToken } from "@/lib/wallet-data";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // Emission de pass = signature cryptographique + ecriture en base.
  // Route publique, donc plafonnee pour eviter un DoS CPU bon marche.
  const limited = await enforceRateLimit(request, "wallet-apple-issue", 10, 60);
  if (limited) return limited;

  const { token } = await params;
  const card = await walletCardByToken(token);
  if (!card) return Response.json({ error: "CARD_NOT_FOUND" }, { status: 404 });
  if (!appleWalletEnabled()) return Response.json({ error: "APPLE_WALLET_DISABLED" }, { status: 503 });
  try {
    const pass = await buildApplePass(card);
    return new Response(new Uint8Array(pass), {
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "content-disposition": `attachment; filename="fidgo-${card.shortCode}.pkpass"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APPLE_WALLET_ERROR";
    console.error("Apple Wallet issue failed", message);
    return Response.json({ error: "APPLE_WALLET_UNAVAILABLE" }, { status: 503 });
  }
}
