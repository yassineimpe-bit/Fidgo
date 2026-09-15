export function normalizeTokenVersion(value: unknown): number | null {
  const version = typeof value === "number" ? value : Number(value);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

export function sessionVersionMatches(claimVersion: unknown, currentVersion: unknown) {
  const claim = normalizeTokenVersion(claimVersion);
  const current = normalizeTokenVersion(currentVersion);
  return claim !== null && current !== null && claim === current;
}
