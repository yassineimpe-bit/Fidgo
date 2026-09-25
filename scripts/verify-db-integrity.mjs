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
const expectedEmailVerificationTriggers = [
  "staff_email_verification_revoke_on_state_change",
  "establishment_email_verification_revoke_on_suspend",
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
      ,(
        select count(*)::int
        from password_reset_tokens r
        join staff_users s on s.id=r.staff_user_id
        join establishments e on e.id=s.establishment_id
        where r.used_at is null and r.expires_at > now()
          and (not s.active or e.status <> 'active')
      ) as active_orphan_password_reset_tokens
      ,(
        select count(*)::int
        from email_verification_tokens v
        join staff_users s on s.id=v.staff_user_id
        join establishments e on e.id=s.establishment_id
        where v.used_at is null and v.expires_at > now()
          and (s.email_verified_at is not null or not s.active or e.status <> 'active')
      ) as active_orphan_email_verification_tokens
      ,(
        select count(*)::int from (
          select staff_user_id
          from email_verification_tokens
          where used_at is null
          group by staff_user_id
          having count(*) > 1
        ) duplicated
      ) as staff_with_multiple_active_email_verification_tokens
  `;
  // Migration 022 : contrôle actif dès que la table existe. Elle n'est pas
  // exigée ici, car la sauvegarde quotidienne vérifie la copie de production
  // avant de la chiffrer (le health check, lui, échoue fermé sans elle).
  const [legalTable] = await sql`select to_regclass('public.legal_acceptances') is not null as present`;
  const [legalData] = legalTable.present ? await sql`
    select
      (select count(*)::int from legal_acceptances a join staff_users s on s.id=a.staff_user_id where s.establishment_id<>a.establishment_id) as cross_tenant_acceptances,
      (select count(*)::int from staff_users where marketing_consent <> (marketing_consent_at is not null)) as incoherent_marketing_consents
  ` : [{ cross_tenant_acceptances: 0, incoherent_marketing_consents: 0 }];
  // Migration 024 : un logo importé référencé doit exister et appartenir au
  // même commerce ; aucun fichier ne doit rester sans commerce qui l'affiche.
  const [logoTable] = await sql`select to_regclass('public.establishment_logos') is not null as present`;
  const [logoData] = logoTable.present ? await sql`
    select
      (select count(*)::int from establishments e
        where e.logo_url like '/api/logos/%'
          and not exists (select 1 from establishment_logos l where l.id::text=substring(e.logo_url from 12) and l.establishment_id=e.id)) as broken_logo_refs,
      (select count(*)::int from establishment_logos l join establishments e on e.id=l.establishment_id
        where e.logo_url is distinct from '/api/logos/' || l.id::text) as orphan_logos
  ` : [{ broken_logo_refs: 0, orphan_logos: 0 }];
  const [campaignSchema] = await sql`
    select exists (select 1 from information_schema.columns where table_schema='public' and table_name='campaigns' and column_name='recipient_count') as present
  `;
  const [campaignData] = campaignSchema.present ? await sql`
    select
      (select count(*)::int from campaign_recipients r join campaigns ca on ca.id=r.campaign_id join customers cu on cu.id=r.customer_id
        where cu.establishment_id<>ca.establishment_id) as cross_tenant_recipients,
      -- L'effacement d'un client retire sa ligne destinataire : le décompte ne peut que baisser.
      (select count(*)::int from campaigns ca where ca.channel='email' and ca.recipient_count <
        (select count(*) from campaign_recipients r where r.campaign_id=ca.id)) as recipient_count_mismatches,
      (select count(*)::int from campaign_recipients r join customers cu on cu.id=r.customer_id where cu.deleted_at is not null) as erased_customer_recipients,
      (select count(*)::int from pg_trigger where tgname='campaign_recipients_same_tenant' and not tgisinternal) as tenant_trigger
  ` : [{ cross_tenant_recipients: 0, recipient_count_mismatches: 0, erased_customer_recipients: 0, tenant_trigger: 1 }];
  const [rewardTable] = await sql`select to_regclass('public.reward_notifications') is not null as present`;
  const [rewardData] = rewardTable.present ? await sql`
    select count(*)::int as cross_tenant_reward_notifications
    from reward_notifications n
    join cards c on c.id=n.card_id
    join transactions t on t.id=n.transaction_id
    where c.establishment_id<>n.establishment_id or t.establishment_id<>n.establishment_id or t.card_id<>n.card_id
  ` : [{ cross_tenant_reward_notifications: 0 }];
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
  const emailVerificationTriggers = await sql`
    select tgname from pg_trigger
    where not tgisinternal and tgname = any(${expectedEmailVerificationTriggers})
  `;
  const presentEmailVerificationTriggers = new Set(emailVerificationTriggers.map((row) => row.tgname));
  const missingEmailVerificationTriggers = expectedEmailVerificationTriggers.filter(
    (name) => !presentEmailVerificationTriggers.has(name),
  );
  const [emailVerificationIndex] = await sql`
    select to_regclass('public.email_verification_tokens_one_active_per_staff') is not null as present
  `;

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
  if (Number(tenantData.active_orphan_password_reset_tokens) > 0) failures.push(`${tenantData.active_orphan_password_reset_tokens} lien(s) password reset actif(s) sur un compte révoqué`);
  if (Number(tenantData.active_orphan_email_verification_tokens) > 0) failures.push(`${tenantData.active_orphan_email_verification_tokens} lien(s) de vérification e-mail actif(s) incohérent(s)`);
  if (Number(tenantData.staff_with_multiple_active_email_verification_tokens) > 0) failures.push(`${tenantData.staff_with_multiple_active_email_verification_tokens} compte(s) avec plusieurs liens de vérification e-mail actifs`);
  if (!emailVerificationIndex.present) failures.push("index d'unicité des liens de vérification e-mail manquant");
  if (missingEmailVerificationTriggers.length > 0) failures.push(`gardes vérification e-mail manquantes: ${missingEmailVerificationTriggers.join(", ")}`);
  if (Number(billingData.establishments_without_subscription) > 0) failures.push(`${billingData.establishments_without_subscription} commerce(s) sans état de facturation`);
  if (Number(billingData.webhook_tenant_mismatches) > 0) failures.push(`${billingData.webhook_tenant_mismatches} webhook(s) Stripe lié(s) au mauvais tenant`);
  if (Number(billingData.duplicate_stripe_customers) > 0) failures.push(`${billingData.duplicate_stripe_customers} client(s) Stripe dupliqué(s)`);
  if (Number(billingData.duplicate_stripe_subscriptions) > 0) failures.push(`${billingData.duplicate_stripe_subscriptions} abonnement(s) Stripe dupliqué(s)`);
  if (missingTriggers.length > 0) failures.push(`gardes hard-delete manquantes: ${missingTriggers.join(", ")}`);
  if (Number(legalData.cross_tenant_acceptances) > 0) failures.push(`${legalData.cross_tenant_acceptances} acceptation(s) CGU/CGV cross-tenant`);
  if (Number(logoData.broken_logo_refs) > 0) failures.push(`${logoData.broken_logo_refs} commerce(s) référençant un logo importé absent ou d'un autre tenant`);
  if (Number(logoData.orphan_logos) > 0) failures.push(`${logoData.orphan_logos} logo(s) importé(s) non référencé(s)`);
  if (Number(campaignData.cross_tenant_recipients) > 0) failures.push(`${campaignData.cross_tenant_recipients} destinataire(s) de campagne d'un autre tenant`);
  if (Number(campaignData.recipient_count_mismatches) > 0) failures.push(`${campaignData.recipient_count_mismatches} campagne(s) au nombre de destinataires incohérent`);
  if (Number(campaignData.erased_customer_recipients) > 0) failures.push(`${campaignData.erased_customer_recipients} destinataire(s) de campagne effacé(s) encore liés`);
  if (Number(campaignData.tenant_trigger) < 1) failures.push("garde tenant des destinataires de campagne manquante");
  if (Number(rewardData.cross_tenant_reward_notifications) > 0) failures.push(`${rewardData.cross_tenant_reward_notifications} notification(s) de récompense incohérente(s) (tenant, carte ou transaction)`);
  if (Number(legalData.incoherent_marketing_consents) > 0) failures.push(`${legalData.incoherent_marketing_consents} consentement(s) marketing commerçant incohérent(s)`);

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
  console.log(`Password reset tokens actifs incohérents : ${tenantData.active_orphan_password_reset_tokens}`);
  console.log(`Email verification tokens actifs incohérents : ${tenantData.active_orphan_email_verification_tokens}`);
  console.log(`Comptes avec plusieurs tokens e-mail actifs : ${tenantData.staff_with_multiple_active_email_verification_tokens}`);
  console.log(`Gardes vérification e-mail : ${expectedEmailVerificationTriggers.length - missingEmailVerificationTriggers.length}/${expectedEmailVerificationTriggers.length}, unicité=${Boolean(emailVerificationIndex.present)}`);
  console.log(`Commerces sans état de facturation : ${billingData.establishments_without_subscription}`);
  console.log(`Webhooks Stripe cross-tenant : ${billingData.webhook_tenant_mismatches}`);
  console.log(`Clients Stripe dupliqués : ${billingData.duplicate_stripe_customers}`);
  console.log(`Abonnements Stripe dupliqués : ${billingData.duplicate_stripe_subscriptions}`);
  console.log(`Gardes hard-delete : ${expectedLifecycleTriggers.length - missingTriggers.length}/${expectedLifecycleTriggers.length}`);
  console.log(`Acceptations CGU/CGV cross-tenant : ${legalTable.present ? legalData.cross_tenant_acceptances : "table absente (migration 022)"}`);
  console.log(`Consentements marketing commerçant incohérents : ${legalData.incoherent_marketing_consents}`);
  console.log(`Campagnes e-mail incohérentes : ${campaignSchema.present ? `${campaignData.cross_tenant_recipients} cross-tenant, ${campaignData.recipient_count_mismatches} compteur(s), ${campaignData.erased_customer_recipients} client(s) effacé(s)` : "colonnes absentes (migration 027)"}`);
  console.log(`Notifications de récompense incohérentes : ${rewardTable.present ? rewardData.cross_tenant_reward_notifications : "table absente (migration 028)"}`);
  console.log(`Logos importés incohérents : ${logoTable.present ? `${logoData.broken_logo_refs} référence(s) cassée(s), ${logoData.orphan_logos} orphelin(s)` : "table absente (migration 024)"}`);

  if (failures.length > 0) {
    console.error(`Intégrité DB invalide : ${failures.join(" ; ")}`);
    process.exitCode = 1;
  } else {
    console.log("Intégrité DB OK.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
