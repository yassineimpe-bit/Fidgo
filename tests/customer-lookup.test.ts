import { describe, expect, it } from "vitest";
import { phoneLookupVariants } from "@/lib/customer-lookup";

describe("phone lookup variants", () => {
  it("normalise les formats français usuels", () => {
    expect(phoneLookupVariants("06 12 34 56 78")).toEqual([
      "0612345678",
      "33612345678",
      "0033612345678",
    ]);
    expect(phoneLookupVariants("+33 6 12 34 56 78")).toEqual([
      "33612345678",
      "0612345678",
      "0033612345678",
    ]);
  });

  it("refuse une recherche qui n'a pas la forme d'un téléphone", () => {
    expect(phoneLookupVariants("client@example.com")).toEqual([null, null, null]);
    expect(phoneLookupVariants("123")).toEqual([null, null, null]);
  });

  it("conserve les numéros internationaux sans transformation hasardeuse", () => {
    expect(phoneLookupVariants("+32 470 12 34 56")).toEqual([
      "32470123456",
      null,
      null,
    ]);
  });
});
