import { describe, expect, it } from "vitest";
import { activityActionLabel, parseActivityFilters } from "@/lib/activity-log";

describe("activity log filters", () => {
  it("utilise 30 jours et la première page par défaut", () => {
    expect(parseActivityFilters({})).toMatchObject({
      q: "",
      page: 1,
      limit: 50,
      offset: 0,
      period: { value: "30", days: 30 },
    });
  });

  it("borne recherche, période et pagination", () => {
    const filters = parseActivityFilters({
      q: "x".repeat(200),
      period: "365",
      page: "-4",
    });
    expect(filters.q).toHaveLength(120);
    expect(filters.period.value).toBe("30");
    expect(filters.page).toBe(1);
  });

  it("rend les actions connues lisibles et garde un fallback", () => {
    expect(activityActionLabel("STAFF_CREATE")).toBe("Employé créé");
    expect(activityActionLabel("CUSTOM_ACTION")).toBe("Custom Action");
  });
});
