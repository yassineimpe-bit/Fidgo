import { sql } from "@/lib/db";
import { notifyAppleWallet } from "@/lib/apple-wallet";
import { syncGoogleWallet } from "@/lib/google-wallet";
import { walletCardById } from "@/lib/wallet-data";

export async function syncWalletsForCard(cardId: string) {
  const card = await walletCardById(cardId);
  if (!card) return;
  const passes = await sql`select provider from wallet_passes where card_id=${cardId} and status in ('active','error')`;
  const providers = new Set(passes.map((row) => String(row.provider)));
  const tasks: Promise<unknown>[] = [];
  if (providers.has("GOOGLE")) tasks.push(syncGoogleWallet(card));
  if (providers.has("APPLE")) tasks.push(notifyAppleWallet(cardId));
  await Promise.allSettled(tasks);
}
