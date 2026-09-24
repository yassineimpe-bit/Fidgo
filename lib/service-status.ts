import { getBillingRuntimeStatus } from "@/lib/billing";
import { databaseConfigured, sql } from "@/lib/db";
import { recoveryEmailConfigured } from "@/lib/email";
import { healthSchemaIsReady, type HealthSchemaFlags } from "@/lib/health-schema";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";

export async function readHealthSchemaFlags(): Promise<HealthSchemaFlags> {
  const [schema] = await sql`
    select
      to_regclass('public.card_recovery_tokens') is not null as recovery_table,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='establishments' and column_name='onboarding_step') as onboarding_step,
      to_regclass('public.password_reset_tokens') is not null as password_reset_table,
      to_regclass('public.email_verification_tokens') is not null as email_verification_table,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='staff_users' and column_name='email_verified_at') as email_verified_at,
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

/**
 * Vue opérateur construite sur les mêmes contrôles que /api/health, sans rien
 * exposer de plus : libellés génériques, jamais de nom de variable ou de
 * credential, ni de version, ni de détail PostgreSQL.
 */
export async function collectServiceStatus(): Promise<ServiceLine[]> {
  let database: ServiceState = "down";
  let schema: ServiceState = "down";
  if (databaseConfigured) {
    try {
      const flags = await readHealthSchemaFlags();
      database = "up";
      schema = healthSchemaIsReady(flags, process.env.STRIPE_ENABLED === "true") ? "up" : "incomplete";
    } catch {
      database = "down";
    }
  }
  const authOk = (process.env.AUTH_SECRET?.trim().length ?? 0) >= 32;
  const wallet = getWalletRuntimeStatus();
  const https = wallet.appUrlConfigured && wallet.appUrlHttps;
  const billing = getBillingRuntimeStatus();
  const email = recoveryEmailConfigured();
  const provider = (enabled: boolean, configured: boolean): ServiceState => !enabled ? "off" : configured ? "up" : "incomplete";
  const providerDetail = (state: ServiceState) => state === "off" ? "Désactivé" : state === "up" ? "Configuré" : "Configuration incomplète";
  const apple = provider(wallet.apple.enabled, wallet.apple.configured);
  const google = provider(wallet.google.enabled, wallet.google.configured);
  const stripe = provider(billing.enabled, billing.configured);

  return [
    { name: "Base de données", state: database, detail: database === "up" ? "Connexion vérifiée" : "Injoignable ou non configurée" },
    { name: "Schéma et contraintes", state: schema, detail: schema === "up" ? "Migrations critiques présentes" : schema === "incomplete" ? "Migration manquante" : "Non vérifiable" },
    { name: "Authentification", state: authOk ? "up" : "down", detail: authOk ? "Configurée" : "Configuration manquante" },
    { name: "URL publique HTTPS", state: https ? "up" : "down", detail: https ? "Configurée" : "Absente ou non HTTPS" },
    { name: "Apple Wallet", state: apple, detail: providerDetail(apple) },
    { name: "Google Wallet", state: google, detail: providerDetail(google) },
    { name: "Stripe", state: stripe, detail: providerDetail(stripe) },
    { name: "Email transactionnel", state: email ? "up" : "down", detail: email ? "Configuré" : "Requis pour la vérification des comptes commerçants" },
  ];
}
