import { contrastTextColor, isValidHexColor, normalizeHexColor } from "@/lib/brand-color";

/**
 * Apparence de la carte fidélité : couleur principale, couleur secondaire
 * facultative (accent, fin du dégradé) et style de fond. Partagée par la
 * carte client, l'aperçu des réglages, l'onboarding et l'affiche.
 */
export type CardBackground = "solid" | "gradient" | "image";
export const CARD_BACKGROUNDS: readonly CardBackground[] = ["solid", "gradient", "image"];

/** `cardImageUrl` : chemin relatif /api/card-images/<id> du visuel, s'il existe. */
export type CardDesignInput = { primaryColor: unknown; secondaryColor?: unknown; cardBackground?: unknown; cardImageUrl?: string | null };
export type CardDesign = { background: string; textColor: "#000000" | "#ffffff"; accentColor: string; primary: string; secondary: string | null };

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
    // Voile sombre sur la photo : le texte blanc reste lisible quel que soit le visuel.
    return {
      background: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("${image}") center / cover no-repeat, ${primary}`,
      textColor: "#ffffff",
      accentColor: "#ffffff",
      primary,
      secondary,
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
  };
}
