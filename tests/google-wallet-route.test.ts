import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(async () => null),
  walletCardByToken: vi.fn(),
  googleWalletEnabled: vi.fn(() => true),
  googleWalletSaveLink: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock("@/lib/wallet-data", () => ({ walletCardByToken: mocks.walletCardByToken }));
vi.mock("@/lib/google-wallet", () => ({
  googleWalletEnabled: mocks.googleWalletEnabled,
  googleWalletSaveLink: mocks.googleWalletSaveLink,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.googleWalletEnabled.mockReturnValue(true);
  mocks.walletCardByToken.mockResolvedValue({ token: "card-token-provider-must-never-log" });
});

describe("Google Wallet issue route", () => {
  it("keeps provider diagnostics server-side and returns only the stable public error", async () => {
    const cardToken = "card-token-provider-must-never-log";
    mocks.googleWalletSaveLink.mockRejectedValueOnce(
      new Error(`GOOGLE_CLASS_CREATE_400:${cardToken}:PRIVATE_KEY_SENTINEL`),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { GET } = await import("../app/api/wallet/google/[token]/route");

    const response = await GET(
      new Request(`https://retiko.test/api/wallet/google/${cardToken}`),
      { params: Promise.resolve({ token: cardToken }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "GOOGLE_WALLET_UNAVAILABLE" });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).toContain("GOOGLE_CLASS_CREATE_400");
    expect(serialized).not.toContain(cardToken);
    expect(serialized).not.toContain("PRIVATE_KEY_SENTINEL");
  });
});
