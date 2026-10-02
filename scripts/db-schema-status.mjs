// État réel du schéma, migration par migration, en LECTURE SEULE.
//
// Retiko n'a pas de table de suivi des migrations : `db:setup` rejoue
// `db/schema.sql` puis chaque fichier de `db/migrations`, et compte sur leur
// idempotence. Ce script reconstitue donc l'état appliqué à partir du
// catalogue PostgreSQL :
//
// 1. inventaire statique des objets que crée chaque fichier (tables, colonnes,
//    index, contraintes, triggers, fonctions, versions de contraintes testées
//    par `pg_get_constraintdef(...) like`) ;
// 2. présence de chaque objet dans la base ciblée ;
// 3. pré-contrôles de données pour les migrations encore à appliquer.
//
// Toutes les requêtes passent dans une transaction `read only` avec
// lock_timeout / statement_timeout courts : aucune écriture n'est possible.
//
//   DATABASE_URL=... node scripts/db-schema-status.mjs
//   DATABASE_URL=... node scripts/db-schema-status.mjs --snapshot schema.json
//   node scripts/db-schema-status.mjs --diff reference.json cible.json
//
// Le snapshot ne contient que la structure (aucune ligne métier, aucun secret).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const IDENT = "([a-z_][a-z0-9_]*)";
const root = process.cwd();

function stripComments(text) {
  return text.replace(/--[^\n]*/g, "");
}

/** Objets créés par un fichier SQL, dans l'ordre d'apparition. */
export function inventory(text) {
  const sqlText = stripComments(text).toLowerCase();
  const objects = [];
  const add = (kind, name, extra = {}) => objects.push({ kind, name, ...extra });
  for (const m of sqlText.matchAll(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${IDENT}`, "g"))) add("table", m[1]);
  for (const m of sqlText.matchAll(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\.)?${IDENT}([^;]*);`, "g"))) {
    for (const c of m[2].matchAll(new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${IDENT}`, "g"))) add("column", `${m[1]}.${c[1]}`);
    for (const c of m[2].matchAll(new RegExp(`add\\s+constraint\\s+${IDENT}`, "g"))) add("constraint", c[1], { table: m[1] });
  }
  for (const m of sqlText.matchAll(new RegExp(`create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${IDENT}`, "g"))) add("index", m[1]);
  for (const m of sqlText.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+${IDENT}`, "g"))) add("trigger", m[1]);
  for (const m of sqlText.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${IDENT}\\s*\\(`, "g"))) add("function", m[1]);
  // Versions de contraintes : `conname = 'x' and pg_get_constraintdef(oid) like '%y%'`.
  for (const m of sqlText.matchAll(new RegExp(`conname\\s*=\\s*'${IDENT}'[^;]*?pg_get_constraintdef\\(oid\\)\\s+like\\s+'([^']+)'`, "g"))) {
    add("constraintdef", m[1], { pattern: m[2] });
  }
  return objects;
}

