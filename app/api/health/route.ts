import { sql } from "@/lib/db";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const wallet = getWalletRuntimeStatus();
  try {
    await sql`select 1 as ok`;
    return Response.json({
      ok: true,
      service: "fidgo",
      database: "up",
      wallet: {
        https: wallet.appUrlConfigured && wallet.appUrlHttps,
        apple: wallet.apple.configured,
        google: wallet.google.configured,
      },
      serverMs: Date.now() - started,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({
      ok: false,
      service: "fidgo",
      database: "down",
      wallet: {
        https: wallet.appUrlConfigured && wallet.appUrlHttps,
        apple: wallet.apple.configured,
        google: wallet.google.configured,
      },
      serverMs: Date.now() - started,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
