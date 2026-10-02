const APPLE_IDENTIFIER = /^[A-Za-z0-9._~-]+$/;
const MAX_DEVICE_LIBRARY_IDENTIFIER_LENGTH = 256;
const MAX_PUSH_TOKEN_LENGTH = 512;
const MAX_PASSES_UPDATED_FUTURE_SECONDS = 24 * 60 * 60;

export function validAppleDeviceLibraryIdentifier(value: string) {
  return value.length > 0
    && value.length <= MAX_DEVICE_LIBRARY_IDENTIFIER_LENGTH
    && APPLE_IDENTIFIER.test(value);
}

export function validApplePushToken(value: string) {
  return value.length > 0 && value.length <= MAX_PUSH_TOKEN_LENGTH && APPLE_IDENTIFIER.test(value);
}

export function parsePassesUpdatedSince(value: string | null, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (value === null) return { valid: true as const, value: null };
  if (!/^\d+$/.test(value)) return { valid: false as const, value: null };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > nowSeconds + MAX_PASSES_UPDATED_FUTURE_SECONDS) {
    return { valid: false as const, value: null };
  }
  return { valid: true as const, value: parsed };
}
