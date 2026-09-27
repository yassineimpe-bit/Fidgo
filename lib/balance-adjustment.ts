import { formatUnits, type ProgramUnits } from "@/lib/program-units";

/** Limite du motif imposée par /api/customers/[id]/adjust (boundedText 240). */
export const ADJUST_REASON_MAX = 240;
/** Borne haute du solde acceptée par l'API. */
export const ADJUST_BALANCE_MAX = 1_000_000;

/**
 * Variation saisie par l'opérateur : entier signé non nul (« +2 », « -1 »,
 * « 3 »). Le signe moins typographique (−) est accepté. Null sinon.
 */
export function parseVariation(input: string): number | null {
  const normalized = input.replace(/\s+/g, "").replace(/[−–]/g, "-");
  if (!/^[+-]?\d{1,7}$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value !== 0 ? value : null;
}

export type AdjustmentCheck =
  | { ok: true; oldBalance: number; variation: number; newBalance: number }
  | { ok: false; error: "VARIATION" | "NEGATIVE" | "TOO_HIGH" | "REASON" };

export function checkAdjustment(balance: number, variationInput: string, reason: string): AdjustmentCheck {
  const variation = parseVariation(variationInput);
  if (variation === null) return { ok: false, error: "VARIATION" };
  const newBalance = balance + variation;
  if (newBalance < 0) return { ok: false, error: "NEGATIVE" };
  if (newBalance > ADJUST_BALANCE_MAX) return { ok: false, error: "TOO_HIGH" };
  if (!reason.trim()) return { ok: false, error: "REASON" };
  return { ok: true, oldBalance: balance, variation, newBalance };
}

export const ADJUSTMENT_ERRORS: Record<Exclude<AdjustmentCheck, { ok: true }>["error"], string> = {
  VARIATION: "Saisis une variation entière non nulle, par exemple +2 ou -1.",
  NEGATIVE: "Le nouveau solde ne peut pas être négatif.",
  TOO_HIGH: "Le nouveau solde dépasse la limite autorisée.",
  REASON: "Le motif est obligatoire.",
};

/** Variation lisible sans la couleur : signe + texte (« +2 tampons, ajout »). */
export function describeVariation(variation: number, units: ProgramUnits): string {
  const amount = formatUnits(Math.abs(variation), units);
  return variation > 0 ? `+${amount} (ajout)` : `−${amount} (retrait)`;
}

/** Message affiché pour chaque réponse de l'API d'ajustement. */
export function adjustmentErrorMessage(status: number, code: string | undefined): string {
  if (code === "BALANCE_CHANGED") return "Le solde a changé depuis l’ouverture de la fiche. Vérifie la variation puis confirme à nouveau.";
  if (code === "NO_CHANGE") return "Le solde est déjà à cette valeur : aucun ajustement n’a été enregistré.";
  if (code === "CARD_NOT_FOUND" || status === 404) return "Carte introuvable ou inactive : aucun ajustement n’a été enregistré.";
  if (status === 401) return "Session expirée. Reconnecte-toi puis recommence l’ajustement.";
  if (status === 403) return "Ce compte ne peut pas ajuster les soldes.";
  if (status === 429) return "Trop d’ajustements en peu de temps. Réessaie dans une minute.";
  if (status === 400) return "Ajustement refusé : vérifie la variation et le motif (240 caractères maximum).";
  return "L’ajustement n’a pas pu être enregistré. Réessaie dans un instant.";
}

export const ADJUSTMENT_NETWORK_MESSAGE = "L’ajustement n’a pas pu être confirmé. Réessayez pour vérifier sans risquer de dupliquer l’action.";
export const ADJUSTMENT_SUCCESS_MESSAGE = "Solde ajusté. L’opération a été ajoutée à l’historique.";
