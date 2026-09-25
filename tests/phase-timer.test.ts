import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhaseTimer } from "@/lib/phase-timer";

describe("chronométrage login", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ne journalise rien tant que LOGIN_TIMING_LOG n'est pas activé", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const timer = createPhaseTimer("LOGIN_TIMING", false);
    timer.lap("bcryptMs");
    expect(timer.done("success")).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("journalise des durées entières par phase, sans autre donnée", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const timer = createPhaseTimer("LOGIN_TIMING", true);
    timer.lap("parseMs");
    timer.lap("bcryptMs");
    const entry = timer.done("success");
    expect(Object.keys(entry!).sort()).toEqual(["bcryptMs", "outcome", "parseMs", "totalMs"]);
    expect(Object.values(entry!).filter((value) => typeof value === "number").every(Number.isInteger)).toBe(true);
    expect(log).toHaveBeenCalledWith("LOGIN_TIMING", JSON.stringify(entry));
  });

  it("ne renvoie jamais les durées au navigateur", () => {
    const route = readFileSync("app/api/auth/login/route.ts", "utf8");
    expect(route).not.toMatch(/server-timing/i);
    expect(route).not.toMatch(/json\(\{[^}]*(timer|Ms\b)/);
  });
});
