import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardToken } from "../lib/ids";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  rejectCrossOrigin: vi.fn(),
  requestIp: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/security", () => ({
  rejectCrossOrigin: mocks.rejectCrossOrigin,
  requestIp: mocks.requestIp,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.rejectCrossOrigin.mockReturnValue(null);
  mocks.requestIp.mockReturnValue("127.0.0.1");
});

describe("POST /api/client-errors", () => {
  it("never writes a real card token from the reported path", async () => {
    const token = cardToken();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/client-errors/route");

    const response = await POST(new Request("https://retiko.test/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Error",
        message: "render failed",
        path: `/c/${token}`,
      }),
    }));

    expect(response.status).toBe(202);
    expect(consoleError).toHaveBeenCalledWith("RETIKO_CLIENT_ERROR", expect.objectContaining({
      path: "/c/[redacted]",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(token);

    consoleError.mockRestore();
    consoleInfo.mockRestore();
  });
});
