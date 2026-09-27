import { contrastTextColor, normalizeHexColor } from "@/lib/brand-color";

function rgb(hex: string) {
  return `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
}

/**
 * Couleurs du pass Apple Wallet : fond = couleur principale (inchangée), texte
 * noir ou blanc selon le fond, comme sur la carte web. Un texte toujours blanc
 * devenait illisible sur une couleur de marque claire (jaune, pastel…).
 */
export function applePassColors(primaryColor: unknown) {
  const background = normalizeHexColor(primaryColor, "#111827");
  const dark = contrastTextColor(background) === "#000000";
  return {
    backgroundColor: rgb(background),
    foregroundColor: dark ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)",
    labelColor: dark ? "rgb(55, 65, 81)" : "rgb(229, 231, 235)",
  };
}
