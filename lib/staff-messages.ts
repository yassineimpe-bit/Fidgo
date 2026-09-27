import type { StaffRole } from "@/lib/loyalty";

const STAFF_ERRORS: Record<string, string> = {
  EMAIL_ALREADY_USED: "Cet email est déjà utilisé par un autre accès. Choisis une autre adresse.",
  INVALID_INPUT: "Vérifie l’email et le mot de passe temporaire (8 caractères minimum).",
  FORBIDDEN: "Ton rôle ne permet pas cette action.",
  FORBIDDEN_ROLE: "Ton rôle ne permet pas d’attribuer ce rôle.",
  PROTECTED_ROLE: "Le propriétaire du commerce ne peut pas être modifié ici.",
  CANNOT_MODIFY_SELF: "Tu ne peux pas modifier ton propre accès.",
  NOT_FOUND: "Cet accès n’existe plus. Recharge la page.",
  UNAUTHORIZED: "Session expirée. Reconnecte-toi puis réessaie.",
  RATE_LIMITED: "Trop de tentatives. Réessaie dans quelques instants.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques instants.",
};

/** Message affichable pour une erreur de l'API équipe : jamais le code brut. */
export function staffErrorMessage(code: unknown): string {
  return STAFF_ERRORS[String(code)] || "L’action n’a pas pu être enregistrée. Réessaie dans un instant.";
}

/** Aide courte par rôle, sans recopier la matrice des permissions. */
export const STAFF_ROLE_HELP: Record<Exclude<StaffRole, "OWNER">, string> = {
  MANAGER: "scanne, gère les clients, le programme, les campagnes et l’équipe caisse ; pas la facturation.",
  EMPLOYEE: "utilise uniquement le scanner en caisse.",
  VIEWER: "consulte le tableau de bord et l’historique, sans rien modifier.",
};
