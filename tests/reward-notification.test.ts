import { describe, expect, it } from "vitest";
import { crossedRewardThreshold } from "@/lib/reward-notification";

describe("récompense disponible : franchissement du seuil", () => {
  it("uniquement quand le solde passe d'en dessous à au moins le seuil", () => {
    expect(crossedRewardThreshold(9, 10, 10)).toBe(true);
    expect(crossedRewardThreshold(8, 12, 10)).toBe(true);
    expect(crossedRewardThreshold(10, 11, 10)).toBe(false);
    expect(crossedRewardThreshold(7, 9, 10)).toBe(false);
    expect(crossedRewardThreshold(0, 1, 0)).toBe(false);
  });
});
