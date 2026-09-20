import { getBillingRuntimeStatus } from "@/lib/billing";
import { databaseConfigured, sql } from "@/lib/db";
import { recoveryEmailConfigured } from "@/lib/email";
import { healthSchemaIsReady } from "@/lib/health-schema";
import { logHealthSnapshot } from "@/lib/observability";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";

export const dynamic = "force-dynamic";

function version() {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
}

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
    version: version(),
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
    const [schema] = await sql`
      select
        to_regclass('public.card_recovery_tokens') is not null as recovery_table,
        to_regclass('public.password_reset_tokens') is not null as password_reset_table,
        to_regclass('public.product_events') is not null as product_events_table,
        to_regclass('public.stripe_webhook_events') is not null as stripe_webhook_events_table,
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
        ) as cooldown_seconds,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='subscriptions' and column_name='trial_ends_at'
        ) as billing_trial_end,
        (
          select count(*)::int = 5 from pg_constraint
          where connamespace='public'::regnamespace and conname = any(array[
            'product_events_card_same_tenant_fk',
            'product_events_staff_same_tenant_fk',
            'audit_logs_staff_same_tenant_fk',
            'audit_logs_staff_requires_tenant_check',
            'transactions_reversal_same_tenant_fk'
          ])
        ) as tenant_integrity,
        to_regclass('public.transactions_reversed_once_key') is not null as reversal_once,
        (
          select count(*)::int = 3 from pg_trigger
          where not tgisinternal and tgname = any(array[
            'establishments_no_hard_delete',
            'customers_no_hard_delete',
            'cards_no_hard_delete'
          ])
        ) as lifecycle_guards,
        exists(
          select 1 from pg_constraint
          where connamespace='public'::regnamespace and conname='customers_erased_pii_check'
        ) as erased_pii_check
    `;

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
