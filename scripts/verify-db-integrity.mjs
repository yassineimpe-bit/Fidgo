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
  `;

  const constraints = await sql`
    select conname
    from pg_constraint
    where conname = any(${expectedTenantConstraints})
  `;
  const presentConstraints = new Set(constraints.map((row) => row.conname));
  const missingConstraints = expectedTenantConstraints.filter((name) => !presentConstraints.has(name));

  const failures = [];
  if (Number(summary.negative_balances) > 0) failures.push(`${summary.negative_balances} solde(s) négatif(s)`);
  if (Number(summary.ledger_mismatches) > 0) failures.push(`${summary.ledger_mismatches} carte(s) avec ledger != balance`);
  if (missingConstraints.length > 0) failures.push(`contraintes tenant manquantes: ${missingConstraints.join(", ")}`);
  if (Number(tenantData.product_event_card_mismatches) > 0) failures.push(`${tenantData.product_event_card_mismatches} product_event(s) lié(s) à une carte d'un autre tenant`);
  if (Number(tenantData.product_event_staff_mismatches) > 0) failures.push(`${tenantData.product_event_staff_mismatches} product_event(s) lié(s) à un staff d'un autre tenant`);
  if (Number(tenantData.audit_staff_mismatches) > 0) failures.push(`${tenantData.audit_staff_mismatches} audit_log(s) avec acteur hors tenant ou tenant absent`);
  if (Number(tenantData.reversal_tenant_mismatches) > 0) failures.push(`${tenantData.reversal_tenant_mismatches} annulation(s) liée(s) à un autre tenant`);
  if (Number(tenantData.duplicate_reversals) > 0) failures.push("transaction(s) annulée(s) plusieurs fois");

  console.log(`Cartes vérifiées : ${summary.cards_total}`);
  console.log(`Soldes négatifs : ${summary.negative_balances}`);
  console.log(`Écarts ledger/cache : ${summary.ledger_mismatches}`);
  console.log(`Contraintes tenant : ${expectedTenantConstraints.length - missingConstraints.length}/${expectedTenantConstraints.length}`);
  console.log(`Événements carte cross-tenant : ${tenantData.product_event_card_mismatches}`);
  console.log(`Événements staff cross-tenant : ${tenantData.product_event_staff_mismatches}`);
  console.log(`Audits staff cross-tenant/tenant absent : ${tenantData.audit_staff_mismatches}`);
  console.log(`Annulations cross-tenant : ${tenantData.reversal_tenant_mismatches}`);
  console.log(`Transactions annulées plusieurs fois : ${tenantData.duplicate_reversals || 0}`);

  if (failures.length > 0) {
    console.error(`Intégrité DB invalide : ${failures.join(" ; ")}`);
    process.exitCode = 1;
  } else {
    console.log("Intégrité DB OK.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
