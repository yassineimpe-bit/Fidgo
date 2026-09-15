export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function isEmail(input: unknown): boolean {
  return normalizeEmail(input) !== null;
}

export function boundedInt(input: unknown,{ min, max, fallback }: { min: number; max: number; fallback?: number }): number | null {
  if (input === "" || input === null || input === undefined) return fallback ?? null;
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

export function boundedNumber(input: unknown,{ min, max, fallback }: { min: number; max: number; fallback?: number }): number | null {
  if (input === "" || input === null || input === undefined) return fallback ?? null;
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

export function boundedText(input: unknown, max: number, fallback = ""): string {
  if (typeof input !== "string") return fallback;
  return input.trim().slice(0, max);
}
