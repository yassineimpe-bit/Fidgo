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
      service: "retiko",
      database: databaseConfigured ? "unknown" : "down",
      schema: "unknown",
      auth: authConfigured ? "up" : "down",
      wallet: walletState,
      serverMs: Date.now() - started,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  try {
    const [schema] = await sql`
      select
        to_regclass('public.card_recovery_tokens') is not null as recovery_table,
        to_regclass('public.product_events') is not null as product_events_table,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='staff_users' and column_name='token_version'
        ) as token_version,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='cards' and column_name='last_earn_at'
        ) as last_earn_at,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='loyalty_programs' and column_name='cooldown_seconds'
        ) as cooldown_seconds
    `;

    const schemaReady = Boolean(
      schema?.recovery_table
      && schema?.product_events_table
      && schema?.token_version
      && schema?.last_earn_at
      && schema?.cooldown_seconds
    );

    return Response.json({
      ok: schemaReady,
      service: "retiko",
      database: "up",
      schema: schemaReady ? "up" : "down",
      auth: "up",
      wallet: walletState,
      serverMs: Date.now() - started,
    }, { status: schemaReady ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({
      ok: false,
      service: "retiko",
      database: "down",
      schema: "unknown",
      auth: "up",
      wallet: walletState,
      serverMs: Date.now() - started,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
