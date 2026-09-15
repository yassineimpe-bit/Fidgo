import { googleWalletEnabled, googleWalletSaveLink } from "@/lib/google-wallet";
import { walletCardByToken } from "@/lib/wallet-data";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await walletCardByToken(token);
  if (!card) return Response.json({ error: "CARD_NOT_FOUND" }, { status: 404 });
  if (!googleWalletEnabled()) return Response.json({ error: "GOOGLE_WALLET_DISABLED" }, { status: 503 });
  try {
    const url = await googleWalletSaveLink(card);
    return Response.redirect(url, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOOGLE_WALLET_ERROR";
    console.error("Google Wallet issue failed", message);
    return Response.json({ error: "GOOGLE_WALLET_UNAVAILABLE" }, { status: 503 });
  }
}
