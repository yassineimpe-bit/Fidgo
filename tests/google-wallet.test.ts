import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletCard } from "../lib/wallet-data";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async () => ({ access_token: "test-oauth-token" })),
  sql: vi.fn(async (...args: unknown[]): Promise<Array<Record<string, unknown>>> => {
    void args;
    return [];
  }),
  walletCardForRevocationById: vi.fn(async (): Promise<WalletCard | null> => null),
}));

vi.mock("google-auth-library", () => ({
  JWT: class {
    authorize = mocks.authorize;
  },
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/wallet-data", () => ({ walletCardForRevocationById: mocks.walletCardForRevocationById }));

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
  units: { singular: "tampon", plural: "tampons" },
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
  mocks.walletCardForRevocationById.mockReset();
  mocks.walletCardForRevocationById.mockResolvedValue(null);
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

  it("uses the merchant's custom unit label", async () => {
    const { objectBody } = await import("../lib/google-wallet");
    const body = objectBody({ ...fixtureCard, units: { singular: "café", plural: "cafés" } });
    expect(body.loyaltyPoints).toEqual({ label: "Cafés", balance: { string: "7/10" } });
  });

  it("shows the merchant visual as hero image only when one is uploaded", async () => {
    const { objectBody } = await import("../lib/google-wallet");
    expect(objectBody(fixtureCard).heroImage).toBeUndefined();
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const body = objectBody({ ...fixtureCard, cardImageId: id });
    expect(body.heroImage?.sourceUri.uri).toMatch(new RegExp(`^https?://[^/]+/api/card-images/${id}$`));
  });

  it("renders a numeric points balance", async () => {
    const { objectBody } = await import("../lib/google-wallet");
    const body = objectBody({ ...fixtureCard, mode: "POINTS", units: { singular: "point", plural: "points" }, balance: 450, rewardThreshold: 500 });
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

describe("Google Wallet revocation sync", () => {
  it("deactivates the Google Wallet object when a card is revoked, mirroring the Apple 'voided' pass", async () => {
    // Bug reproduit : avant ce correctif, notifyGoogleWalletRevocation()
    // n'existait pas. Une carte révoquée (établissement suspendu, client
    // effacé) laissait donc l'objet Google Wallet du client visible et
    // affiché comme actif pour toujours, alors que le pass Apple équivalent
    // passe correctement à "Désactivée" via notifyAppleWalletRevocation().
    mocks.sql.mockImplementationOnce(async () => [{ id: "wallet-pass-1" }]);
    mocks.walletCardForRevocationById.mockResolvedValueOnce(fixtureCard);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok()));

    const { notifyGoogleWalletRevocation } = await import("../lib/google-wallet");
    await notifyGoogleWalletRevocation(fixtureCard.cardId);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [patchUrl, patchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(patchUrl).toContain("/loyaltyObject/");
    expect(patchInit.method).toBe("PATCH");
    const patchedBody = JSON.parse(String(patchInit.body)) as { state?: string };
    expect(patchedBody.state).toBe("INACTIVE");

    const finalUpdate = mocks.sql.mock.calls.at(-1);
    expect(Array.from(finalUpdate?.[0] as readonly string[]).join("")).toContain("last_synced_at=now()");
  });

  it("never calls the Google API when no active Google pass is on record for the card", async () => {
    mocks.sql.mockImplementationOnce(async () => []);
    vi.stubGlobal("fetch", vi.fn());

    const { notifyGoogleWalletRevocation } = await import("../lib/google-wallet");
    await notifyGoogleWalletRevocation(fixtureCard.cardId);

    expect(mocks.walletCardForRevocationById).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
