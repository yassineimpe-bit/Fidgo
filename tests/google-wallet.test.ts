import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletCard } from "../lib/wallet-data";

const mocks = vi.hoisted(() => {
  const state = { cardActive: true };
  const tx = vi.fn();
  const begin = vi.fn();
  const sql = vi.fn(async (...args: unknown[]): Promise<Array<Record<string, unknown>>> => {
    void args;
    return [];
  });
  return {
    state,
    tx,
    begin,
    sql,
    authorize: vi.fn(async () => ({ access_token: "test-oauth-token" })),
    walletCardForRevocationById: vi.fn(async (): Promise<WalletCard | null> => null),
  };
});

vi.mock("google-auth-library", () => ({
  JWT: class {
    authorize = mocks.authorize;
  },
}));

vi.mock("@/lib/db", () => ({ sql: Object.assign(mocks.sql, { begin: mocks.begin }) }));
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

function queryText(call: unknown[]) {
  return Array.from(call[0] as readonly string[]).join(" ");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  configureGoogle();
  mocks.state.cardActive = true;
  mocks.authorize.mockClear();
  mocks.sql.mockReset();
  mocks.sql.mockResolvedValue([]);
  mocks.tx.mockReset();
  mocks.tx.mockImplementation(async (...args: unknown[]) => {
    const query = queryText(args);
    if (query.includes("select c.id")) return mocks.state.cardActive ? [{ id: fixtureCard.cardId }] : [];
    if (query.includes("returning id")) return [{ id: "wallet-pass-1" }];
    return [];
  });
  mocks.begin.mockReset();
  mocks.begin.mockImplementation(async (fn: unknown) =>
    (fn as (transaction: typeof mocks.tx) => Promise<unknown>)(mocks.tx));
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

describe("Google Wallet loyalty class", () => {
  it("creates one compliant merchant class with stable identifiers and branding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    const { ensureGoogleWalletObject } = await import("../lib/google-wallet");
    await ensureGoogleWalletObject(fixtureCard);

    const classRequest = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(classRequest[0]).toBe("https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass");
    expect(classRequest[1].method).toBe("POST");
    const body = JSON.parse(String(classRequest[1].body));
    expect(body).toEqual({
      id: "1234567890123456789.fidgo_le-retiko-test",
      issuerName: fixtureCard.restaurantName,
      reviewStatus: "UNDER_REVIEW",
      programName: fixtureCard.programName,
      programLogo: {
        sourceUri: { uri: "https://wallet.test/wallet-logo.png" },
        contentDescription: {
          defaultValue: { language: "fr-FR", value: `Logo ${fixtureCard.restaurantName}` },
        },
      },
      accountNameLabel: "Client",
      accountIdLabel: "Carte",
      hexBackgroundColor: fixtureCard.primaryColor,
    });
    expect(body.id).toMatch(/^\d+\.[A-Za-z0-9._-]+$/);
  });

  it("ships a square PNG logo above Google's documented 660px minimum", async () => {
    const metadata = await sharp("public/wallet-logo.png").metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeGreaterThanOrEqual(660);
    expect(metadata.height).toBe(metadata.width);
  });

  it("logs a bounded Google 400 diagnostic without provider or card secrets", async () => {
    const privateKey = "PRIVATE_KEY_SENTINEL";
    const accessToken = "ACCESS_TOKEN_SENTINEL";
    const authorization = "AUTHORIZATION_SENTINEL";
    const serviceAccount = Buffer.from(JSON.stringify({ private_key: "SERVICE_ACCOUNT_SENTINEL" })).toString("base64");
    const providerMessage = [
      `private_key=${privateKey}`,
      `access_token=${accessToken}`,
      `Authorization: Bearer ${authorization}`,
      `card=${fixtureCard.token}`,
      `service_account_json=${serviceAccount}`,
    ].join(" ");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: providerMessage,
          errors: [{ reason: "invalidImage" }],
        },
      }, { status: 400 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { ensureGoogleWalletObject } = await import("../lib/google-wallet");
    await expect(ensureGoogleWalletObject(fixtureCard)).rejects.toMatchObject({
      code: "GOOGLE_CLASS_CREATE_400",
      message: "GOOGLE_CLASS_CREATE_400",
    });

    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).toContain("GOOGLE_WALLET_PROVIDER_ERROR");
    expect(serialized).toContain("GOOGLE_CLASS_CREATE");
    expect(serialized).toContain("invalidImage");
    expect(serialized).toContain("INVALID_ARGUMENT");
    const diagnostic = log.mock.calls[0]?.[1] as { message?: string };
    expect(diagnostic.message?.length).toBeLessThanOrEqual(240);
    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(authorization);
    expect(serialized).not.toContain(serviceAccount);
    expect(serialized).not.toContain(fixtureCard.token);
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

  it("compensates an ACTIVE provider object when erase wins during synchronization", async () => {
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<Response>();
    let fetchCount = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      fetchCount += 1;
      if (fetchCount === 3) {
        providerStarted.resolve();
        return releaseProvider.promise;
      }
      return ok();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { syncGoogleWallet } = await import("../lib/google-wallet");
    const pending = syncGoogleWallet(fixtureCard);
    await providerStarted.promise;
    mocks.state.cardActive = false;
    releaseProvider.resolve(ok());
    await expect(pending).resolves.toBeUndefined();

    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toMatchObject({ state: "ACTIVE" });
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toMatchObject({ state: "INACTIVE" });
    expect(mocks.tx.mock.calls.some((call) => queryText(call).includes("status='revoked'"))).toBe(true);
    expect(mocks.sql.mock.calls.some((call) => queryText(call).includes("status='error'"))).toBe(false);
  });
});

