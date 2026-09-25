import { jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret,
  hashRecoveryCode, normalizeRecoveryCode, otpauthUri, totpCode, totpStep, verifyTotp,
} from "@/lib/totp";
import { signMfaPending, verifyMfaPending } from "@/lib/two-factor";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-two-factor-unit-tests-only-0123456789";
});

// Secret de référence de la RFC 6238 (annexe B) : "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("TOTP RFC 6238", () => {
  it("retrouve les vecteurs SHA-1 officiels (6 derniers chiffres)", () => {
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpCode(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("base32 aller-retour, secret de 160 bits", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-gy3t qojq gezdgnbvgy3tqojq")).toEqual(RFC_SECRET);
    expect(base32Decode("not base32!")).toBeNull();
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("accepte ±1 pas, refuse au-delà et tout rejeu", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1111111109_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step + 2), null, now)).toBeNull();
    // Rejeu : le pas déjà utilisé, ou un plus ancien, est refusé.
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step - 1), step, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step + 1), step, now)).toBe(step + 1);
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", null, now)).toBeNull();
  });

  it("URI otpauth lisible par les applications", () => {
    const uri = otpauthUri("GEZDGNBV", "owner@example.com");
    expect(uri).toBe("otpauth://totp/Retiko%3Aowner%40example.com?secret=GEZDGNBV&issuer=Retiko&algorithm=SHA1&digits=6&period=30");
  });
});

describe("secret chiffré", () => {
  it("aller-retour, IV aléatoire, altération détectée", () => {
    const secret = generateTotpSecret();
    const first = encryptTotpSecret(secret);
    const second = encryptTotpSecret(secret);
    expect(first).not.toBe(second);
    expect(first).not.toContain(secret);
    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decryptTotpSecret(first)).toBe(secret);
    const [version, iv, data, tag] = first.split(".");
    const flipped = data.slice(0, -1) + (data.endsWith("A") ? "B" : "A");
    expect(decryptTotpSecret([version, iv, flipped, tag].join("."))).toBeNull();
    expect(decryptTotpSecret("v2.x.y.z")).toBeNull();
  });

  it("illisible avec un autre AUTH_SECRET", () => {
    const stored = encryptTotpSecret(generateTotpSecret());
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-entirely-different-0123456789";
    try {
      expect(decryptTotpSecret(stored)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });
});

describe("codes de secours", () => {
  it("10 codes uniques, normalisés et hachés", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const [code] = codes;
    expect(normalizeRecoveryCode(code.toLowerCase().replace("-", " "))).toBe(code.replace("-", ""));
    expect(hashRecoveryCode(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode("short")).toBeNull();
  });
});

describe("jeton « second facteur attendu »", () => {
  it("n'est jamais accepté comme session et expire", async () => {
    const token = await signMfaPending("11111111-1111-4111-8111-111111111111", 3);
    expect(await verifyMfaPending(token)).toEqual({ staffId: "11111111-1111-4111-8111-111111111111", tokenVersion: 3 });
    // La clé des sessions (AUTH_SECRET brut) ne valide pas ce jeton.
    await expect(jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET))).rejects.toThrow();
    expect(await verifyMfaPending(undefined)).toBeNull();
    expect(await verifyMfaPending(`${token}x`)).toBeNull();
  });
});
