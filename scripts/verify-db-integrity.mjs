import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est requis.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const expectedTenantConstraints = [
  "cards_customer_same_tenant_fk",
  "transactions_card_same_tenant_fk",
  "transactions_staff_same_tenant_fk",
  "wallet_passes_card_same_tenant_fk",
  "product_events_card_same_tenant_fk",
  "product_events_staff_same_tenant_fk",
  "audit_logs_staff_same_tenant_fk",
  "audit_logs_staff_requires_tenant_check",
  "transactions_reversal_same_tenant_fk",
];
const expectedLifecycleTriggers = [
  "establishments_no_hard_delete",
  "customers_no_hard_delete",
  "cards_no_hard_delete",
];

try {
  const [summary] = await sql`
    select
      count(*)::int as cards_total,
      count(*) filter (where c.balance < 0)::int as negative_balances,
      count(*) filter (where coalesce(x.ledger_balance,0) <> c.balance)::int as ledger_mismatches
    from cards c
    left join (
      select card_id,sum(delta)::int as ledger_balance
      from transactions
      group by card_id
    ) x on x.card_id=c.id
  `;

  const [tenantData] = await sql`
    select
      (
        select count(*)::int
        from product_events pe
        join cards c on c.id=pe.card_id
        where pe.card_id is not null
          and pe.establishment_id <> c.establishment_id
      ) as product_event_card_mismatches,
      (
        select count(*)::int
        from product_events pe
        join staff_users s on s.id=pe.staff_user_id
        where pe.staff_user_id is not null
          and pe.establishment_id <> s.establishment_id
      ) as product_event_staff_mismatches,
      (
        select count(*)::int
        from audit_logs a
        join staff_users s on s.id=a.staff_user_id
        where a.staff_user_id is not null
          and (a.establishment_id is null or a.establishment_id <> s.establishment_id)
      ) as audit_staff_mismatches
      ,(
        select count(*)::int
        from transactions r
        join transactions original on original.id=r.reversed_transaction_id
        where r.establishment_id <> original.establishment_id
      ) as reversal_tenant_mismatches
      ,(
        select count(*)::int
        from transactions
        where reversed_transaction_id is not null
        group by reversed_transaction_id
        having count(*) > 1
        limit 1
      ) as duplicate_reversals
      ,(
        select count(*)::int from customers
        where deleted_at is not null and (
          email is not null or phone is not null or first_name is not null
          or marketing_consent or marketing_consent_at is not null
        )
      ) as deleted_customer_pii
      ,(
        select count(*)::int from cards c join customers u on u.id=c.customer_id
        where u.deleted_at is not null and c.active
      ) as active_deleted_customer_cards
      ,(
        select count(*)::int
        from wallet_passes wp
        join cards c on c.id=wp.card_id
        join customers u on u.id=c.customer_id
        join establishments e on e.id=c.establishment_id
        where wp.status='active' and (not c.active or u.deleted_at is not null or e.status <> 'active')
      ) as active_orphan_wallets
      ,(
        select count(*)::int
        from card_recovery_tokens r
        join cards c on c.id=r.card_id
        join customers u on u.id=c.customer_id
        join establishments e on e.id=c.establishment_id
        where r.used_at is null and r.expires_at > now()
          and (not c.active or u.deleted_at is not null or e.status <> 'active')
      ) as active_orphan_recovery_tokens
  `;
  const [billingData] = await sql`
    select
      (select count(*)::int from establishments e left join subscriptions s on s.establishment_id=e.id where s.id is null) as establishments_without_subscription,
      (select count(*)::int from stripe_webhook_events we join subscriptions s on s.external_subscription_id=we.external_subscription_id where we.establishment_id is not null and we.establishment_id<>s.establishment_id) as webhook_tenant_mismatches,
      (select count(*)::int from (select external_customer_id from subscriptions where external_customer_id is not null group by external_customer_id having count(*)>1) duplicates) as duplicate_stripe_customers,
      (select count(*)::int from (select external_subscription_id from subscriptions where external_subscription_id is not null group by external_subscription_id having count(*)>1) duplicates) as duplicate_stripe_subscriptions
  `;

  const constraints = await sql`
    select conname
    from pg_constraint
    where conname = any(${expectedTenantConstraints})
  `;
  const presentConstraints = new Set(constraints.map((row) => row.conname));
  const missingConstraints = expectedTenantConstraints.filter((name) => !presentConstraints.has(name));
  const triggers = await sql`
    select tgname from pg_trigger
    where not tgisinternal and tgname = any(${expectedLifecycleTriggers})
  `;
  const presentTriggers = new Set(triggers.map((row) => row.tgname));
  const missingTriggers = expectedLifecycleTriggers.filter((name) => !presentTriggers.has(name));

  const failures = [];
  if (Number(summary.negative_balances) > 0) failures.push(`${summary.negative_balances} solde(s) négatif(s)`);
  if (Number(summary.ledger_mismatches) > 0) failures.push(`${summary.ledger_mismatches} carte(s) avec ledger != balance`);
  if (missingConstraints.length > 0) failures.push(`contraintes tenant manquantes: ${missingConstraints.join(", ")}`);
  if (Number(tenantData.product_event_card_mismatches) > 0) failures.push(`${tenantData.product_event_card_mismatches} product_event(s) lié(s) à une carte d'un autre tenant`);
  if (Number(tenantData.product_event_staff_mismatches) > 0) failures.push(`${tenantData.product_event_staff_mismatches} product_event(s) lié(s) à un staff d'un autre tenant`);
  if (Number(tenantData.audit_staff_mismatches) > 0) failures.push(`${tenantData.audit_staff_mismatches} audit_log(s) avec acteur hors tenant ou tenant absent`);
  if (Number(tenantData.reversal_tenant_mismatches) > 0) failures.push(`${tenantData.reversal_tenant_mismatches} annulation(s) liée(s) à un autre tenant`);
  if (Number(tenantData.duplicate_reversals) > 0) failures.push("transaction(s) annulée(s) plusieurs fois");
  if (Number(tenantData.deleted_customer_pii) > 0) failures.push(`${tenantData.deleted_customer_pii} client(s) effacé(s) contiennent encore des données personnelles`);
  if (Number(tenantData.active_deleted_customer_cards) > 0) failures.push(`${tenantData.active_deleted_customer_cards} carte(s) active(s) pour un client effacé`);
  if (Number(tenantData.active_orphan_wallets) > 0) failures.push(`${tenantData.active_orphan_wallets} Wallet(s) actif(s) sur une ressource révoquée`);
  if (Number(tenantData.active_orphan_recovery_tokens) > 0) failures.push(`${tenantData.active_orphan_recovery_tokens} lien(s) recovery actif(s) sur une ressource révoquée`);
  if (Number(billingData.establishments_without_subscription) > 0) failures.push(`${billingData.establishments_without_subscription} commerce(s) sans état de facturation`);
  if (Number(billingData.webhook_tenant_mismatches) > 0) failures.push(`${billingData.webhook_tenant_mismatches} webhook(s) Stripe lié(s) au mauvais tenant`);
  if (Number(billingData.duplicate_stripe_customers) > 0) failures.push(`${billingData.duplicate_stripe_customers} client(s) Stripe dupliqué(s)`);
  if (Number(billingData.duplicate_stripe_subscriptions) > 0) failures.push(`${billingData.duplicate_stripe_subscriptions} abonnement(s) Stripe dupliqué(s)`);
  if (missingTriggers.length > 0) failures.push(`gardes hard-delete manquantes: ${missingTriggers.join(", ")}`);

  console.log(`Cartes vérifiées : ${summary.cards_total}`);
  console.log(`Soldes négatifs : ${summary.negative_balances}`);
  console.log(`Écarts ledger/cache : ${summary.ledger_mismatches}`);
  console.log(`Contraintes tenant : ${expectedTenantConstraints.length - missingConstraints.length}/${expectedTenantConstraints.length}`);
  console.log(`Événements carte cross-tenant : ${tenantData.product_event_card_mismatches}`);
  console.log(`Événements staff cross-tenant : ${tenantData.product_event_staff_mismatches}`);
  console.log(`Audits staff cross-tenant/tenant absent : ${tenantData.audit_staff_mismatches}`);
  console.log(`Annulations cross-tenant : ${tenantData.reversal_tenant_mismatches}`);
  console.log(`Transactions annulées plusieurs fois : ${tenantData.duplicate_reversals || 0}`);
  console.log(`Clients effacés avec PII résiduelle : ${tenantData.deleted_customer_pii}`);
  console.log(`Cartes actives de clients effacés : ${tenantData.active_deleted_customer_cards}`);
  console.log(`Wallets actifs incohérents : ${tenantData.active_orphan_wallets}`);
  console.log(`Recovery tokens actifs incohérents : ${tenantData.active_orphan_recovery_tokens}`);
  console.log(`Commerces sans état de facturation : ${billingData.establishments_without_subscription}`);
  console.log(`Webhooks Stripe cross-tenant : ${billingData.webhook_tenant_mismatches}`);
  console.log(`Clients Stripe dupliqués : ${billingData.duplicate_stripe_customers}`);
  console.log(`Abonnements Stripe dupliqués : ${billingData.duplicate_stripe_subscriptions}`);
  console.log(`Gardes hard-delete : ${expectedLifecycleTriggers.length - missingTriggers.length}/${expectedLifecycleTriggers.length}`);

  if (failures.length > 0) {
    console.error(`Intégrité DB invalide : ${failures.join(" ; ")}`);
    process.exitCode = 1;
  } else {
    console.log("Intégrité DB OK.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
