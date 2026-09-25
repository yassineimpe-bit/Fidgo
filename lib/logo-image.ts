import { createHash } from "node:crypto";
import sharp from "sharp";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE, LOGO_MIN_SIDE, LOGO_OUTPUT_SIDE } from "@/lib/logo";

export type LogoFormat = "jpeg" | "png" | "webp";
export type LogoCrop = { x: number; y: number; size: number };
export type LogoError = "UNSUPPORTED_FORMAT" | "FILE_TOO_LARGE" | "IMAGE_TOO_SMALL" | "IMAGE_TOO_LARGE" | "INVALID_CROP" | "INVALID_IMAGE";

/**
 * Format réel d'après les octets de signature. Ni l'extension ni le
 * Content-Type envoyés par le navigateur ne sont pris en compte ; SVG, GIF,
 * HEIC et tout le reste sont refusés.
 */
export function sniffLogoFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, index) => bytes[index] === byte)) return "png";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Cadrage carré demandé (pixels de l'image orientée), ou null s'il est absent. */
export function parseLogoCrop(input: { x?: unknown; y?: unknown; size?: unknown }): LogoCrop | null | "invalid" {
  const raw = [input.x, input.y, input.size];
  if (raw.every((value) => value === null || value === undefined || value === "")) return null;
  const [x, y, size] = raw.map((value) => Number(value));
  if (![x, y, size].every((value) => Number.isInteger(value))) return "invalid";
  return { x, y, size };
}

/** Cadrage effectif : celui demandé s'il tient dans l'image, sinon le carré central. */
export function resolveLogoCrop(width: number, height: number, crop: LogoCrop | null): LogoCrop | null {
  if (!crop) {
    const size = Math.min(width, height);
    return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
  }
  const { x, y, size } = crop;
  if (size < LOGO_MIN_SIDE || x < 0 || y < 0 || x + size > width || y + size > height) return null;
  return crop;
}

export type ProcessedLogo = { content: Buffer; width: number; height: number; sha256: string };

/**
 * Décode, oriente (EXIF), recadre, redimensionne et ré-encode en WebP.
 * sharp n'écrit aucune métadonnée par défaut : EXIF, GPS et profils de
 * l'appareil disparaissent.
 */
export async function processLogo(bytes: Buffer, crop: LogoCrop | null): Promise<{ ok: true; logo: ProcessedLogo } | { ok: false; error: LogoError }> {
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };
  if (!sniffLogoFormat(bytes)) return { ok: false, error: "UNSUPPORTED_FORMAT" };
  const options = { limitInputPixels: LOGO_MAX_SIDE * LOGO_MAX_SIDE, failOn: "error" as const };
  let width: number;
  let height: number;
  try {
    const metadata = await sharp(bytes, options).metadata();
    if (!metadata.width || !metadata.height) return { ok: false, error: "INVALID_IMAGE" };
    // Orientations EXIF 5 à 8 : l'image affichée est tournée d'un quart de tour.
    const swapped = (metadata.orientation ?? 1) >= 5;
    width = swapped ? metadata.height : metadata.width;
    height = swapped ? metadata.width : metadata.height;
  } catch {
    return { ok: false, error: "INVALID_IMAGE" };
  }
  if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) return { ok: false, error: "IMAGE_TOO_LARGE" };
  if (width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE) return { ok: false, error: "IMAGE_TOO_SMALL" };
  const area = resolveLogoCrop(width, height, crop);
  if (!area) return { ok: false, error: "INVALID_CROP" };
  try {
    const content = await sharp(bytes, options)
      .rotate()
      .extract({ left: area.x, top: area.y, width: area.size, height: area.size })
      .resize(LOGO_OUTPUT_SIDE, LOGO_OUTPUT_SIDE, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    return {
      ok: true,
      logo: { content, width: LOGO_OUTPUT_SIDE, height: LOGO_OUTPUT_SIDE, sha256: createHash("sha256").update(content).digest("hex") },
    };
  } catch {
    return { ok: false, error: "INVALID_IMAGE" };
  }
}
