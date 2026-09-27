import { contrastRatio, contrastTextColor, isValidHexColor, normalizeHexColor } from "@/lib/brand-color";

/**
 * Apparence de la carte fidélité : couleur principale, couleur secondaire
 * facultative (accent, fin du dégradé) et style de fond. Partagée par la
 * carte client, l'aperçu des réglages, l'onboarding et l'affiche.
 */
export type CardBackground = "solid" | "gradient" | "image";
export const CARD_BACKGROUNDS: readonly CardBackground[] = ["solid", "gradient", "image"];

/**
 * `cardImageUrl` : chemin relatif /api/card-images/<id> du visuel, s'il existe.
 * `cardImageOverlay` : voile sombre sur le visuel, choisi par le commerçant
 * (activé si la valeur est absente, ce qui garde le rendu des cartes existantes).
 */
export type CardDesignInput = { primaryColor: unknown; secondaryColor?: unknown; cardBackground?: unknown; cardImageUrl?: string | null; cardImageOverlay?: unknown };
export type CardDesign = { background: string; textColor: "#000000" | "#ffffff"; accentColor: string; primary: string; secondary: string | null; textShadow: string | null };

/** Lecture tolérante de la colonne card_image_overlay (booléen, texte via to_jsonb, ou absente). */
export function readCardImageOverlay(value: unknown): boolean {
  return !(value === false || value === "false");
}

export function isCardBackground(value: unknown): value is CardBackground {
  return value === "solid" || value === "gradient" || value === "image";
}

const CARD_IMAGE_URL = /^\/api\/card-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mix(a: string, b: string) {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2].map((index) => Math.round((channel(a, index) + channel(b, index)) / 2).toString(16).padStart(2, "0")).join("")}`;
}

export function cardDesign(input: CardDesignInput): CardDesign {
  const primary = normalizeHexColor(input.primaryColor, "#111111");
  const secondary = isValidHexColor(input.secondaryColor) ? (input.secondaryColor as string).toLowerCase() : null;
  const image = input.cardBackground === "image" && typeof input.cardImageUrl === "string" && CARD_IMAGE_URL.test(input.cardImageUrl)
    ? input.cardImageUrl
    : null;
  if (image) {
    const overlay = readCardImageOverlay(input.cardImageOverlay);
    // Avec le voile choisi par le commerçant, le texte blanc reste lisible quel que
    // soit le visuel ; sans voile, une ombre portée aide sans masquer la photo.
    return {
      background: overlay
        ? `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("${image}") center / cover no-repeat, ${primary}`
        : `url("${image}") center / cover no-repeat, ${primary}`,
      textColor: "#ffffff",
      accentColor: "#ffffff",
      primary,
      secondary,
      textShadow: overlay ? null : "0 1px 3px rgba(0, 0, 0, 0.7)",
    };
  }
  const gradient = input.cardBackground === "gradient" && secondary !== null;
  // Texte lisible sur les deux extrémités : on se règle sur la teinte moyenne du dégradé.
  const textColor = contrastTextColor(gradient ? mix(primary, secondary) : primary);
  // L'accent (barre de progression) n'utilise la couleur secondaire que si elle
  // reste lisible sur le fond ; sinon il retombe sur la couleur du texte.
  const accentColor = !gradient && secondary && contrastTextColor(secondary) !== textColor ? secondary : textColor;
  return {
    background: gradient ? `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)` : primary,
    textColor,
    accentColor,
    primary,
    secondary,
    textShadow: null,
  };
}

/** Seuil WCAG AA pour le texte courant. */
export const CARD_TEXT_CONTRAST_MIN = 4.5;

function ratioLabel(ratio: number) {
  return `${ratio.toFixed(1).replace(".", ",")}:1`;
}

/**
 * Avertissements de lisibilité, affichés en temps réel dans les réglages.
 * Ils n'altèrent jamais les couleurs choisies par le commerçant.
 */
export function cardContrastWarnings(input: CardDesignInput): string[] {
  const design = cardDesign(input);
  const warnings: string[] = [];
  if (design.background.includes("url(")) {
    if (!readCardImageOverlay(input.cardImageOverlay)) {
      warnings.push("Sans voile, le texte blanc peut devenir difficile à lire sur une photo claire : vérifie l’aperçu ou active le voile.");
    }
    return warnings;
  }
  const gradient = design.background.startsWith("linear-gradient") && design.secondary;
  if (gradient) {
    const weakest = Math.min(contrastRatio(design.textColor, design.primary), contrastRatio(design.textColor, design.secondary!));
    if (weakest < CARD_TEXT_CONTRAST_MIN) {
      warnings.push(`Contraste faible sur une partie du dégradé (${ratioLabel(weakest)}, recommandé : 4,5:1). Rapproche la luminosité des deux couleurs ou choisis la couleur unie.`);
    }
  } else {
    const ratio = contrastRatio(design.textColor, design.primary);
    if (ratio < CARD_TEXT_CONTRAST_MIN) {
      warnings.push(`Contraste faible entre le texte ${design.textColor === "#ffffff" ? "blanc" : "noir"} et la couleur principale (${ratioLabel(ratio)}, recommandé : 4,5:1). ${design.textColor === "#ffffff" ? "Une teinte plus foncée" : "Une teinte plus claire"} sera plus lisible.`);
    }
    if (design.secondary && design.accentColor !== design.secondary) {
      warnings.push("La couleur secondaire est trop proche du fond pour rester visible : la barre de progression utilise la couleur du texte.");
    }
  }
  return warnings;
}
