import { describe, expect, it } from "vitest";
import { parseAnalyticsPeriod } from "@/lib/analytics-period";

describe("analytics period", () => {
  it("utilise 30 jours par défaut", () => {
    expect(parseAnalyticsPeriod(undefined)).toMatchObject({ value: "30", days: 30 });
  });

  it("accepte uniquement les périodes prévues", () => {
    expect(parseAnalyticsPeriod("7")).toMatchObject({ value: "7", days: 7 });
    expect(parseAnalyticsPeriod("90")).toMatchObject({ value: "90", days: 90 });
    expect(parseAnalyticsPeriod("365")).toMatchObject({ value: "30", days: 30 });
  });

  it("prend la première valeur d'un paramètre répété", () => {
    expect(parseAnalyticsPeriod(["7", "90"])).toMatchObject({ value: "7", days: 7 });
  });
});
