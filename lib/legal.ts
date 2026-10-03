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
export const LEGAL_VERSION = "2026-09-27";

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

/** Identité de l'éditeur de Retiko. */
export const LEGAL_ENTITY = {
  companyName: { label: "Nom de l'exploitant", value: "Yassine Roussiere" },
  tradingName: { label: "Nom commercial", value: "RETIKO" },
  legalForm: { label: "Forme juridique", value: "Entrepreneur individuel (micro-entreprise)" },
  shareCapital: { label: "Capital social (si société)", value: "Sans objet (entreprise individuelle)" },
  siren: { label: "SIREN", value: "130 906 787" },
  siret: { label: "SIRET", value: "130 906 787 00010" },
  apeCode: { label: "Code APE", value: "6201Z" },
  registration: { label: "Immatriculation", value: "Registre national des entreprises (RNE) — 01/10/2026" },
  vatNumber: { label: "TVA", value: "TVA non applicable, article 293 B du CGI (franchise en base)" },
  headOffice: { label: "Adresse de l'entreprise", value: "27 rue du Mas Rouge, 19200 Ussel, France" },
  publicationDirector: { label: "Directeur de la publication", value: "Yassine Roussiere" },
  legalRepresentative: { label: "Exploitant", value: "Yassine Roussiere" },
  phone: { label: "Téléphone de contact", value: "07 80 42 62 67" },
  // Adresse de réponse des e-mails transactionnels (EMAIL_REPLY_TO en production).
  contactEmail: { label: "E-mail de contact", value: "contact@retiko.fr" },
  privacyContact: { label: "Contact pour les demandes relatives aux données personnelles", value: null },
  dpo: { label: "Délégué à la protection des données (désigné ou non)", value: null },
  latePaymentRate: { label: "Taux des pénalités de retard (CGV)", value: null },
  jurisdiction: { label: "Tribunal compétent entre professionnels (CGV)", value: null },
} satisfies Record<string, LegalField>;

/**
 * Hébergeur à mentionner (LCEN). Coordonnées issues des mentions officielles
 * de Vercel ; la région d'exécution est conservée séparément car elle décrit
 * l'infrastructure technique, pas l'adresse légale de l'hébergeur.
 */
export const HOSTING_PROVIDER = {
  name: "Vercel Inc.",
  region: "Fonctions exécutées dans la région fra1 (Francfort), selon vercel.json",
  address: {
    label: "Adresse et téléphone de l'hébergeur",
    value: "440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — +1 559 288 7060",
  } as LegalField,
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
