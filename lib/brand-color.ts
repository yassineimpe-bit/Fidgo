const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Valide strictement `#RRGGBB` ou retombe sur une couleur de secours connue. */
export function normalizeHexColor(value: unknown, fallback = "#111111"): string {
  return isValidHexColor(value) ? (value as string).toLowerCase() : fallback;
}

/**
 * Choisit noir ou blanc pour rester lisible sur `background`, quelle que soit
 * la couleur de marque saisie par le commerçant (ex. jaune clair, blanc cassé).
 * Formule de luminance perçue (YIQ, W3C AERT) : simple, robuste, sans
 * dépendance, suffisante pour éviter un texte blanc sur fond blanc — ce n'est
 * pas un calcul de ratio de contraste WCAG certifié.
 */
export function contrastTextColor(background: unknown, fallback = "#111111"): "#000000" | "#ffffff" {
  const hex = normalizeHexColor(background, fallback);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const perceivedBrightness = (r * 299 + g * 587 + b * 114) / 1000;
  return perceivedBrightness >= 150 ? "#000000" : "#ffffff";
}
