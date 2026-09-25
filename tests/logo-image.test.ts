import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, logoPath, uploadedLogoId } from "@/lib/logo";
import { parseLogoCrop, processLogo, resolveLogoCrop, sniffLogoFormat } from "@/lib/logo-image";

function image(width: number, height: number, format: "png" | "jpeg" | "webp" = "png") {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } })[format]().toBuffer();
}

describe("logo : format réel", () => {
  it("reconnaît JPEG, PNG et WebP par leurs octets, jamais SVG ni texte", async () => {
    expect(sniffLogoFormat(await image(10, 10, "png"))).toBe("png");
    expect(sniffLogoFormat(await image(10, 10, "jpeg"))).toBe("jpeg");
    expect(sniffLogoFormat(await image(10, 10, "webp"))).toBe("webp");
    expect(sniffLogoFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffLogoFormat(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffLogoFormat(Buffer.from("RIFF1234WAVE"))).toBeNull();
    expect(sniffLogoFormat(new Uint8Array())).toBeNull();
  });
});

describe("logo : cadrage", () => {
  it("lit un cadrage entier ou l'absence de cadrage", () => {
    expect(parseLogoCrop({})).toBeNull();
    expect(parseLogoCrop({ x: "", y: "", size: "" })).toBeNull();
    expect(parseLogoCrop({ x: "10", y: "20", size: "300" })).toEqual({ x: 10, y: 20, size: 300 });
    expect(parseLogoCrop({ x: "1.5", y: "0", size: "200" })).toBe("invalid");
    expect(parseLogoCrop({ x: "abc", y: "0", size: "200" })).toBe("invalid");
  });

  it("refuse un cadrage hors de l'image ou trop petit, centre par défaut", () => {
    expect(resolveLogoCrop(800, 400, null)).toEqual({ x: 200, y: 0, size: 400 });
    expect(resolveLogoCrop(800, 400, { x: 500, y: 0, size: 300 })).toEqual({ x: 500, y: 0, size: 300 });
    expect(resolveLogoCrop(800, 400, { x: 600, y: 0, size: 300 })).toBeNull();
    expect(resolveLogoCrop(800, 400, { x: -1, y: 0, size: 300 })).toBeNull();
    expect(resolveLogoCrop(800, 400, { x: 0, y: 0, size: 100 })).toBeNull();
  });
});

describe("logo : traitement", () => {
  it("produit un WebP 512 × 512 sans métadonnées à partir du cadrage", async () => {
    const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#123456" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret-owner" } } })
      .jpeg()
      .toBuffer();
    const result = await processLogo(source, { x: 100, y: 50, size: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metadata = await sharp(result.logo.content).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(metadata.exif).toBeUndefined();
    expect(result.logo.content.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(result.logo.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuse les formats, tailles et cadrages invalides", async () => {
    expect(await processLogo(Buffer.from("<svg/>"), null)).toEqual({ ok: false, error: "UNSUPPORTED_FORMAT" });
    expect(await processLogo(Buffer.alloc(LOGO_MAX_BYTES + 1), null)).toEqual({ ok: false, error: "FILE_TOO_LARGE" });
    expect(await processLogo(await image(100, 300), null)).toEqual({ ok: false, error: "IMAGE_TOO_SMALL" });
    expect(await processLogo(await image(300, 300), { x: 100, y: 100, size: 250 })).toEqual({ ok: false, error: "INVALID_CROP" });
    // En-tête PNG valide, contenu tronqué : décodage refusé.
    const truncated = (await image(300, 300)).subarray(0, 60);
    expect(await processLogo(truncated, null)).toEqual({ ok: false, error: "INVALID_IMAGE" });
  });
});

describe("logo : chemin", () => {
  it("n'accepte que /api/logos/<uuid>", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(uploadedLogoId(logoPath(id))).toBe(id);
    expect(uploadedLogoId(`https://evil.example/api/logos/${id}`)).toBeNull();
    expect(uploadedLogoId(`/api/logos/${id}/../x`)).toBeNull();
    expect(uploadedLogoId("/api/logos/not-a-uuid")).toBeNull();
    expect(uploadedLogoId(null)).toBeNull();
  });
});
