import { describe, expect, it } from "vitest";
import {
  RETIKO_ANDROID_PACKAGE_ID,
  buildAndroidAssetLinks,
  parseAndroidCertFingerprints,
} from "../lib/android-app";

const VALID =
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

describe("Android Digital Asset Links", () => {
  it("normalise et déduplique les empreintes SHA-256", () => {
    expect(parseAndroidCertFingerprints(`${VALID.toLowerCase()},\n${VALID}`)).toEqual([VALID]);
  });

  it("ignore les valeurs invalides", () => {
    expect(parseAndroidCertFingerprints(`invalid,${VALID},AA:BB`)).toEqual([VALID]);
  });

  it("ne publie aucune association sans certificat configuré", () => {
    expect(buildAndroidAssetLinks("")).toEqual([]);
  });

  it("publie le package Android Retiko avec les empreintes configurées", () => {
    expect(buildAndroidAssetLinks(VALID)).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: RETIKO_ANDROID_PACKAGE_ID,
          sha256_cert_fingerprints: [VALID],
        },
      },
    ]);
    expect(RETIKO_ANDROID_PACKAGE_ID).toBe("fr.retiko.app");
  });
});
