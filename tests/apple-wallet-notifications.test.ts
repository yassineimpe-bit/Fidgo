import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type PushOutcome = { status: number; reason?: string };

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  connect: vi.fn(),
  outcomes: [] as PushOutcome[],
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("node:http2", () => ({ connect: mocks.connect }));

function queryText(call: unknown[]) {
  return (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.outcomes.length = 0;
  process.env.APPLE_WALLET_ENABLED = "true";
  process.env.APPLE_PASS_TYPE_IDENTIFIER = "pass.fr.retiko.test";
  process.env.APPLE_TEAM_IDENTIFIER = "TESTTEAM1";
  process.env.APPLE_WWDR_CERT_BASE64 = "Y2VydA==";
  process.env.APPLE_SIGNER_CERT_BASE64 = "Y2VydA==";
  process.env.APPLE_SIGNER_KEY_BASE64 = "a2V5";

  mocks.connect.mockImplementation(() => {
    const client = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn>; request: (headers: Record<string, string>) => EventEmitter & { end: (body: string) => void } };
    client.close = vi.fn();
    client.request = () => {
      const request = new EventEmitter() as EventEmitter & { end: (body: string) => void };
      request.end = () => queueMicrotask(() => {
        const outcome = mocks.outcomes.shift() || { status: 200 };
        request.emit("response", { ":status": outcome.status });
        if (outcome.reason) request.emit("data", Buffer.from(JSON.stringify({ reason: outcome.reason })));
        request.emit("end");
      });
      return request;
    };
    return client;
  });
});

async function notify(outcome: PushOutcome) {
  mocks.outcomes.push(outcome);
  mocks.sql
    .mockResolvedValueOnce([{ id: "wallet-pass-1" }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "registration-1", push_token: "a".repeat(64) }])
    .mockResolvedValue([]);
  const { notifyAppleWallet } = await import("../lib/apple-wallet");
  await notifyAppleWallet("card-1");
}

describe("Apple Wallet APNs registration lifecycle", () => {
  it("conserve la registration après un push réussi", async () => {
    await notify({ status: 200 });

    expect(mocks.sql.mock.calls.some((call) => queryText(call).startsWith("delete from apple_wallet_registrations"))).toBe(false);
  });

  it("supprime uniquement la registration dont APNs confirme l'invalidité permanente", async () => {
    await notify({ status: 410, reason: "Unregistered" });

    const deletion = mocks.sql.mock.calls.find((call) => queryText(call).startsWith("delete from apple_wallet_registrations"));
    expect(deletion).toBeDefined();
    expect(queryText(deletion!)).toContain("where id=? and wallet_pass_id=?");
    expect(deletion).toEqual(expect.arrayContaining(["registration-1", "wallet-pass-1"]));
    const lastError = mocks.sql.mock.calls.at(-1)!;
    expect(lastError).toEqual(expect.arrayContaining(["APPLE_APNS_410"]));
    expect(lastError).not.toEqual(expect.arrayContaining(["a".repeat(64)]));
  });

  it("conserve la registration après une erreur APNs temporaire", async () => {
    await notify({ status: 500, reason: "InternalServerError" });

    expect(mocks.sql.mock.calls.some((call) => queryText(call).startsWith("delete from apple_wallet_registrations"))).toBe(false);
    expect(mocks.sql.mock.calls.at(-1)).toEqual(expect.arrayContaining(["APPLE_APNS_500"]));
  });
});
