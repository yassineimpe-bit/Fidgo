export const RETIKO_ANDROID_PACKAGE_ID = "fr.retiko.app";

const SHA256_FINGERPRINT =
  /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

export type AndroidAssetLink = {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

export function parseAndroidCertFingerprints(raw?: string) {
  if (!raw) return [];

  const fingerprints = raw
    .split(/[\s,;]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => SHA256_FINGERPRINT.test(value));

  return [...new Set(fingerprints)];
}

export function buildAndroidAssetLinks(raw?: string): AndroidAssetLink[] {
  const fingerprints = parseAndroidCertFingerprints(
    raw ?? process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS,
  );

  if (fingerprints.length === 0) return [];

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: RETIKO_ANDROID_PACKAGE_ID,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
