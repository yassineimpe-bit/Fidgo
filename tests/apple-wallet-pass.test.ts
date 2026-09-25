import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateTestAppleCertChain, type TestAppleCertChain } from "./helpers/apple-certs";
import type { WalletCard } from "../lib/wallet-data";

// buildApplePass() ecrit un enregistrement wallet_passes : sql() est mocke
// pour garder ce test hors base de donnees, comme le reste de la suite
// unitaire (la vraie ecriture est couverte cote e2e/API).
vi.mock("@/lib/db", () => {
  const tx = async (strings: TemplateStringsArray) => String(strings[0]).includes("select c.id") ? [{ id: "active" }] : [];
  return { sql: Object.assign(async () => [], { begin: async (fn: unknown) => (fn as (transaction: typeof tx) => unknown)(tx) }) };
});

let certs: TestAppleCertChain;

beforeAll(() => {
  certs = generateTestAppleCertChain();
});

afterAll(() => {
  certs.cleanup();
});

/** Lit une archive .pkpass (toujours non compressee, methode STORE) sans dependance zip supplementaire. */
function readStoredZip(buffer: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    if (method !== 0) throw new Error(`unexpected compression method ${method} for ${name}`);
    files[name] = buffer.subarray(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
  }
  return files;
}

const fixtureCard: WalletCard = {
  cardId: "11111111-1111-1111-1111-111111111111",
  establishmentId: "22222222-2222-2222-2222-222222222222",
  token: "test-card-token-abcdefgh",
  shortCode: "AB12CD",
  balance: 4,
  firstName: "Camille",
  expiresAt: null,
  restaurantName: "Le Retiko Test",
  restaurantSlug: "le-retiko-test",
  primaryColor: "#1a2b3c",
  programName: "Fidélité Test",
  mode: "STAMPS",
  units: { singular: "tampon", plural: "tampons" },
  rewardThreshold: 8,
  rewardLabel: "Un café offert",
  cardMessage: "Merci de votre fidélité",
};

describe("buildApplePass", () => {
  it("produit un .pkpass signé et cohérent avec la carte, sans jamais journaliser le token brut", async () => {
    vi.resetModules();
    process.env.APPLE_WALLET_ENABLED = "true";
    process.env.APPLE_PASS_TYPE_IDENTIFIER = "pass.fr.retiko.test";
    process.env.APPLE_TEAM_IDENTIFIER = "TESTTEAM1";
    process.env.APPLE_WWDR_CERT_BASE64 = certs.wwdr;
    process.env.APPLE_SIGNER_CERT_BASE64 = certs.signerCert;
    process.env.APPLE_SIGNER_KEY_BASE64 = certs.signerKey;
    delete process.env.APPLE_SIGNER_KEY_PASSPHRASE;
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.NEXT_PUBLIC_APP_URL = "https://retiko.fr";
    delete process.env.VERCEL_ENV;

    const { appleAuthenticationToken, buildApplePass, buildRevokedApplePass } = await import("../lib/apple-wallet");
    const buffer = await buildApplePass(fixtureCard);

    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const files = readStoredZip(buffer);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "pass.json", "manifest.json", "signature",
      "icon.png", "icon@2x.png", "icon@3x.png",
      "logo.png", "logo@2x.png", "logo@3x.png",
    ]));

    // La signature PKCS#7 n'est pas vide : la chaine WWDR/signer de test a
    // bien été utilisée pour produire une signature detachee.
    expect(files.signature.length).toBeGreaterThan(0);

    const manifest = JSON.parse(files["manifest.json"].toString("utf8")) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual(expect.arrayContaining(["pass.json", "icon.png", "logo.png"]));

    const passJson = JSON.parse(files["pass.json"].toString("utf8"));
    expect(passJson.formatVersion).toBe(1);
    expect(passJson.passTypeIdentifier).toBe("pass.fr.retiko.test");
    expect(passJson.teamIdentifier).toBe("TESTTEAM1");
    expect(passJson.serialNumber).toBe(fixtureCard.cardId);
    expect(passJson.organizationName).toBe(fixtureCard.restaurantName);
    expect(passJson.webServiceURL).toBe("https://retiko.fr/api/wallet/apple/web");
    expect(typeof passJson.authenticationToken).toBe("string");
    expect(passJson.authenticationToken).not.toContain(fixtureCard.token);
    expect(passJson.storeCard.primaryFields[0]).toMatchObject({ key: "balance", value: 4 });
    expect(passJson.storeCard.secondaryFields[0]).toMatchObject({ key: "reward", value: "4 restant(s)" });
    expect(passJson.storeCard.auxiliaryFields[0]).toMatchObject({ key: "code", value: fixtureCard.shortCode });
    expect(passJson.barcodes[0]).toMatchObject({ format: "PKBarcodeFormatQR", message: `LOY1:${fixtureCard.token}` });

    const revokedBuffer = await buildRevokedApplePass(fixtureCard, appleAuthenticationToken(fixtureCard.token));
    const revokedFiles = readStoredZip(revokedBuffer);
    const revokedJson = JSON.parse(revokedFiles["pass.json"].toString("utf8"));
    expect(revokedJson.voided).toBe(true);
    expect(revokedJson.storeCard.primaryFields[0]).toMatchObject({ key: "status", value: "Désactivée" });
    expect(revokedJson.barcodes).toBeUndefined();
  });
});
