import { getBillingRuntimeStatus } from "@/lib/billing";
import { databaseConfigured, sql } from "@/lib/db";
import { recoveryEmailConfigured } from "@/lib/email";
import { healthSchemaIsReady, type HealthSchemaFlags } from "@/lib/health-schema";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";

export async function readHealthSchemaFlags(): Promise<HealthSchemaFlags> {
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
  return schema;
}

export type ServiceState = "up" | "down" | "off" | "incomplete";
export type ServiceLine = { name: string; state: ServiceState; detail: string };

/** Vue opérateur : mêmes contrôles que /api/health, avec le détail des variables manquantes (noms seulement). */
export async function collectServiceStatus(): Promise<ServiceLine[]> {
  const started = Date.now();
  const lines: ServiceLine[] = [];
  const authOk = (process.env.AUTH_SECRET?.trim().length ?? 0) >= 32;

  let database: ServiceState = "down";
  let schema: ServiceState = "down";
  let dbDetail = databaseConfigured ? "Connexion impossible" : "DATABASE_URL absent";
  if (databaseConfigured) {
    try {
      const flags = await readHealthSchemaFlags();
      database = "up";
      dbDetail = `Réponse en ${Date.now() - started} ms`;
      schema = healthSchemaIsReady(flags, process.env.STRIPE_ENABLED === "true") ? "up" : "incomplete";
    } catch {
      schema = "down";
    }
  }
  lines.push({ name: "PostgreSQL", state: database, detail: dbDetail });
  lines.push({
    name: "Schéma et contraintes",
    state: schema,
    detail: schema === "up" ? "Migrations critiques présentes" : schema === "incomplete" ? "Migration manquante : lancer db:setup puis db:verify" : "Non vérifiable",
  });
  lines.push({ name: "Authentification", state: authOk ? "up" : "down", detail: authOk ? "AUTH_SECRET configuré" : "AUTH_SECRET absent ou trop court" });

  const wallet = getWalletRuntimeStatus();
  lines.push({
    name: "URL publique HTTPS",
    state: wallet.appUrlConfigured && wallet.appUrlHttps ? "up" : "down",
    detail: wallet.appUrlConfigured ? (wallet.appUrlHttps ? "NEXT_PUBLIC_APP_URL en HTTPS" : "NEXT_PUBLIC_APP_URL non HTTPS") : "NEXT_PUBLIC_APP_URL absent",
  });
  for (const [name, provider] of [["Apple Wallet", wallet.apple], ["Google Wallet", wallet.google]] as const) {
    lines.push({
      name,
      state: !provider.enabled ? "off" : provider.configured ? "up" : "incomplete",
      detail: !provider.enabled ? "Désactivé" : provider.configured ? "Configuré" : `À compléter : ${[...provider.missing, ...provider.invalid].join(", ")}`,
    });
  }

  const billing = getBillingRuntimeStatus();
  lines.push({
    name: "Stripe",
    state: !billing.enabled ? "off" : billing.configured ? "up" : "incomplete",
    detail: !billing.enabled ? "Désactivé" : billing.configured ? "Configuré" : `À compléter : ${[...billing.missing, ...billing.invalid].join(", ")}`,
  });

  const email = recoveryEmailConfigured();
  lines.push({ name: "Email transactionnel", state: email ? "up" : "off", detail: email ? "Resend configuré" : "Récupération / reset par email désactivés" });
  return lines;
}
