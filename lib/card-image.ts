import { createHash } from "node:crypto";
import sharp from "sharp";
import { sniffLogoFormat } from "@/lib/logo-image";

/** Règles du visuel de carte (bannière 2:1). */
export const CARD_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const CARD_IMAGE_MIN_WIDTH = 600;
export const CARD_IMAGE_MIN_HEIGHT = 300;
export const CARD_IMAGE_MAX_SIDE = 8000;
export const CARD_IMAGE_WIDTH = 1200;
export const CARD_IMAGE_HEIGHT = 600;

export { cardImageId, cardImagePath } from "@/lib/card-image-path";

export type CardImageError = "UNSUPPORTED_FORMAT" | "FILE_TOO_LARGE" | "IMAGE_TOO_SMALL" | "IMAGE_TOO_LARGE" | "INVALID_IMAGE";
export type ProcessedCardImage = { content: Buffer; width: number; height: number; sha256: string };

/**
 * Décode, oriente (EXIF), recadre au centre en 2:1 et ré-encode en WebP
 * 1200 × 600 sans métadonnées. Seuls JPEG, PNG et WebP sont acceptés, d'après
 * leurs octets.
 */
export async function processCardImage(bytes: Buffer): Promise<{ ok: true; image: ProcessedCardImage } | { ok: false; error: CardImageError }> {
  if (bytes.length > CARD_IMAGE_MAX_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };
  if (!sniffLogoFormat(bytes)) return { ok: false, error: "UNSUPPORTED_FORMAT" };
  const options = { limitInputPixels: CARD_IMAGE_MAX_SIDE * CARD_IMAGE_MAX_SIDE, failOn: "error" as const };
  let width: number;
  let height: number;
  try {
    const metadata = await sharp(bytes, options).metadata();
    if (!metadata.width || !metadata.height) return { ok: false, error: "INVALID_IMAGE" };
    const swapped = (metadata.orientation ?? 1) >= 5;
    width = swapped ? metadata.height : metadata.width;
    height = swapped ? metadata.width : metadata.height;
  } catch {
    return { ok: false, error: "INVALID_IMAGE" };
  }
  if (width > CARD_IMAGE_MAX_SIDE || height > CARD_IMAGE_MAX_SIDE) return { ok: false, error: "IMAGE_TOO_LARGE" };
  if (width < CARD_IMAGE_MIN_WIDTH || height < CARD_IMAGE_MIN_HEIGHT) return { ok: false, error: "IMAGE_TOO_SMALL" };
  try {
    const content = await sharp(bytes, options)
      .rotate()
      .resize(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      ok: true,
      image: { content, width: CARD_IMAGE_WIDTH, height: CARD_IMAGE_HEIGHT, sha256: createHash("sha256").update(content).digest("hex") },
    };
  } catch {
    return { ok: false, error: "INVALID_IMAGE" };
  }
}
