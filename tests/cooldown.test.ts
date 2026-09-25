import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COOLDOWN_PRESETS,
  DEFAULT_COOLDOWN_SECONDS,
  NEW_PURCHASE_REASON,
  cooldownRemainingSeconds,
  formatCooldown,
  formatRemaining,
} from "@/lib/cooldown";

describe("cooldown pilote", () => {
  it("démarre les nouveaux programmes à 10 minutes et propose 2/5/10/15 min", () => {
    expect(DEFAULT_COOLDOWN_SECONDS).toBe(600);
    expect([...COOLDOWN_PRESETS]).toEqual([120, 300, 600, 900]);
    expect(COOLDOWN_PRESETS).toContain(DEFAULT_COOLDOWN_SECONDS);
  });

  it("n'ajoute aucune migration qui réécrirait les programmes existants", () => {
    const signup = readFileSync("app/api/auth/signup/route.ts", "utf8");
    expect(signup).toMatch(/insert into loyalty_programs\([^)]*cooldown_seconds\)/);
    expect(signup).toContain("DEFAULT_COOLDOWN_SECONDS");
    for (const file of ["db/schema.sql", ...["006_pilot_v0.sql"].map((name) => `db/migrations/${name}`)]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/update\s+loyalty_programs\s+set\s+cooldown_seconds/i);
    }
  });

  it("formate en minutes lorsque c'est pertinent", () => {
    expect(formatCooldown(0)).toBe("aucun délai");
    expect(formatCooldown(45)).toBe("45 s");
    expect(formatCooldown(90)).toBe("1 min 30 s");
    expect(formatCooldown(600)).toBe("10 min");
    expect(formatRemaining(545)).toBe("9 min 05 s");
    expect(formatRemaining(42)).toBe("42 s");
    expect(formatRemaining(0.2)).toBe("1 s");
  });

  it("calcule le temps restant sans valeur négative", () => {
    const now = Date.parse("2026-09-25T12:10:00Z");
    expect(cooldownRemainingSeconds("2026-09-25T12:05:00Z", 600, now)).toBe(300);
    expect(cooldownRemainingSeconds("2026-09-25T11:55:00Z", 600, now)).toBe(0);
    expect(cooldownRemainingSeconds(null, 600, now)).toBe(0);
    expect(cooldownRemainingSeconds("2026-09-25T12:09:59.500Z", 600, now)).toBe(600);
    expect(cooldownRemainingSeconds("2026-09-25T12:09:00Z", 0, now)).toBe(0);
  });

  it("utilise un motif système sans donnée personnelle", () => {
    expect(NEW_PURCHASE_REASON).toMatch(/^[A-Z_]+$/);
  });
});