async function sources() {
  const migrationDir = path.join(root, "db", "migrations");
  const files = (await fs.readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
  const list = [{ id: "schema.sql", file: path.join(root, "db", "schema.sql") }];
  for (const name of files) list.push({ id: name, file: path.join(migrationDir, name) });
  for (const source of list) source.objects = inventory(await fs.readFile(source.file, "utf8"));
  return list;
}

/**
 * Attribue chaque objet à la PREMIÈRE migration qui le crée : un objet déjà
 * créé par une migration antérieure ne prouve rien sur une migration qui le
 * recrée « if not exists ». `schema.sql` a été enrichi au fil du temps
 * (il contient des objets de migrations ultérieures) : il ne garde que les
 * objets qu'aucune migration ne crée. Les versions de contraintes sont propres
 * à leur migration.
 */
export function attribute(list) {
  const keyOf = (object) => object.kind === "constraintdef" ? `${object.kind}:${object.name}:${object.pattern}` : `${object.kind}:${object.name}`;
  const seen = new Set();
  const [schema, ...migrations] = list;
  const attributed = migrations.map((source) => {
    const own = [];
    for (const object of source.objects) {
      const key = keyOf(object);
      if (seen.has(key)) continue;
      seen.add(key);
      own.push(object);
    }
    return { id: source.id, objects: own };
  });
  const base = [];
  for (const object of schema.objects) {
    const key = keyOf(object);
    if (seen.has(key)) continue;
    seen.add(key);
    base.push(object);
  }
  return [{ id: schema.id, objects: base }, ...attributed];
}

async function catalog(tx) {
  const tables = await tx`select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`;
  const columns = await tx`
    select c.table_name || '.' || c.column_name as name, c.data_type, c.is_nullable, c.column_default
    from information_schema.columns c where c.table_schema='public'
  `;
  const indexes = await tx`select indexname as name, indexdef from pg_indexes where schemaname='public'`;
  const constraints = await tx`
    select con.conname as name, rel.relname as table_name, pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace
    where n.nspname='public'
  `;
  const triggers = await tx`
    select t.tgname as name, c.relname as table_name, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal
  `;
  const functions = await tx`
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, md5(p.prosrc) as body_md5
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
  `;
  return { tables, columns, indexes, constraints, triggers, functions };
}

function present(cat, object) {
  switch (object.kind) {
    case "table": return cat.tables.some((row) => row.name === object.name);
    case "column": return cat.columns.some((row) => row.name === object.name);
    case "index": return cat.indexes.some((row) => row.name === object.name);
    case "constraint": return cat.constraints.some((row) => row.name === object.name);
    case "trigger": return cat.triggers.some((row) => row.name === object.name);
    case "function": return cat.functions.some((row) => row.name === object.name);
    case "constraintdef": {
      const needle = object.pattern.replace(/^%|%$/g, "").toLowerCase();
      return cat.constraints.some((row) => row.name === object.name && row.def.toLowerCase().includes(needle));
    }
    default: return false;
  }
}

function label(object) {
  return object.kind === "constraintdef" ? `constraintdef ${object.name} ~ ${object.pattern}` : `${object.kind} ${object.name}`;
}

/** Pré-contrôles de données des migrations qui ajoutent des CHECK ou modifient des lignes. */
async function preflight(tx, pending, cat) {
  const has = (kind, name) => present(cat, { kind, name });
  const checks = [];
  if (pending.has("024_establishment_logos.sql")) {
    const [row] = await tx`
      select count(*)::int as n from establishments
      where logo_url is not null and not (logo_url ~* '^https://' or logo_url ~ '^/api/logos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    `;
    checks.push(["024", "logo_url incompatibles avec la nouvelle contrainte", row.n]);
  }
  if (pending.has("025_staff_two_factor.sql")) {
    checks.push(["025", "clé unique staff_users(id, establishment_id) absente (prérequis FK)", has("constraint", "staff_users_id_establishment_key") ? 0 : 1]);
  }
  if (pending.has("027_email_campaigns.sql") && has("table", "campaigns")) {
    const [row] = await tx`select count(*)::int as n from campaigns where channel='email'`;
    checks.push(["027", "campagnes channel='email' existantes (violeraient campaigns_email_shape_check)", row.n]);
    const [mismatch] = await tx`
      select count(*)::int as n from campaign_recipients r join campaigns ca on ca.id=r.campaign_id join customers cu on cu.id=r.customer_id
      where cu.establishment_id <> ca.establishment_id
    `;
    checks.push(["027", "destinataires de campagne cross-tenant (le trigger ne les corrige pas)", mismatch.n]);
  }
  if (pending.has("029_billing_price_grids.sql") && has("table", "subscriptions")) {
    const [row] = await tx`
      select count(*)::int as n from subscriptions
      where plan not in ('PILOT','FLEX','RETIKO_12','ANNUAL','STANDARD_MONTHLY','STANDARD_ANNUAL')
    `;
    checks.push(["029", "abonnements avec un plan hors grille", row.n]);
    if (has("column", "subscriptions.stripe_checkout_plan")) {
      const [checkout] = await tx`
        select count(*)::int as n from subscriptions
        where stripe_checkout_plan is not null and stripe_checkout_plan not in ('FLEX','RETIKO_12','ANNUAL','STANDARD_MONTHLY','STANDARD_ANNUAL')
      `;
      checks.push(["029", "stripe_checkout_plan hors grille", checkout.n]);
    }
  }
  if (pending.has("032_card_recovery_integrity.sql") && has("table", "card_recovery_tokens")) {
    const [row] = await tx`
      select coalesce(sum(n - 1), 0)::int as n from (
        select count(*) as n from card_recovery_tokens where used_at is null group by card_id having count(*) > 1
      ) x
    `;
    checks.push(["032", "liens recovery actifs en double qui seront révoqués (mise à jour de données attendue)", row.n]);
  }
  return checks;
}

function digest(cat) {
  const lines = [
    ...cat.tables.map((r) => `table ${r.name}`),
    ...cat.columns.map((r) => `column ${r.name} ${r.data_type} null=${r.is_nullable} default=${r.column_default ?? ""}`),
    ...cat.indexes.map((r) => `index ${r.name} ${r.indexdef}`),
    ...cat.constraints.map((r) => `constraint ${r.table_name}.${r.name} ${r.def}`),
    ...cat.triggers.map((r) => `trigger ${r.table_name}.${r.name} ${r.def}`),
    ...cat.functions.map((r) => `function ${r.name}(${r.args}) ${r.body_md5}`),
  ];
  return lines.sort();
}

async function diff(referencePath, targetPath) {
  const reference = JSON.parse(await fs.readFile(referencePath, "utf8"));
  const target = JSON.parse(await fs.readFile(targetPath, "utf8"));
  const ref = new Set(reference.objects);
  const tgt = new Set(target.objects);
  const missing = reference.objects.filter((line) => !tgt.has(line));
  const extra = target.objects.filter((line) => !ref.has(line));
  console.log(`Référence : ${reference.label} (${reference.objects.length} objets)`);
  console.log(`Cible     : ${target.label} (${target.objects.length} objets)`);
  console.log(`\nAbsents ou différents dans la cible (${missing.length}) :`);
  for (const line of missing) console.log(`  - ${line}`);
  console.log(`\nPrésents seulement dans la cible (${extra.length}) :`);
  for (const line of extra) console.log(`  + ${line}`);
  process.exitCode = missing.length || extra.length ? 2 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--diff") return diff(args[1], args[2]);
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL est requis.");
    process.exit(1);
  }
  const snapshotPath = args[0] === "--snapshot" ? args[1] : null;
  const list = attribute(await sources());
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin("read only", async (tx) => {
      await tx`set local lock_timeout = '2s'`;
      await tx`set local statement_timeout = '20s'`;
      const [meta] = await tx`select current_database() as db, current_setting('server_version') as version, current_setting('transaction_read_only') as ro`;
      if (meta.ro !== "on") throw new Error("Transaction non read-only : arrêt.");
      const cat = await catalog(tx);

      if (snapshotPath) {
        const objects = digest(cat);
        const label = `${meta.db} @ ${new Date().toISOString()}`;
        await fs.writeFile(snapshotPath, `${JSON.stringify({ label, sha256: crypto.createHash("sha256").update(objects.join("\n")).digest("hex"), objects }, null, 2)}\n`);
        console.log(`Snapshot structurel écrit : ${snapshotPath} (${objects.length} objets, aucune donnée métier).`);
        return;
      }

      console.log(`Base : ${meta.db} · PostgreSQL ${meta.version} · transaction read-only=${meta.ro}\n`);
      const pending = new Set();
      for (const source of list) {
        const found = source.objects.filter((object) => present(cat, object));
        const missing = source.objects.filter((object) => !present(cat, object));
        let status;
        // Ex. 006 : ne change qu'une valeur par défaut, invisible pour cet inventaire.
        if (source.objects.length === 0) status = "INDÉTERMINABLE (aucun objet propre)";
        else if (missing.length === 0) status = "APPLIQUÉE";
        else if (found.length === 0) status = "ABSENTE";
        else status = "PARTIELLE";
        if (missing.length) pending.add(source.id);
        console.log(`${source.id.padEnd(46)} ${status} (${found.length}/${source.objects.length})`);
        for (const object of missing) console.log(`    manquant : ${label(object)}`);
      }
      const checks = await preflight(tx, pending, cat);
      if (checks.length) {
        console.log("\nPré-contrôles des migrations à appliquer (0 attendu, sauf mention) :");
        for (const [id, text, n] of checks) console.log(`  [${id}] ${text} : ${n}`);
      }
      console.log(`\nÀ appliquer : ${pending.size ? [...pending].join(", ") : "aucune"}`);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
