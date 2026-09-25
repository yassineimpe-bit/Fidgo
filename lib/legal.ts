// Source unique des informations juridiques affichées par Retiko.
//
// Rien ici n'est inventé : un champ `null` signifie que l'information n'a pas
// encore été fournie par l'exploitant. Il est alors rendu « [À COMPLÉTER] »
// dans les pages publiques et listé par `missingLegalFields()`, pour que la
// liste des informations à renseigner reste en un seul endroit.

export const TO_COMPLETE = "[À COMPLÉTER]";

/**
 * Version des CGU/CGV présentées au signup. Toute modification substantielle
 * de ces deux documents impose une nouvelle version : l'acceptation enregistrée
 * désigne exactement la version affichée au moment de l'inscription.
 */
export const LEGAL_VERSION = "2026-09-25";

export const LEGAL_LINKS = {
  cgu: "/legal/cgu",
  cgv: "/legal/cgv",
  privacy: "/legal/confidentialite",
  cookies: "/legal/cookies",
  notice: "/legal/mentions-legales",
} as const;

export const ACCEPTED_DOCUMENTS = ["CGU", "CGV"] as const;
export type AcceptedDocument = (typeof ACCEPTED_DOCUMENTS)[number];

type LegalField = { label: string; value: string | null };

/** Identité de l'éditeur de Retiko. À renseigner avant toute facturation. */
export const LEGAL_ENTITY = {
  companyName: { label: "Raison sociale ou nom de l'exploitant", value: null },
  legalForm: { label: "Forme juridique", value: null },
  shareCapital: { label: "Capital social (si société)", value: null },
  siren: { label: "SIREN / SIRET", value: null },
  registration: { label: "Immatriculation (RCS / RNE selon le statut)", value: null },
  vatNumber: { label: "Numéro de TVA intracommunautaire (si applicable)", value: null },
  headOffice: { label: "Adresse du siège", value: null },
  publicationDirector: { label: "Directeur de la publication", value: null },
  legalRepresentative: { label: "Représentant légal", value: null },
  phone: { label: "Téléphone de contact", value: null },
  // Adresse de réponse des e-mails transactionnels (EMAIL_REPLY_TO en production).
  contactEmail: { label: "E-mail de contact", value: "contact@retiko.fr" },
  privacyContact: { label: "Contact pour les demandes relatives aux données personnelles", value: null },
  dpo: { label: "Délégué à la protection des données (désigné ou non)", value: null },
  latePaymentRate: { label: "Taux des pénalités de retard (CGV)", value: null },
  jurisdiction: { label: "Tribunal compétent entre professionnels (CGV)", value: null },
} satisfies Record<string, LegalField>;

/**
 * Hébergeur à mentionner (LCEN). Le nom est vérifiable dans la configuration
 * (vercel.json) ; ses coordonnées légales doivent être recopiées depuis ses
 * propres mentions, pas reconstituées de mémoire.
 */
export const HOSTING_PROVIDER = {
  name: "Vercel Inc.",
  region: "Fonctions exécutées dans la région fra1 (Francfort), selon vercel.json",
  address: { label: "Adresse et téléphone de l'hébergeur", value: null } as LegalField,
};

export function legalValue(field: LegalField) {
  return field.value ?? TO_COMPLETE;
}

export function missingLegalFields(): string[] {
  const fields: LegalField[] = [...Object.values(LEGAL_ENTITY), HOSTING_PROVIDER.address];
  return fields.filter((field) => !field.value).map((field) => field.label);
}

/**
 * Acceptation contractuelle au signup : case obligatoire ET version identique
 * à celle affichée. Un client qui n'a pas rechargé la page après un changement
 * de version doit relire les nouveaux documents.
 */
export function hasAcceptedCurrentTerms(body: { legalAccepted?: unknown; legalVersion?: unknown }) {
  return body.legalAccepted === true && body.legalVersion === LEGAL_VERSION;
}

/** Consentement marketing : seulement un `true` explicite, jamais par défaut. */
export function marketingOptIn(body: { marketingOptIn?: unknown }) {
  return body.marketingOptIn === true;
}
