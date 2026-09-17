import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletCard } from "../lib/wallet-data";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async () => ({ access_token: "test-oauth-token" })),
  sql: vi.fn(async (...args: unknown[]) => {
    void args;
    return [];
  }),
}));

vi.mock("google-auth-library", () => ({
  JWT: class {
    authorize = mocks.authorize;
  },
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));

const fixtureCard: WalletCard = {
  cardId: "11111111-1111-1111-1111-111111111111",
  establishmentId: "22222222-2222-2222-2222-222222222222",
  token: "test-card-token-abcdefgh",
  shortCode: "AB12CD",
  balance: 7,
  firstName: "Camille",
  expiresAt: null,
  restaurantName: "Le Retiko Test",
  restaurantSlug: "le-retiko-test",
  primaryColor: "#1a2b3c",
  programName: "Fidélité Test",
  mode: "STAMPS",
  rewardThreshold: 10,
  rewardLabel: "Café offert",
  cardMessage: "Merci de votre fidélité",
};

function configureGoogle(privateKey = "test-private-key") {
  process.env.GOOGLE_WALLET_ENABLED = "true";
  process.env.GOOGLE_WALLET_ISSUER_ID = "1234567890123456789";
  process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(JSON.stringify({
    client_email: "wallet-test@fidgo-test.iam.gserviceaccount.com",
    private_key: privateKey,
  })).toString("base64");
  process.env.NEXT_PUBLIC_APP_URL = "https://wallet.test";
  delete process.env.VERCEL_ENV;
}

function ok() {
  return new Response(null, { status: 200 });
}

beforeEach(() => {
  configureGoogle();
  mocks.authorize.mockClear();
  mocks.sql.mockClear();
  vi.unstubAllGlobals();
});

describe("Google Wallet loyalty object", () => {
  it("keeps account and QR identifiers while rendering stamp progress", async () => {
    const { objectBody } = await import("../lib/google-wallet");
    const body = objectBody(fixtureCard);

    expect(body.accountId).toBe(fixtureCard.shortCode);
    expect(body.barcode).toEqual({
      type: "QR_CODE",
      value: `LOY1:${fixtureCard.token}`,
      alternateText: fixtureCard.shortCode,
    });
    expect(body.loyaltyPoints).toEqual({ label: "Tampons", balance: { string: "7/10" } });
    expect(body.secondaryLoyaltyPoints).toEqual({
      label: fixtureCard.rewardLabel,
      balance: { string: "3 restant(s)" },
    });
  });

  it("renders a numeric points balance", async () => {
    const { objectBody } = await import("../lib/google-wallet");
    const body = objectBody({ ...fixtureCard, mode: "POINTS", balance: 450, rewardThreshold: 500 });
    expect(body.loyaltyPoints).toEqual({ label: "Points", balance: { string: "450" } });
  });

  it("marks the configured reward as available when the threshold is reached", async () => {
    const { objectBody } = await import("../lib/google-wallet");
    const body = objectBody({ ...fixtureCard, balance: 10 });
    expect(body.secondaryLoyaltyPoints).toEqual({
      label: fixtureCard.rewardLabel,
      balance: { string: "Disponible" },
    });
  });
});

describe("Google Wallet save JWT", () => {
  it("signs a real minimal RS256 JWT that references only the persisted object", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    configureGoogle(privatePem);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok()));

    const { googleWalletSaveLink } = await import("../lib/google-wallet");
    const link = await googleWalletSaveLink(fixtureCard);
    const token = link.slice("https://pay.google.com/gp/v/save/".length);
    const verificationKey = await importSPKI(publicPem, "RS256");
    const { payload, protectedHeader } = await jwtVerify(token, verificationKey, {
      issuer: "wallet-test@fidgo-test.iam.gserviceaccount.com",
      audience: "google",
    });

    expect(protectedHeader).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("wallet-test@fidgo-test.iam.gserviceaccount.com");
    expect(payload.aud).toBe("google");
    expect(payload.typ).toBe("savetowallet");
    expect(typeof payload.iat).toBe("number");
    expect(payload.origins).toEqual(["https://wallet.test"]);
    const loyaltyObject = (payload.payload as { loyaltyObjects: Array<Record<string, unknown>> }).loyaltyObjects[0];
    expect(loyaltyObject).toEqual({
      id: `1234567890123456789.card_${fixtureCard.cardId}`,
      classId: "1234567890123456789.fidgo_le-retiko-test",
    });
    expect(Object.keys(loyaltyObject).sort()).toEqual(["classId", "id"]);
  });
});

describe("Google Wallet background sync", () => {
  it("contains a Google 503, marks the pass as error and never rejects the checkout flow", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response("sensitive provider response", { status: 503 })));

    const { syncGoogleWallet } = await import("../lib/google-wallet");
    await expect(syncGoogleWallet(fixtureCard)).resolves.toBeUndefined();

    const errorWrite = mocks.sql.mock.calls.find((call) =>
      Array.from(call[0] as readonly string[]).join("").includes("status='error'"));
    expect(errorWrite).toBeTruthy();
    expect(errorWrite?.[1]).toBe("GOOGLE_OBJECT_PATCH_503");
    expect(JSON.stringify(errorWrite)).not.toContain("sensitive provider response");
  });
});
