import { getBillingRuntimeStatus } from "@/lib/billing";
import { databaseConfigured } from "@/lib/db";
import { recoveryEmailConfigured } from "@/lib/email";
import { healthSchemaIsReady } from "@/lib/health-schema";
import { logHealthSnapshot } from "@/lib/observability";
import { readHealthSchemaFlags } from "@/lib/service-status";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";

export const dynamic = "force-dynamic";

function healthResponse(
  body: {
    ok: boolean;
    service: string;
    database: "up" | "down" | "unknown";
    schema: "up" | "down" | "unknown";
    auth: "up" | "down";
    wallet: { https: boolean; apple: boolean; google: boolean };
    billing: { enabled: boolean; configured: boolean };
    email: { recovery: boolean; passwordReset: boolean };
    serverMs: number;
  },
  status: number,
) {
  logHealthSnapshot({
    ok: body.ok,
    database: body.database,
    schema: body.schema,
    auth: body.auth,
    serverMs: body.serverMs,
  });

  return Response.json({
    ...body,
    checkedAt: new Date().toISOString(),
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const started = Date.now();
  const wallet = getWalletRuntimeStatus();
  const billing = getBillingRuntimeStatus();
  const emailConfigured = recoveryEmailConfigured();
  const authConfigured = Boolean(process.env.AUTH_SECRET?.trim());
  const walletState = {
    https: wallet.appUrlConfigured && wallet.appUrlHttps,
    apple: wallet.apple.configured,
    google: wallet.google.configured,
  };
  const billingState = { enabled: billing.enabled, configured: billing.configured };
  const emailState = { recovery: emailConfigured, passwordReset: emailConfigured };

  if (!databaseConfigured || !authConfigured) {
    return healthResponse({
      ok: false,
      service: "retiko",
      database: databaseConfigured ? "unknown" : "down",
      schema: "unknown",
      auth: authConfigured ? "up" : "down",
      wallet: walletState,
      billing: billingState,
      email: emailState,
      serverMs: Date.now() - started,
    }, 503);
  }

  try {
    const schema = await readHealthSchemaFlags();

    const schemaReady = healthSchemaIsReady(schema, process.env.STRIPE_ENABLED === "true");

    return healthResponse({
      ok: schemaReady,
      service: "retiko",
      database: "up",
      schema: schemaReady ? "up" : "down",
      auth: "up",
      wallet: walletState,
      billing: billingState,
      email: emailState,
      serverMs: Date.now() - started,
    }, schemaReady ? 200 : 503);
  } catch {
    return healthResponse({
      ok: false,
      service: "retiko",
      database: "down",
      schema: "unknown",
      auth: "up",
      wallet: walletState,
      billing: billingState,
      email: emailState,
      serverMs: Date.now() - started,
    }, 503);
  }
}
