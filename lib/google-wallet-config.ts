const MAX_INT64 = 9223372036854775807n;

export function isValidGoogleIssuerId(
  value: string | undefined | null
): boolean {
  if (!value) return false;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return false;

  try {
    const parsed = BigInt(trimmed);
    return parsed > 0n && parsed <= MAX_INT64;
  } catch {
    return false;
  }
}
