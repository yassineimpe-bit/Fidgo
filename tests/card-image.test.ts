import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CARD_IMAGE_MAX_BYTES, cardImageId, cardImagePath, processCardImage } from "@/lib/card-image";

function image(width: number, height: number, format: "png" | "jpeg" | "webp" = "jpeg") {
  return sharp({ create: { width, height, channels: 3, background: "#b3261e" } })[format]().toBuffer();
}

describe("visuel de carte", () => {
  it("recadre au centre en 2:1, WebP 1200 × 600 sans métadonnées", async () => {
    const source = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#123456" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret-owner" } } })
      .jpeg()
      .toBuffer();
    const result = await processCardImage(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metadata = await sharp(result.image.content).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 1200, height: 600 });
    expect(metadata.exif).toBeUndefined();
    expect(result.image.content.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("refuse SVG, fichiers trop lourds, trop petits ou illisibles", async () => {
    expect(await processCardImage(Buffer.from("<svg/>"))).toEqual({ ok: false, error: "UNSUPPORTED_FORMAT" });
    expect(await processCardImage(Buffer.alloc(CARD_IMAGE_MAX_BYTES + 1))).toEqual({ ok: false, error: "FILE_TOO_LARGE" });
    expect(await processCardImage(await image(500, 400))).toEqual({ ok: false, error: "IMAGE_TOO_SMALL" });
    expect(await processCardImage((await image(800, 400, "png")).subarray(0, 60))).toEqual({ ok: false, error: "INVALID_IMAGE" });
  });

  it("n'accepte que /api/card-images/<uuid>", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(cardImageId(cardImagePath(id))).toBe(id);
    expect(cardImageId(`/api/card-images/${id}/../x`)).toBeNull();
    expect(cardImageId(`https://evil.example/api/card-images/${id}`)).toBeNull();
  });
});