describe("Google Wallet issue lifecycle race", () => {
  it("lets erase win after issue started, even when its notifier ran before the provider returned", async () => {
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<Response>();
    let fetchCount = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      fetchCount += 1;
      if (fetchCount === 3) {
        providerStarted.resolve();
        return releaseProvider.promise;
      }
      return ok();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { googleWalletSaveLink, notifyGoogleWalletRevocation } = await import("../lib/google-wallet");
    const pending = googleWalletSaveLink(fixtureCard);
    const rejected = expect(pending).rejects.toThrow("GOOGLE_WALLET_CARD_REVOKED");
    await providerStarted.promise;

    mocks.state.cardActive = false;
    await notifyGoogleWalletRevocation(fixtureCard.cardId);
    expect(mocks.walletCardForRevocationById).not.toHaveBeenCalled();

    releaseProvider.resolve(ok());
    await rejected;

    const providerStates = fetchMock.mock.calls
      .map((call) => call[1] as RequestInit | undefined)
      .filter((init) => init?.body)
      .map((init) => JSON.parse(String(init?.body)).state);
    expect(providerStates).toEqual(["ACTIVE", "INACTIVE"]);
    expect(mocks.tx.mock.calls.some((call) => queryText(call).includes("for update of c"))).toBe(true);
    expect(mocks.tx.mock.calls.some((call) => queryText(call).includes("status='revoked'"))).toBe(true);
  });

  it("lets a lifecycle revocation after revalidation force both local and provider state inactive", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => ok());
    vi.stubGlobal("fetch", fetchMock);

    const { ensureGoogleWalletObject, notifyGoogleWalletRevocation } = await import("../lib/google-wallet");
    await ensureGoogleWalletObject(fixtureCard);

    mocks.state.cardActive = false;
    mocks.sql.mockResolvedValueOnce([{ id: "wallet-pass-1", external_id: `1234567890123456789.card_${fixtureCard.cardId}` }]);
    mocks.walletCardForRevocationById.mockResolvedValueOnce(fixtureCard);
    await notifyGoogleWalletRevocation(fixtureCard.cardId);

    const lastProviderBody = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body));
    expect(lastProviderBody).toMatchObject({ state: "INACTIVE" });
    const lastWrite = mocks.sql.mock.calls.at(-1);
    expect(queryText(lastWrite || [])).toContain("status='revoked'");
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

  it("never calls the Google API when no Google pass is on record for the card", async () => {
    mocks.sql.mockImplementationOnce(async () => []);
    vi.stubGlobal("fetch", vi.fn());

    const { notifyGoogleWalletRevocation } = await import("../lib/google-wallet");
    await notifyGoogleWalletRevocation(fixtureCard.cardId);

    expect(mocks.walletCardForRevocationById).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
