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

  console.log(`Cartes vérifiées : ${summary.cards_total}`);
  console.log(`Soldes négatifs : ${summary.negative_balances}`);
  console.log(`Écarts ledger/cache : ${summary.ledger_mismatches}`);
  console.log(`Contraintes tenant : ${expectedTenantConstraints.length - missingConstraints.length}/${expectedTenantConstraints.length}`);

  if (failures.length > 0) {
    console.error(`Intégrité DB invalide : ${failures.join(" ; ")}`);
    process.exitCode = 1;
  } else {
    console.log("Intégrité DB OK.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
