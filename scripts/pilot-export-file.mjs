// Lecture d'un export /s/stats pour les commandes pilot:* (Node uniquement :
// lib/pilot-field-report.mjs est aussi chargé par le navigateur).
import { readFileSync, statSync } from "node:fs";
import { parseScanMetricsExport } from "../lib/pilot-field-report.mjs";

const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

export function readScanMetricsExportFile(device, file) {
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return { errors: [`fichier introuvable : ${file}`] };
  }
  if (!stats.isFile()) return { errors: [`${file} n'est pas un fichier`] };
  if (stats.size > MAX_EXPORT_BYTES) return { errors: [`${file} dépasse ${MAX_EXPORT_BYTES} octets : ce n'est pas un export /s/stats`] };
  const result = parseScanMetricsExport(readFileSync(file, "utf8"), { expectedDevice: device });
  return result.ok ? { value: result.value } : { errors: result.errors };
}
