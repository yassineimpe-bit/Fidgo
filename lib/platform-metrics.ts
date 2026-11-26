import type { PendingQuery, Row } from "postgres";
import { sql } from "@/lib/db";

/**
 * Définitions métier partagées entre /dashboard/analytics (un commerce) et
 * /admin (tous les commerces). Les requêtes du cockpit reprennent exactement
 * les mêmes filtres SQL que la page analytics commerçant :
 * - client actif      = carte avec au moins un passage crédité (`earn`) sur la période ;
 * - client revenu     = client actif crédité sur au moins 2 jours calendaires (Europe/Paris) ;
 * - récompense utilisée = transaction `redeem` ;
 * - récompense disponible = carte active, client non effacé, programme actif, solde ≥ seuil ;
 * - taux d'échec scanner = SCAN_FAILED / (SCAN_SUCCESS + SCAN_FAILED) ;
 * - p95 scanner       = 95e centile de `duration_ms` des SCAN_SUCCESS.
 * Côté plateforme, un commerce actif = au moins un `earn` sur la période.
 */

/** Pourcentage arrondi, ou null quand le dénominateur est nul (jamais de NaN). */
export function ratePercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/** Part des récompenses utilisées parmi les récompenses utilisées + encore disponibles. */
export function rewardUsageRate(redeemed: number, available: number) {
  return ratePercent(redeemed, redeemed + available);
}

export function scanErrorRate(success: number, failed: number) {
  return ratePercent(failed, success + failed);
}

export function formatPercent(value: number | null) {
  return value === null ? "—" : `${value} %`;
}

export function formatRatio(numerator: number, denominator: number) {
  return denominator > 0 && Number.isFinite(numerator) ? (numerator / denominator).toFixed(1) : "—";
}

export function formatMs(value: unknown) {
  if (value === null || value === undefined) return "—";
  const ms = Number(value);
  return Number.isFinite(ms) ? `${Math.round(ms)} ms` : "—";
}

