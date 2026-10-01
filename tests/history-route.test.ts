import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  sql: vi.fn(),
  enforceRateLimit: vi.fn(async () => null),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));

import { GET } from "@/app/api/history/route";
import { parseHistoryLimit } from "@/lib/history";

const session = (role: "OWNER" | "MANAGER" | "VIEWER" | "EMPLOYEE") => ({
  staffId: `staff-${role.toLowerCase()}`,
  establishmentId: "tenant-a",
  email: `${role.toLowerCase()}@example.test`,
  role,
  tokenVersion: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(session("OWNER"));
  mocks.sql.mockResolvedValue([{ id: "transaction-a" }]);
});

describe("GET /api/history", () => {
  it.each(["OWNER", "MANAGER", "VIEWER"] as const)("autorise le rôle %s", async (role) => {
    mocks.getSession.mockResolvedValueOnce(session(role));

    const response = await GET(new Request("https://retiko.test/api/history"));

    expect(response.status).toBe(200);
    expect(mocks.sql).toHaveBeenCalledOnce();
  });

  it("refuse un EMPLOYEE scanner-only avant le rate limiting et la base", async () => {
    mocks.getSession.mockResolvedValueOnce(session("EMPLOYEE"));

    const response = await GET(new Request("https://retiko.test/api/history"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("refuse une requête sans session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);

    const response = await GET(new Request("https://retiko.test/api/history"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("ignore un tenant fourni par le client et borne la requête au tenant de la session", async () => {
    const response = await GET(new Request(
      "https://retiko.test/api/history?establishmentId=tenant-b&limit=10",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "transaction-a" }]);
    const [query, establishmentId] = mocks.sql.mock.calls[0];
    expect(query.join(" ")).toContain("where t.establishment_id =");
    expect(establishmentId).toBe("tenant-a");
    expect(mocks.sql.mock.calls[0]).not.toContain("tenant-b");
  });

  it.each([
    [null, 20],
    ["10", 10],
    ["1000", 100],
    ["0", 20],
    ["-10", 20],
    ["abc", 20],
    ["1.5", 1],
    ["Infinity", 20],
  ])("normalise limit=%s en %i sans erreur serveur", async (raw, expected) => {
    const suffix = raw === null ? "" : `?limit=${encodeURIComponent(raw)}`;

    const response = await GET(new Request(`https://retiko.test/api/history${suffix}`));

    expect(response.status).toBe(200);
    expect(parseHistoryLimit(raw)).toBe(expected);
    expect(mocks.sql.mock.calls[0].at(-1)).toBe(expected);
  });
});
