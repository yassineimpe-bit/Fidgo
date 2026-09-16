import { describe, expect, it } from "vitest";
import { getAppUrl } from "../lib/app-url";

describe("getAppUrl", () => {
  it("prioritizes an explicit canonical app URL", () => {
    expect(getAppUrl({
      NEXT_PUBLIC_APP_URL: "https://retiko.fr/anything?ignored=1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "fidgo-env-probe.vercel.app",
    })).toBe("https://retiko.fr");
  });

  it("falls back to retiko.fr in Vercel production instead of the technical alias", () => {
    expect(getAppUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "fidgo-env-probe.vercel.app",
      VERCEL_URL: "fidgo-env-probe-abc.vercel.app",
    })).toBe("https://retiko.fr");
  });

  it("keeps preview deployments on their preview URL", () => {
    expect(getAppUrl({
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "fidgo-env-probe.vercel.app",
      VERCEL_URL: "fidgo-env-probe-git-feature.vercel.app",
    })).toBe("https://fidgo-env-probe.vercel.app");
  });

  it("uses VERCEL_URL when no explicit or project production URL exists", () => {
    expect(getAppUrl({ VERCEL_ENV: "preview", VERCEL_URL: "preview.example.vercel.app" }))
      .toBe("https://preview.example.vercel.app");
  });

  it("returns an empty string outside Vercel when no URL is configured", () => {
    expect(getAppUrl({})).toBe("");
  });
});