/** Jours écoulés depuis une date, arrondis à l'inférieur ; null si la date est absente ou invalide. */
export function daysSince(value: unknown, now = new Date()) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/** Colonne SQL `date` : postgres.js la renvoie en Date à minuit UTC (ou en chaîne AAAA-MM-JJ). */
export function formatCalendarDate(value: unknown, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(`${String(value)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("fr-FR", { ...options, timeZone: "UTC" });
}

/**
 * Règles « À surveiller » : déterministes, sans score. Elles ne concernent que
 * les commerces ouverts (ni suspendus par Retiko, ni fermés par le commerçant).
 */
export const WATCH_RULES = {
  neverStartedAfterDays: 3,
  droppedAfterDays: 7,
  trialEndingWithinDays: 7,
  scannerMinAttempts7d: 10,
  scannerFailurePercent: 20,
} as const;

export type WatchReason = "never_started" | "dropped" | "trial_at_risk" | "scanner";

export const ACTIVITY_FILTERS = ["all", "24h", "7d", "30d", "never", "inactive7"] as const;
export type ActivityFilter = typeof ACTIVITY_FILTERS[number];
export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "Toutes",
  "24h": "Actif 24 h",
  "7d": "Actif 7 j",
  "30d": "Actif 30 j",
  never: "Jamais actif",
  inactive7: "Inactif depuis ≥ 7 j",
};

export const SUBSCRIPTION_FILTERS = ["all", "trial", "active", "past_due", "unpaid", "canceled", "none"] as const;
export type SubscriptionFilter = typeof SUBSCRIPTION_FILTERS[number];
export const SUBSCRIPTION_FILTER_LABELS: Record<SubscriptionFilter, string> = {
  all: "Tous",
  trial: "Essai",
  active: "Actif",
  past_due: "Paiement en retard",
  unpaid: "Impayé",
  canceled: "Annulé",
  none: "Sans abonnement",
};

export const SORTS = ["created", "last_activity", "scans_30d"] as const;
export type EstablishmentSort = typeof SORTS[number];
export const SORT_LABELS: Record<EstablishmentSort, string> = {
  created: "Inscription (récent d’abord)",
  last_activity: "Dernier passage crédité",
  scans_30d: "Passages crédités 30 j",
};

function pick<T extends string>(values: readonly T[], raw: string | string[] | undefined, fallback: T): T {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return values.find((candidate) => candidate === value) ?? fallback;
}

export function parseEstablishmentFilters(params: {
  status?: string | string[];
  activity?: string | string[];
  subscription?: string | string[];
  watch?: string | string[];
  sort?: string | string[];
}) {
  return {
    status: pick(["all", "active", "suspended"] as const, params.status, "all"),
    activity: pick(ACTIVITY_FILTERS, params.activity, "all"),
    subscription: pick(SUBSCRIPTION_FILTERS, params.subscription, "all"),
    watch: pick(["0", "1"] as const, params.watch, "0") === "1",
    sort: pick(SORTS, params.sort, "created"),
  };
}

export type EstablishmentFilters = ReturnType<typeof parseEstablishmentFilters>;

/**
 * Une ligne par commerce du périmètre `scope`, tous les indicateurs calculés en
 * agrégations groupées (une passe par table, aucune sous-requête par commerce).
 * Les tables lues sont filtrées sur les commerces du périmètre : pour une fiche,
 * les index (establishment_id, …) s'appliquent.
 */
export function establishmentUsage(scope: PendingQuery<Row[]>) {
  const rules = WATCH_RULES;
  return sql`
    with est as (
      select e.id, e.name, e.slug, e.status, e.platform_suspended_at, e.created_at, e.onboarding_step,
        o.email as owner_email,
        sub.plan, sub.status as subscription_status, sub.trial_ends_at,
        coalesce(p.active, false) as program_active, p.reward_threshold
      from establishments e
      left join staff_users o on o.establishment_id=e.id and o.role='OWNER'
      left join subscriptions sub on sub.establishment_id=e.id
      left join loyalty_programs p on p.establishment_id=e.id
      where ${scope}
    ),
    tx as (
      -- Agrégats simples sur tout l'historique : un HashAggregate, sans tri.
      select t.establishment_id,
        min(t.created_at) filter (where t.type='earn') as first_earn_at,
        max(t.created_at) filter (where t.type='earn') as last_earn_at,
        max(t.created_at) as last_transaction_at,
        count(*) filter (where t.type='earn')::int as earn_total,
        count(*) filter (where t.type='redeem')::int as redeem_total,
        count(*) filter (where t.type='earn' and t.created_at >= now() - interval '24 hours')::int as earn_24h,
        count(*) filter (where t.type='earn' and t.created_at >= now() - interval '7 days')::int as earn_7d,
        count(*) filter (where t.type='earn' and t.created_at >= now() - interval '30 days')::int as earn_30d,
        count(*) filter (where t.type='redeem' and t.created_at >= now() - interval '30 days')::int as rewards_30d
      from transactions t
      where t.establishment_id in (select id from est)
      group by t.establishment_id
    ),
    earn_days_30d as (
      -- Une ligne par (commerce, carte, jour Europe/Paris) crédité sur 30 j.
      select t.establishment_id, t.card_id, (t.created_at at time zone 'Europe/Paris')::date as day,
        max(t.created_at) as last_at
      from transactions t
      where t.establishment_id in (select id from est)
        and t.type='earn'
        and t.created_at >= now() - interval '30 days'
      group by 1, 2, 3
    ),
    customers_30d as (
      -- Client actif = carte créditée sur 30 j ; client revenu = créditée sur ≥ 2 jours distincts.
      select establishment_id, count(*)::int as active_customers_30d,
        count(*) filter (where days >= 2)::int as returning_customers_30d
      from (select establishment_id, card_id, count(*) as days from earn_days_30d group by 1, 2) per_card
      group by establishment_id
    ),
    days_7d as (
      select establishment_id, count(*)::int as earn_days_7d
      from (select distinct establishment_id, day from earn_days_30d where last_at >= now() - interval '7 days') active_days
      group by establishment_id
    ),
    cust as (
      select u.establishment_id,
        count(*)::int as customers,
        count(*) filter (where u.created_at >= now() - interval '30 days')::int as new_customers_30d
      from customers u
      where u.establishment_id in (select id from est) and u.deleted_at is null
      group by u.establishment_id
    ),
    avail as (
      select c.establishment_id, count(*)::int as rewards_available
      from cards c
      join customers u on u.id=c.customer_id
      join loyalty_programs p on p.establishment_id=c.establishment_id
      where c.establishment_id in (select id from est)
        and c.active=true and u.deleted_at is null and p.active=true
        and c.balance >= p.reward_threshold
      group by c.establishment_id
    ),
    scans as (
      select pe.establishment_id,
        count(*) filter (where pe.event_type='SCAN_SUCCESS')::int as scan_success_7d,
        count(*) filter (where pe.event_type='SCAN_FAILED')::int as scan_failed_7d,
        count(*) filter (where pe.event_type='SCAN_SUCCESS' and pe.created_at >= now() - interval '24 hours')::int as scan_success_24h,
        count(*) filter (where pe.event_type='SCAN_FAILED' and pe.created_at >= now() - interval '24 hours')::int as scan_failed_24h,
        count(*) filter (where pe.event_type='CAMERA_FAILED')::int as camera_failed_7d,
        round(percentile_cont(0.95) within group (order by pe.duration_ms) filter (where pe.event_type='SCAN_SUCCESS' and pe.duration_ms is not null))::int as scan_p95_7d
      from product_events pe
      where pe.establishment_id in (select id from est)
        and pe.event_type in ('SCAN_SUCCESS','SCAN_FAILED','CAMERA_FAILED')
        and pe.created_at >= now() - interval '7 days'
      group by pe.establishment_id
    ),
    wallet as (
      select w.establishment_id,
        count(*) filter (where w.provider='APPLE' and w.status='active')::int as wallet_apple_active,
        count(*) filter (where w.provider='GOOGLE' and w.status='active')::int as wallet_google_active,
        count(*) filter (where w.status='error')::int as wallet_errors
      from wallet_passes w
      where w.establishment_id in (select id from est)
      group by w.establishment_id
    ),
    usage as (
      select est.*,
        tx.first_earn_at, tx.last_earn_at, tx.last_transaction_at,
        coalesce(tx.earn_total,0) as earn_total, coalesce(tx.redeem_total,0) as redeem_total,
        coalesce(tx.earn_24h,0) as earn_24h, coalesce(tx.earn_7d,0) as earn_7d, coalesce(tx.earn_30d,0) as earn_30d,
        coalesce(tx.rewards_30d,0) as rewards_30d,
        coalesce(customers_30d.active_customers_30d,0) as active_customers_30d,
        coalesce(customers_30d.returning_customers_30d,0) as returning_customers_30d,
        coalesce(days_7d.earn_days_7d,0) as earn_days_7d,
        coalesce(cust.customers,0) as customers, coalesce(cust.new_customers_30d,0) as new_customers_30d,
        coalesce(avail.rewards_available,0) as rewards_available,
        coalesce(scans.scan_success_7d,0) as scan_success_7d, coalesce(scans.scan_failed_7d,0) as scan_failed_7d,
        coalesce(scans.scan_success_24h,0) as scan_success_24h, coalesce(scans.scan_failed_24h,0) as scan_failed_24h,
        coalesce(scans.camera_failed_7d,0) as camera_failed_7d, scans.scan_p95_7d,
        coalesce(wallet.wallet_apple_active,0) as wallet_apple_active,
        coalesce(wallet.wallet_google_active,0) as wallet_google_active,
        coalesce(wallet.wallet_errors,0) as wallet_errors
      from est
      left join tx on tx.establishment_id=est.id
      left join customers_30d on customers_30d.establishment_id=est.id
      left join days_7d on days_7d.establishment_id=est.id
      left join cust on cust.establishment_id=est.id
      left join avail on avail.establishment_id=est.id
      left join scans on scans.establishment_id=est.id
      left join wallet on wallet.establishment_id=est.id
    )
    select usage.*,
      (status='active' and first_earn_at is null
        and created_at < now() - ${rules.neverStartedAfterDays}::int * interval '1 day') as watch_never_started,
      (status='active' and first_earn_at is not null
        and last_earn_at < now() - ${rules.droppedAfterDays}::int * interval '1 day') as watch_dropped,
      (status='active' and subscription_status='trial'
        and trial_ends_at >= now()
        and trial_ends_at < now() + ${rules.trialEndingWithinDays}::int * interval '1 day'
        and earn_7d = 0) as watch_trial_at_risk,
      (status='active'
        and scan_success_7d + scan_failed_7d >= ${rules.scannerMinAttempts7d}::int
        and scan_failed_7d * 100 >= ${rules.scannerFailurePercent}::int * (scan_success_7d + scan_failed_7d)) as watch_scanner
    from usage
  `;
}

export function activityCondition(activity: ActivityFilter) {
  switch (activity) {
    case "24h": return sql`u.earn_24h > 0`;
    case "7d": return sql`u.earn_7d > 0`;
    case "30d": return sql`u.earn_30d > 0`;
    case "never": return sql`u.first_earn_at is null`;
    case "inactive7": return sql`u.first_earn_at is not null and u.last_earn_at < now() - interval '7 days'`;
    default: return sql`true`;
  }
}

export function subscriptionCondition(subscription: SubscriptionFilter) {
  if (subscription === "all") return sql`true`;
  if (subscription === "none") return sql`u.subscription_status is null`;
  return sql`u.subscription_status = ${subscription}`;
}

export function sortClause(sort: EstablishmentSort) {
  switch (sort) {
    case "last_activity": return sql`u.last_earn_at desc nulls last, u.created_at desc, u.id`;
    case "scans_30d": return sql`u.earn_30d desc, u.created_at desc, u.id`;
    default: return sql`u.created_at desc, u.id`;
  }
}

export const WATCH_ANY = sql`(u.watch_never_started or u.watch_dropped or u.watch_trial_at_risk or u.watch_scanner)`;

export type UsageRow = Record<string, unknown>;

export function watchReasons(row: UsageRow): WatchReason[] {
  const reasons: WatchReason[] = [];
  if (row.watch_never_started) reasons.push("never_started");
  if (row.watch_dropped) reasons.push("dropped");
  if (row.watch_trial_at_risk) reasons.push("trial_at_risk");
  if (row.watch_scanner) reasons.push("scanner");
  return reasons;
}

/** Libellé factuel d'une règle déclenchée, sans jugement ni score. */
export function describeWatchReason(reason: WatchReason, row: UsageRow, now = new Date()) {
  const n = (value: unknown) => Number(value ?? 0);
  switch (reason) {
    case "never_started": {
      const days = daysSince(row.created_at, now);
      return `Inscrit depuis ${days ?? "?"} j · aucun passage crédité`;
    }
    case "dropped": {
      const days = daysSince(row.last_earn_at, now);
      return `Dernier passage crédité il y a ${days ?? "?"} j · ${n(row.earn_total)} passage${n(row.earn_total) > 1 ? "s" : ""} au total`;
    }
    case "trial_at_risk": {
      const end = row.trial_ends_at ? new Date(String(row.trial_ends_at)) : null;
      const left = end && !Number.isNaN(end.getTime()) ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)) : null;
      return `Essai terminé dans ${left ?? "?"} j · aucun passage crédité sur 7 j`;
    }
    case "scanner": {
      const attempts = n(row.scan_success_7d) + n(row.scan_failed_7d);
      return `Scanner : ${n(row.scan_failed_7d)} échecs sur ${attempts} tentatives en 7 j (${formatPercent(scanErrorRate(n(row.scan_success_7d), n(row.scan_failed_7d)))})`;
    }
  }
}

export const WATCH_REASON_LABELS: Record<WatchReason, string> = {
  never_started: "Jamais démarré",
  dropped: "Décrochage",
  trial_at_risk: "Essai à risque",
  scanner: "Scanner",
};

/** Durée lisible (« 2 j 5 h », « 3 h », « < 1 h ») ; « — » si absente ou invalide. */
export function formatDuration(seconds: unknown) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return "—";
  const hours = Math.floor(total / 3600);
  if (hours < 1) return "< 1 h";
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days === 0) return `${hours} h`;
  return rest ? `${days} j ${rest} h` : `${days} j`;
}
