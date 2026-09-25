// Preuve serveur du gate terrain : rapproche les actions réussies des exports
// /s/stats et le ledger du commerce de test. Aucune écriture possible : toutes
// les requêtes sont des SELECT exécutés dans une transaction BEGIN READ ONLY,
// et DATABASE_URL ne vient que de l'environnement (jamais du dépôt ni d'un
// argument). Utilisable sur la production ou sur une restauration de backup.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { PILOT_GATE } from "../lib/pilot-gate.mjs";
import {
  LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES,
  evaluateLedgerAudit,
  planLedgerAudit,
  renderLedgerAuditMarkdown,
  renderLedgerAuditText,
} from "../lib/pilot-ledger-audit.mjs";
import { readScanMetricsExportFile } from "./pilot-export-file.mjs";

const USAGE = `Usage :
  DATABASE_URL=... npm run pilot:ledger-audit -- --establishment <slug> \\
    --iphone <iphone.json> --android <android.json> [--margin-minutes ${LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES}] \\
    [--markdown-output <rapprochement.md>] [--json-output <rapprochement.json>]

Rapproche, en lecture seule (BEGIN READ ONLY), les actions réussies des exports
/s/stats et les transactions du commerce de test sur les mêmes fenêtres horaires.
DATABASE_URL est lu uniquement depuis l'environnement.

Codes de sortie :
  0  cohérent : une transaction par action réussie, aucune écriture inattendue
  1  à analyser : écart entre téléphones et ledger
  2  arguments, exports ou base inaccessibles`;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readLedger(databaseUrl, slug, plan) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5, onnotice: () => undefined });
  try {
    return await sql.begin("read only", async (tx) => {
      // Garde-fou d'exécution : aucune requête métier tant que PostgreSQL ne
      // confirme pas lui-même que la transaction refusera toute écriture.
      const [mode] = await tx`show transaction_read_only`;
      if (mode.transaction_read_only !== "on") throw new Error("READ_ONLY_NOT_ENFORCED");
      await tx`set local statement_timeout = '20s'`;
      const [establishment] = await tx`select id from establishments where slug = ${slug}`;
      if (!establishment) return null;

      const windows = [];
      for (const window of plan) {
        const [row] = await tx`
          select
            count(*) filter (where type = 'earn')::int as earn,
            count(*) filter (where type = 'redeem')::int as redeem,
            count(*) filter (where type = 'adjust')::int as adjust,
            count(*) filter (where type = 'reversal')::int as reversal,
            count(*) filter (where type = 'earn' and metadata->>'overrideReason' is not null)::int as overrides,
            count(distinct card_id)::int as cards
          from transactions
          where establishment_id = ${establishment.id}
            and created_at >= ${window.from}
            and created_at <= ${window.to}
        `;
        windows.push({
          earn: Number(row.earn),
          redeem: Number(row.redeem),
          adjust: Number(row.adjust),
          reversal: Number(row.reversal),
          overrides: Number(row.overrides),
          cards: Number(row.cards),
        });
      }

      const [cards] = await tx`
        select
          count(*)::int as total,
          count(*) filter (where c.balance < 0)::int as negative_balances,
          count(*) filter (where coalesce(x.ledger_balance, 0) <> c.balance)::int as ledger_mismatches
        from cards c
        left join (
          select card_id, sum(delta)::int as ledger_balance
          from transactions
          where establishment_id = ${establishment.id}
          group by card_id
        ) x on x.card_id = c.id
        where c.establishment_id = ${establishment.id}
      `;
      return {
        windows,
        cards: {
          total: Number(cards.total),
          negativeBalances: Number(cards.negative_balances),
          ledgerMismatches: Number(cards.ledger_mismatches),
        },
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(argv) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        establishment: { type: "string" },
        iphone: { type: "string" },
        android: { type: "string" },
        "margin-minutes": { type: "string" },
        "markdown-output": { type: "string" },
        "json-output": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`pilot:ledger-audit : ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const slug = options.establishment;
  if (!slug || !SLUG.test(slug)) {
    console.error(`pilot:ledger-audit : --establishment <slug> requis (slug du commerce de test, visible dans le lien /j/<slug>).\n\n${USAGE}`);
    return 2;
  }
  const marginText = options["margin-minutes"] ?? String(LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES);
  if (!/^\d{1,3}$/.test(marginText)) {
    console.error("pilot:ledger-audit : --margin-minutes attend un nombre entier de minutes.");
    return 2;
  }
  const marginMinutes = Number(marginText);

  const inputs = PILOT_GATE.devices.filter((device) => options[device]);
  if (inputs.length === 0) {
    console.error(`pilot:ledger-audit : fournir au moins un export (--iphone et/ou --android).\n\n${USAGE}`);
    return 2;
  }
  const inputPaths = inputs.map((device) => path.resolve(options[device]));
  const outputs = [["markdown-output", options["markdown-output"]], ["json-output", options["json-output"]]].filter(([, file]) => file);
  for (const [flag, file] of outputs) {
    if (inputPaths.includes(path.resolve(file))) {
      console.error(`pilot:ledger-audit : --${flag} ne peut pas écraser un export d'entrée (${file}).`);
      return 2;
    }
  }
  if (outputs.length === 2 && path.resolve(outputs[0][1]) === path.resolve(outputs[1][1])) {
    console.error("pilot:ledger-audit : --markdown-output et --json-output doivent désigner deux fichiers distincts.");
    return 2;
  }

  const exports = {};
  let rejected = false;
  for (const device of inputs) {
    const result = readScanMetricsExportFile(device, options[device]);
    if (result.errors) {
      rejected = true;
      console.error(`pilot:ledger-audit : export --${device} rejeté (${options[device]}) :`);
      for (const error of result.errors) console.error(`  - ${error}`);
    } else {
      exports[device] = result.value;
    }
  }
  if (rejected) return 2;

  let plan;
  try {
    plan = planLedgerAudit(exports, { marginMinutes });
  } catch (error) {
    console.error(`pilot:ledger-audit : ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (plan.length === 0) {
    console.error("pilot:ledger-audit : aucune action (crédit ou récompense) dans les exports : rien à rapprocher.");
    return 2;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("pilot:ledger-audit : DATABASE_URL requis dans l'environnement (jamais dans le dépôt ni en argument).");
    return 2;
  }

  let observations;
  try {
    observations = await readLedger(databaseUrl, slug, plan);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? ` [${error.code}]` : "";
    console.error(`pilot:ledger-audit : lecture de la base impossible${code} : ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (!observations) {
    console.error(`pilot:ledger-audit : aucun commerce avec le slug « ${slug} ».`);
    return 2;
  }

  const audit = evaluateLedgerAudit({ establishment: slug, plan, observations, marginMinutes });
  process.stdout.write(renderLedgerAuditText(audit));
  for (const [flag, file] of outputs) {
    const content = flag === "markdown-output" ? renderLedgerAuditMarkdown(audit) : `${JSON.stringify(audit, null, 2)}\n`;
    try {
      writeFileSync(file, content, "utf8");
    } catch (error) {
      console.error(`pilot:ledger-audit : écriture impossible de ${file} (${error instanceof Error ? error.message : String(error)}).`);
      return 2;
    }
    console.log(`Rapprochement ${flag === "markdown-output" ? "Markdown" : "JSON"} écrit : ${file}`);
  }
  return audit.verdict.status === "CONSISTENT" ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
