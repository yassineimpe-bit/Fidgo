// Rapport combiné du gate terrain physique (15 scans iPhone + 15 scans
// Android). Lecture seule : ne lit que les deux exports /s/stats, n'accède à
// aucune base et ne complète aucune mesure. Le calcul vit dans
// lib/pilot-field-report.mjs, partagé avec /s/stats.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildPilotFieldReport,
  parseScanMetricsExport,
  renderPilotFieldReportMarkdown,
  renderPilotFieldReportText,
} from "../lib/pilot-field-report.mjs";
import { PILOT_GATE } from "../lib/pilot-gate.mjs";

const USAGE = `Usage :
  npm run pilot:field-report -- --iphone <iphone.json> --android <android.json> \\
    [--markdown-output <rapport.md>] [--json-output <rapport.json>]

Calcule p50/p90/p95/max de « QR détecté → action fidélité validée » (nearest-rank)
à partir des exports « Exporter les mesures » de /s/stats sur chaque téléphone scanner.

Codes de sortie :
  0  GO performance (échantillon complet 15/15, p95 conforme aux seuils candidats)
  1  pas de GO : incomplet, non conforme, NO-GO ou décision produit requise
  2  arguments, fichiers ou exports invalides`;

const MAX_INPUT_BYTES = 5 * 1024 * 1024;

function readExport(device, file) {
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return { errors: [`fichier introuvable : ${file}`] };
  }
  if (!stats.isFile()) return { errors: [`${file} n'est pas un fichier`] };
  if (stats.size > MAX_INPUT_BYTES) return { errors: [`${file} dépasse ${MAX_INPUT_BYTES} octets : ce n'est pas un export /s/stats`] };
  const result = parseScanMetricsExport(readFileSync(file, "utf8"), { expectedDevice: device });
  return result.ok ? { value: result.value } : { errors: result.errors };
}

function main(argv) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        iphone: { type: "string" },
        android: { type: "string" },
        "markdown-output": { type: "string" },
        "json-output": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`pilot:field-report : ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const inputs = PILOT_GATE.devices.filter((device) => options[device]);
  if (inputs.length === 0) {
    console.error(`pilot:field-report : fournir au moins un export (--iphone et/ou --android).\n\n${USAGE}`);
    return 2;
  }

  const inputPaths = inputs.map((device) => path.resolve(options[device]));
  const outputs = [["markdown-output", options["markdown-output"]], ["json-output", options["json-output"]]].filter(([, file]) => file);
  for (const [flag, file] of outputs) {
    // Un rapport ne doit jamais remplacer la preuve brute dont il est issu.
    if (inputPaths.includes(path.resolve(file))) {
      console.error(`pilot:field-report : --${flag} ne peut pas écraser un export d'entrée (${file}).`);
      return 2;
    }
  }
  if (outputs.length === 2 && path.resolve(outputs[0][1]) === path.resolve(outputs[1][1])) {
    console.error("pilot:field-report : --markdown-output et --json-output doivent désigner deux fichiers distincts.");
    return 2;
  }

  const exports = {};
  const files = {};
  let rejected = false;
  for (const device of inputs) {
    const result = readExport(device, options[device]);
    if (result.errors) {
      rejected = true;
      console.error(`pilot:field-report : export --${device} rejeté (${options[device]}) :`);
      for (const error of result.errors) console.error(`  - ${error}`);
      continue;
    }
    exports[device] = result.value;
    // Nom de fichier seul : un chemin complet peut contenir le nom de session.
    files[device] = path.basename(options[device]);
  }
  if (rejected) {
    console.error("\nAucun rapport produit : ré-exporter les mesures depuis /s/stats sans modifier le fichier.");
    return 2;
  }

  const report = buildPilotFieldReport({ exports, files });
  process.stdout.write(renderPilotFieldReportText(report));

  for (const [flag, file] of outputs) {
    const content = flag === "markdown-output"
      ? renderPilotFieldReportMarkdown(report)
      : `${JSON.stringify(report, null, 2)}\n`;
    try {
      writeFileSync(file, content, "utf8");
    } catch (error) {
      console.error(`pilot:field-report : écriture impossible de ${file} (${error instanceof Error ? error.message : String(error)}).`);
      return 2;
    }
    console.log(`Rapport ${flag === "markdown-output" ? "Markdown" : "JSON"} écrit : ${file}`);
  }

  return report.verdict.status === "GO" ? 0 : 1;
}

// exitCode plutôt que process.exit() : sur macOS, stdout redirigé est
// asynchrone et une sortie brutale tronquerait le rapport.
process.exitCode = main(process.argv.slice(2));
