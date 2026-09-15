import { databaseConfigured, sql } from "@/lib/db";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const wallet = getWalletRuntimeStatus();
  const authConfigured = Boolean(process.env.AUTH_SECRET?.trim());
  const walletState = {
    https: wallet.appUrlConfigured && wallet.appUrlHttps,
    apple: wallet.apple.configured,
    google: wallet.google.configured,
  };

  if (!databaseConfigured || !authConfigured) {
    return Response.json({
      ok: false,
      service: "fidgo",
      database: databaseConfigured ? "unknown" : "down",
      auth: authConfigured ? "up" : "down",
      wallet: walletState,
      serverMs: Date.now() - started,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  try {
    await sql`select 1 as ok`;
    return Response.json({
      ok: true,
      service: "fidgo",
      database: "up",
      auth: "up",
      wallet: walletState,
      serverMs: Date.now() - started,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({
      ok: false,
      service: "fidgo",
      database: "down",
      auth: "up",
      wallet: walletState,
      serverMs: Date.now() - started,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
