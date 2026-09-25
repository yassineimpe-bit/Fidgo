import { normalizeEmail } from "@/lib/input";

// Mêmes caractères que la recherche téléphone du scanner : une coordonnée
// rectifiée doit rester retrouvable depuis la caisse.
const PHONE = /^[+()\d.\s-]+$/;
const FORBIDDEN_NAME = /[<>\u0000-\u001f\u007f]/u;

export type ContactField = "firstName" | "email" | "phone";

export type CustomerContactUpdate = {
  firstName?: string | null;
  email?: string;
  phone?: string | null;
  withdrawMarketing: boolean;
};

/**
 * Droit de rectification (art. 16) et retrait du consentement (art. 7.3),
 * exercés par le commerce pour son client.
 *
 * Le consentement marketing ne peut qu'être RETIRÉ ici : l'accorder au nom du
 * client créerait une preuve de consentement que le client n'a jamais donnée.
 * Seul le client peut consentir, lors de son inscription.
 */
export function parseCustomerContactUpdate(body: unknown):
  | { ok: true; update: CustomerContactUpdate }
  | { ok: false; error: "INVALID_INPUT" | "CONSENT_REQUIRES_CUSTOMER" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "INVALID_INPUT" };
  const input = body as Record<string, unknown>;
  const update: CustomerContactUpdate = { withdrawMarketing: false };

  if ("firstName" in input) {
    if (typeof input.firstName !== "string") return { ok: false, error: "INVALID_INPUT" };
    const firstName = input.firstName.trim();
    if (firstName.length > 80 || FORBIDDEN_NAME.test(firstName)) return { ok: false, error: "INVALID_INPUT" };
    update.firstName = firstName || null;
  }

  if ("email" in input) {
    // L'e-mail sert à retrouver la carte : il se corrige, il ne s'efface pas
    // (l'effacement complet reste disponible).
    const email = normalizeEmail(input.email);
    if (!email) return { ok: false, error: "INVALID_INPUT" };
    update.email = email;
  }

  if ("phone" in input) {
    if (typeof input.phone !== "string") return { ok: false, error: "INVALID_INPUT" };
    const phone = input.phone.trim();
    if (phone) {
      const digits = phone.replace(/\D/g, "").length;
      if (phone.length > 40 || !PHONE.test(phone) || digits < 6 || digits > 15) return { ok: false, error: "INVALID_INPUT" };
    }
    update.phone = phone || null;
  }

  if ("marketingConsent" in input) {
    if (input.marketingConsent === true) return { ok: false, error: "CONSENT_REQUIRES_CUSTOMER" };
    if (input.marketingConsent !== false) return { ok: false, error: "INVALID_INPUT" };
    update.withdrawMarketing = true;
  }

  const touched = update.firstName !== undefined || update.email !== undefined || update.phone !== undefined || update.withdrawMarketing;
  return touched ? { ok: true, update } : { ok: false, error: "INVALID_INPUT" };
}

/** Champs réellement modifiés, par nom seulement : jamais de valeur dans l'audit. */
export function changedContactFields(
  current: { first_name: unknown; email: unknown; phone: unknown },
  update: CustomerContactUpdate,
): ContactField[] {
  const fields: ContactField[] = [];
  if (update.firstName !== undefined && update.firstName !== (current.first_name ?? null)) fields.push("firstName");
  if (update.email !== undefined && update.email !== String(current.email ?? "").toLowerCase()) fields.push("email");
  if (update.phone !== undefined && update.phone !== (current.phone ?? null)) fields.push("phone");
  return fields;
}
