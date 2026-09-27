/**
 * Code à 6 chiffres collé depuis une application d'authentification : certaines
 * le copient avec une espace ou un tiret (« 123 456 »). Sans nettoyage, la
 * limite de 6 caractères du champ tronquerait le collage en « 123 45 ».
 * Renvoie null si le texte n'est pas un code TOTP (le collage reste alors normal).
 */
export function pastedTotpCode(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[\d\s-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

/** Champ acceptant un code TOTP ou un code de secours : les espaces d'un code TOTP ne changent pas sa nature. */
export function secondFactorPayload(value: string): { code: string } | { recoveryCode: string } {
  const trimmed = value.trim();
  const totp = pastedTotpCode(trimmed);
  return totp ? { code: totp } : { recoveryCode: trimmed };
}
