import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletCard } from "../lib/wallet-data";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  walletCardById: vi.fn(),
  syncGoogleWallet: vi.fn(async () => undefined),
  notifyAppleWallet: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/wallet-data", () => ({ walletCardById: mocks.walletCardById }));
vi.mock("@/lib/google-wallet", () => ({ syncGoogleWallet: mocks.syncGoogleWallet }));
vi.mock("@/lib/apple-wallet", () => ({ notifyAppleWallet: mocks.notifyAppleWallet }));

const card = { cardId: "card-1" } as WalletCard;

beforeEach(() => {
  mocks.sql.mockReset();
  mocks.walletCardById.mockReset();
  mocks.syncGoogleWallet.mockClear();
  mocks.notifyAppleWallet.mockClear();
});

describe("syncWalletsForCard", () => {
  it("keeps Apple and Google synchronization for existing providers", async () => {
    mocks.walletCardById.mockResolvedValue(card);
    mocks.sql.mockResolvedValue([{ provider: "APPLE" }, { provider: "GOOGLE" }]);

    const { syncWalletsForCard } = await import("../lib/wallet-sync");
    await syncWalletsForCard(card.cardId);

    expect(mocks.notifyAppleWallet).toHaveBeenCalledWith(card.cardId);
    expect(mocks.syncGoogleWallet).toHaveBeenCalledWith(card);
  });
});
