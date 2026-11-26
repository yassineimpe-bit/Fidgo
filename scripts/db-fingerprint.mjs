// Empreinte agrégée d'une base Retiko, sans aucune donnée personnelle :
// nombre de lignes de chaque table du schéma public, soldes et ledger agrégés.
// Sert au restore drill de `database-backup` : la base restaurée doit avoir
// exactement la même empreinte que la source au moment du dump.
//
//   DATABASE_URL=... node scripts/db-fingerprint.mjs > empreinte.json
//   node scripts/db-fingerprint.mjs --compare avant.json apres.json restauree.json
//
// La lecture se fait dans une transaction `repeatable read, read only` : toutes
// les valeurs viennent du même instantané et aucune écriture n'est possible.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export async function readFingerprint(sql) {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    await tx`set local statement_timeout = '60s'`;
    const tables = await tx`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `;
    const rows = {};
    for (const { name } of tables) {
      const [row] = await tx`select count(*)::bigint as n from ${tx(name)}`;
      rows[name] = String(row.n);
    }
    const aggregates = {};
    if (rows.cards !== undefined) {
      const [cards] = await tx`
        select coalesce(sum(balance), 0)::bigint as balance_total,
               count(*) filter (where active)::bigint as active_cards
        from cards
      `;
      aggregates.cards = { balanceTotal: String(cards.balance_total), activeCards: String(cards.active_cards) };
    }
    if (rows.transactions !== undefined) {
      const ledger = await tx`
        select type, unit, count(*)::bigint as n, coalesce(sum(delta), 0)::bigint as delta_total
        from transactions group by type, unit order by type, unit
      `;
      const [last] = await tx`select max(created_at) as at from transactions`;
      aggregates.transactions = {
        byTypeAndUnit: ledger.map((row) => ({ type: row.type, unit: row.unit, count: String(row.n), deltaTotal: String(row.delta_total) })),
        lastCreatedAt: last.at ? new Date(last.at).toISOString() : null,
      };
    }
    if (rows.cards !== undefined && rows.transactions !== undefined) {
      const [mismatch] = await tx`
        select count(*)::bigint as n from cards c
        left join (select card_id, sum(delta) as total from transactions group by card_id) l on l.card_id = c.id
        where coalesce(l.total, 0) <> c.balance
      `;
      aggregates.ledgerBalanceMismatches = String(mismatch.n);
    }
    if (rows.loyalty_programs !== undefined) {
      const modes = await tx`select mode, count(*)::bigint as n from loyalty_programs group by mode order by mode`;
      aggregates.programsByMode = Object.fromEntries(modes.map((row) => [row.mode, String(row.n)]));
    }
    if (rows.establishments !== undefined) {
      const statuses = await tx`select status, count(*)::bigint as n from establishments group by status order by status`;
      aggregates.establishmentsByStatus = Object.fromEntries(statuses.map((row) => [row.status, String(row.n)]));
    }
    return { rows, aggregates };
  });
}

/** Différences lisibles entre deux empreintes (vide si identiques). */
export function diffFingerprints(expected, actual) {
  const differences = [];
  const tables = new Set([...Object.keys(expected.rows), ...Object.keys(actual.rows)]);
  for (const table of [...tables].sort()) {
    const a = expected.rows[table];
    const b = actual.rows[table];
    if (a !== b) differences.push(`table ${table} : ${a ?? "absente"} ligne(s) attendue(s), ${b ?? "absente"} trouvée(s)`);
  }
  const left = JSON.stringify(expected.aggregates);
  const right = JSON.stringify(actual.aggregates);
  if (left !== right) differences.push(`agrégats différents : attendu ${left}, trouvé ${right}`);
  return differences;
}

/**
 * Verdict du restore drill. La source n'est figée qu'entre deux lectures
 * identiques (avant / après pg_dump) : si elle a bougé pendant le dump, la
 * comparaison stricte n'est pas possible et le verdict le dit, sans échouer.
 */
export function restoreVerdict(before, after, restored) {
  const sourceMoved = diffFingerprints(before, after);
  if (sourceMoved.length > 0) {
    return { status: "inconclusive", differences: sourceMoved };
  }
  const differences = diffFingerprints(before, restored);
  return { status: differences.length ? "mismatch" : "match", differences };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") {
    const [before, after, restored] = await Promise.all(args.slice(1, 4).map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))));
    const verdict = restoreVerdict(before, after, restored);
    const tables = Object.keys(before.rows).length;
    if (verdict.status === "match") {
      console.log(`Empreinte identique entre la source et la base restaurée (${tables} tables, soldes et ledger agrégés).`);
      return;
    }
    if (verdict.status === "inconclusive") {
      console.log("::warning::La source a changé pendant le dump : comparaison stricte de l'empreinte impossible pour ce run.");
      for (const line of verdict.differences) console.log(`  ~ ${line}`);
      return;
    }
    console.log("::error::La base restaurée ne correspond pas à la source au moment du dump.");
    for (const line of verdict.differences) console.log(`  - ${line}`);
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL est requis.");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    console.log(JSON.stringify(await readFingerprint(sql), null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
