import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  enforceRateLimit: vi.fn(async () => null),
  applePassTypeIdentifier: vi.fn(() => "pass.fr.retiko.test"),
  buildApplePass: vi.fn(async () => Buffer.from("active-pass")),
  buildRevokedApplePass: vi.fn(async () => Buffer.from("revoked-pass")),
  walletCardById: vi.fn(),
  walletCardForRevocationById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock("@/lib/apple-wallet", () => ({
  applePassTypeIdentifier: mocks.applePassTypeIdentifier,
  buildApplePass: mocks.buildApplePass,
  buildRevokedApplePass: mocks.buildRevokedApplePass,
}));
vi.mock("@/lib/wallet-data", () => ({
  walletCardById: mocks.walletCardById,
  walletCardForRevocationById: mocks.walletCardForRevocationById,
}));

const passType = "pass.fr.retiko.test";
const serial = "11111111-1111-1111-1111-111111111111";
const device = "device_0123456789abcdef";
const authenticationToken = "authentication-token";
const pushToken = "a".repeat(64);

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function registrationPath(value = device) {
  return ["v1", "devices", value, "registrations", passType, serial];
}

function authorization() {
  return { authorization: `ApplePass ${authenticationToken}` };
}

function authorizedPass(status = "active") {
  return { id: "wallet-pass-1", card_id: "card-1", authentication_token_hash: "ignored", status };
}

function queryText(call: unknown[]) {
  return (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceRateLimit.mockResolvedValue(null);
});

describe("Apple Wallet Web Service validation", () => {
  it("borne strictement passesUpdatedSince", async () => {
    const { parsePassesUpdatedSince } = await import("../lib/apple-wallet-web");
    const now = 2_000_000_000;

    expect(parsePassesUpdatedSince(null, now)).toEqual({ valid: true, value: null });
    expect(parsePassesUpdatedSince("0", now)).toEqual({ valid: true, value: 0 });
    expect(parsePassesUpdatedSince("123", now)).toEqual({ valid: true, value: 123 });
    for (const invalid of ["", "-1", "1.5", "Infinity", "abc", String(now + 86_401), "9007199254740992"]) {
      expect(parsePassesUpdatedSince(invalid, now)).toEqual({ valid: false, value: null });
    }
  });

  it("refuse un device identifier invalide avant toute lecture ou écriture PassKit", async () => {
    const { POST } = await import("../app/api/wallet/apple/web/[...path]/route");
    const response = await POST(new Request("https://retiko.test/api/wallet/apple/web", {
      method: "POST",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ pushToken }),
    }), context(registrationPath("x".repeat(257))));

    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("refuse un push token manifestement invalide sans écrire de registration", async () => {
    const { createHash } = await import("node:crypto");
    mocks.sql.mockResolvedValueOnce([{ ...authorizedPass(), authentication_token_hash: createHash("sha256").update(authenticationToken).digest("hex") }]);
    const { POST } = await import("../app/api/wallet/apple/web/[...path]/route");
    const response = await POST(new Request("https://retiko.test/api/wallet/apple/web", {
      method: "POST",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ pushToken: "not a device token" }),
    }), context(registrationPath()));

    expect(response.status).toBe(400);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.sql.mock.calls.some((call) => queryText(call).includes("insert into apple_wallet_registrations"))).toBe(false);
  });

  it("conserve register et unregister avec authentification et ciblage du pass", async () => {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(authenticationToken).digest("hex");
    const { POST, DELETE } = await import("../app/api/wallet/apple/web/[...path]/route");

    mocks.sql
      .mockResolvedValueOnce([{ ...authorizedPass(), authentication_token_hash: hash }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const registered = await POST(new Request("https://retiko.test/api/wallet/apple/web", {
      method: "POST",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ pushToken }),
    }), context(registrationPath()));
    expect(registered.status).toBe(201);
    expect(queryText(mocks.sql.mock.calls[2])).toContain("insert into apple_wallet_registrations");

    mocks.sql
      .mockResolvedValueOnce([{ ...authorizedPass(), authentication_token_hash: hash }])
      .mockResolvedValueOnce([]);
    const unregistered = await DELETE(new Request("https://retiko.test/api/wallet/apple/web", {
      method: "DELETE",
      headers: authorization(),
    }), context(registrationPath()));
    expect(unregistered.status).toBe(200);
    expect(queryText(mocks.sql.mock.calls.at(-1)!)).toContain("wallet_pass_id=? and device_library_identifier=?");
  });

  it("refuse un téléchargement sans token ApplePass valide", async () => {
    mocks.sql.mockResolvedValueOnce([{ ...authorizedPass(), authentication_token_hash: "invalid-hash" }]);
    const { GET } = await import("../app/api/wallet/apple/web/[...path]/route");
    const response = await GET(new Request("https://retiko.test/api/wallet/apple/web", {
      headers: authorization(),
    }), context(["v1", "passes", passType, serial]));

    expect(response.status).toBe(401);
    expect(mocks.walletCardById).not.toHaveBeenCalled();
    expect(mocks.buildApplePass).not.toHaveBeenCalled();
  });

  it("sert encore le dernier pass actif authentifié sans cache", async () => {
    const { createHash } = await import("node:crypto");
    const card = { cardId: "card-1" };
    mocks.sql.mockResolvedValueOnce([{
      ...authorizedPass(),
      authentication_token_hash: createHash("sha256").update(authenticationToken).digest("hex"),
    }]);
    mocks.walletCardById.mockResolvedValueOnce(card);
    const { GET } = await import("../app/api/wallet/apple/web/[...path]/route");
    const response = await GET(new Request("https://retiko.test/api/wallet/apple/web", {
      headers: authorization(),
    }), context(["v1", "passes", passType, serial]));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.walletCardById).toHaveBeenCalledWith("card-1");
    expect(mocks.buildApplePass).toHaveBeenCalledWith(card);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(expect.any(Request), "wallet-apple-web", 60, 60);
  });

  it("répond 400 aux update tags invalides sans lancer de requête métier", async () => {
    const { GET } = await import("../app/api/wallet/apple/web/[...path]/route");
    const response = await GET(
      new Request("https://retiko.test/api/wallet/apple/web?passesUpdatedSince=Infinity"),
      context(["v1", "devices", device, "registrations", passType]),
    );

    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("calcule le tag sur la carte et le pass tout en gardant le scope tenant", async () => {
    mocks.sql.mockResolvedValueOnce([
      { serial_number: "serial-1", update_tag: 100 },
      { serial_number: "serial-2", update_tag: 125 },
    ]);
    const { GET } = await import("../app/api/wallet/apple/web/[...path]/route");
    const response = await GET(
      new Request("https://retiko.test/api/wallet/apple/web?passesUpdatedSince=42"),
      context(["v1", "devices", device, "registrations", passType]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ serialNumbers: ["serial-1", "serial-2"], lastUpdated: "125" });
    const query = queryText(mocks.sql.mock.calls[0]);
    expect(query).toContain("greatest(c.updated_at,wp.updated_at)");
    expect(query).toContain("wp.establishment_id=c.establishment_id");
    expect(query).toContain("greatest(c.updated_at,wp.updated_at) > to_timestamp(?)");
  });
});
