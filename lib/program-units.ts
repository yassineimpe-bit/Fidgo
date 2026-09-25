import type { LoyaltyMode } from "@/lib/loyalty";

/**
 * Libellé de l'unité du programme (« tampon », « point », ou le choix du
 * commerce : « café », « baguette »…). Deux formes, car le pluriel français
 * n'est pas toujours régulier (« bijou » → « bijoux »).
 */
export const UNIT_LABEL_MAX = 24;
const UNIT_LABEL = /^[\p{L}][\p{L}\p{M} '’-]*$/u;

export type ProgramUnits = { singular: string; plural: string };

export function defaultUnits(mode: LoyaltyMode | string): ProgramUnits {
  return mode === "POINTS" ? { singular: "point", plural: "points" } : { singular: "tampon", plural: "tampons" };
}

/** Libellé nettoyé, `null` s'il est vide, `undefined` s'il est invalide. */
export function normalizeUnitLabel(input: unknown): string | null | undefined {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return undefined;
  const value = input.trim().replace(/\s+/g, " ");
  if (!value) return null;
  if (value.length > UNIT_LABEL_MAX || !UNIT_LABEL.test(value)) return undefined;
  return value.toLocaleLowerCase("fr-FR");
}

/** Unités affichées : libellé du commerce s'il existe, sinon tampon/point. */
export function programUnits(mode: LoyaltyMode | string, singular?: unknown, plural?: unknown): ProgramUnits {
  const custom = typeof singular === "string" && singular.trim() ? singular.trim() : null;
  if (!custom) return defaultUnits(mode);
  const customPlural = typeof plural === "string" && plural.trim() ? plural.trim() : /[sxz]$/i.test(custom) ? custom : `${custom}s`;
  return { singular: custom, plural: customPlural };
}

export function formatUnits(count: number, units: ProgramUnits): string {
  return `${count} ${Math.abs(count) > 1 ? units.plural : units.singular}`;
}

/**
 * Colonnes lues sans dépendre de la migration 026 : `to_jsonb(p)` renvoie
 * NULL pour une colonne absente au lieu d'échouer, le temps que la
 * production soit migrée.
 */
export const UNIT_COLUMNS_SQL = "to_jsonb(p)->>'unit_label' as unit_label, to_jsonb(p)->>'unit_label_plural' as unit_label_plural";
